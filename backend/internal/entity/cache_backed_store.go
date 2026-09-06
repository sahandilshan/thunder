// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package entity

import (
	"context"
	"encoding/json"

	"github.com/thunder-id/thunderid/internal/system/cache"
	"github.com/thunder-id/thunderid/internal/system/log"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"
)

// defaultCacheableIdentifiers lists the filter keys eligible for single-key
// IdentifyEntity cache lookups.
var defaultCacheableIdentifiers = []string{"clientId"}

// cacheBackedEntityStore wraps an entityStoreInterface with in-memory caching
// for individual entity lookups by ID and identifier filter resolution.
type cacheBackedEntityStore struct {
	entityByIDCache                cache.CacheInterface[*providers.Entity]
	entityWithCredentialsByIDCache cache.CacheInterface[*entityWithCredentials]
	entityIDByIdentifierCache      cache.CacheInterface[*string]
	cacheableIdentifiers           map[string]bool
	store                          entityStoreInterface
	logger                         *log.Logger
}

// newCacheBackedEntityStore wraps a store with read-through caching.
func newCacheBackedEntityStore(store entityStoreInterface,
	entityByIDCache cache.CacheInterface[*providers.Entity],
	entityWithCredentialsByIDCache cache.CacheInterface[*entityWithCredentials],
	entityIDByIdentifierCache cache.CacheInterface[*string]) entityStoreInterface {
	idSet := make(map[string]bool, len(defaultCacheableIdentifiers))
	for _, id := range defaultCacheableIdentifiers {
		idSet[id] = true
	}
	return &cacheBackedEntityStore{
		entityByIDCache:                entityByIDCache,
		entityWithCredentialsByIDCache: entityWithCredentialsByIDCache,
		entityIDByIdentifierCache:      entityIDByIdentifierCache,
		cacheableIdentifiers:           idSet,
		store:                          store,
		logger: log.GetLogger().With(
			log.String(log.LoggerKeyComponentName, "CacheBackedEntityStore")),
	}
}

func (s *cacheBackedEntityStore) CreateEntity(ctx context.Context, entity providers.Entity,
	credentials json.RawMessage, systemCredentials json.RawMessage) error {
	if err := s.store.CreateEntity(ctx, entity, credentials, systemCredentials); err != nil {
		return err
	}
	s.cacheEntityByID(ctx, &entity)
	s.cacheEntityIDByIdentifiers(ctx, &entity)
	return nil
}

func (s *cacheBackedEntityStore) GetEntity(ctx context.Context, id string) (providers.Entity, error) {
	cacheKey := cache.CacheKey{Key: id}
	if cached, ok := s.entityByIDCache.Get(ctx, cacheKey); ok {
		return *cached, nil
	}

	entity, err := s.store.GetEntity(ctx, id)
	if err != nil {
		return entity, err
	}

	s.cacheEntityByID(ctx, &entity)
	return entity, nil
}

func (s *cacheBackedEntityStore) GetEntityWithCredentials(ctx context.Context,
	id string) (*entityWithCredentials, error) {
	cacheKey := cache.CacheKey{Key: id}
	if cached, ok := s.entityWithCredentialsByIDCache.Get(ctx, cacheKey); ok {
		return cached, nil
	}

	result, err := s.store.GetEntityWithCredentials(ctx, id)
	if err != nil {
		return nil, err
	}

	s.cacheEntityWithCredentialsByID(ctx, result)
	return result, nil
}

// UpdateEntity drops the entity's cache entries around the write.
//
// The by-ID entry is invalidated rather than re-seeded from the caller's struct. The update
// statement writes only a subset of the entity's columns, so the supplied struct is not a faithful
// image of the stored row: re-seeding from it published a partial entity, which silently dropped
// ResourceServerID and made an agent's inbound access unreachable after any update. Callers pay one
// cache miss on the next read instead.
//
// The by-ID entry is invalidated on both sides of the write. Callers run this inside their own
// transaction, so the post-write invalidation happens before commit: a concurrent reader can
// repopulate the entry from the pre-commit state, and on rollback that entry would describe a row
// that never existed. Invalidating first bounds that to the window around the write itself.
func (s *cacheBackedEntityStore) UpdateEntity(ctx context.Context, entity *providers.Entity) error {
	// Resolve the identifier keys while the pre-update values are still stored; once the write lands
	// the old values are gone and their entries could no longer be located.
	staleIdentifierKeys := s.identifierCacheKeys(ctx, entity.ID)
	s.invalidateEntityByID(ctx, entity.ID)

	if err := s.store.UpdateEntity(ctx, entity); err != nil {
		return err
	}

	s.deleteIdentifierCacheKeys(ctx, staleIdentifierKeys)
	s.invalidateEntityByID(ctx, entity.ID)
	s.cacheEntityIDByIdentifiers(ctx, entity)
	return nil
}

func (s *cacheBackedEntityStore) UpdateAttributes(ctx context.Context,
	entityID string, attributes json.RawMessage) error {
	staleIdentifierKeys := s.identifierCacheKeys(ctx, entityID)

	if err := s.store.UpdateAttributes(ctx, entityID, attributes); err != nil {
		return err
	}

	s.deleteIdentifierCacheKeys(ctx, staleIdentifierKeys)
	s.invalidateEntityByID(ctx, entityID)
	return nil
}

func (s *cacheBackedEntityStore) UpdateSystemAttributes(ctx context.Context,
	entityID string, attrs json.RawMessage) error {
	staleIdentifierKeys := s.identifierCacheKeys(ctx, entityID)

	if err := s.store.UpdateSystemAttributes(ctx, entityID, attrs); err != nil {
		return err
	}

	s.deleteIdentifierCacheKeys(ctx, staleIdentifierKeys)
	s.invalidateEntityByID(ctx, entityID)
	return nil
}

func (s *cacheBackedEntityStore) UpdateCredentials(ctx context.Context,
	entityID string, creds json.RawMessage) error {
	if err := s.store.UpdateCredentials(ctx, entityID, creds); err != nil {
		return err
	}

	s.invalidateEntityByID(ctx, entityID)
	return nil
}

func (s *cacheBackedEntityStore) UpdateSystemCredentials(ctx context.Context,
	entityID string, creds json.RawMessage) error {
	if err := s.store.UpdateSystemCredentials(ctx, entityID, creds); err != nil {
		return err
	}

	s.invalidateEntityByID(ctx, entityID)
	return nil
}

func (s *cacheBackedEntityStore) DeleteEntity(ctx context.Context, id string) error {
	// Resolve the identifier keys before the store delete so the store fallback can still fetch the
	// entity if the by-ID cache is cold; the entries themselves are dropped after the delete lands.
	staleIdentifierKeys := s.identifierCacheKeys(ctx, id)

	if err := s.store.DeleteEntity(ctx, id); err != nil {
		return err
	}

	s.deleteIdentifierCacheKeys(ctx, staleIdentifierKeys)
	s.invalidateEntityByID(ctx, id)
	return nil
}

func (s *cacheBackedEntityStore) IdentifyEntity(ctx context.Context,
	filters map[string]interface{}) (*string, error) {
	if len(filters) == 1 {
		for filterKey, filterVal := range filters {
			val, ok := filterVal.(string)
			if !ok || val == "" || !s.cacheableIdentifiers[filterKey] {
				return s.store.IdentifyEntity(ctx, filters)
			}
			compositeKey := identifierCacheKey(filterKey, val)
			if cached, hit := s.entityIDByIdentifierCache.Get(ctx, compositeKey); hit {
				return cached, nil
			}

			entityID, err := s.store.IdentifyEntity(ctx, filters)
			if err != nil || entityID == nil {
				return entityID, err
			}

			if err := s.entityIDByIdentifierCache.Set(ctx,
				compositeKey, entityID); err != nil {
				s.logger.Error(ctx, "Failed to cache entity ID by identifier",
					log.String("key", filterKey), log.String("value", val), log.Error(err))
			}
			return entityID, nil
		}
	}

	return s.store.IdentifyEntity(ctx, filters)
}

// Pass-through methods.

func (s *cacheBackedEntityStore) SearchEntities(ctx context.Context,
	filters map[string]interface{}) ([]providers.Entity, error) {
	return s.store.SearchEntities(ctx, filters)
}

func (s *cacheBackedEntityStore) GetEntityListCount(ctx context.Context,
	category string, filters map[string]interface{}) (int, error) {
	return s.store.GetEntityListCount(ctx, category, filters)
}

func (s *cacheBackedEntityStore) GetEntityList(ctx context.Context,
	category string, limit, offset int, filters map[string]interface{}) ([]providers.Entity, error) {
	return s.store.GetEntityList(ctx, category, limit, offset, filters)
}

func (s *cacheBackedEntityStore) GetEntityListCountByOUIDs(ctx context.Context,
	category string, ouIDs []string, filters map[string]interface{}) (int, error) {
	return s.store.GetEntityListCountByOUIDs(ctx, category, ouIDs, filters)
}

func (s *cacheBackedEntityStore) GetEntityListByOUIDs(ctx context.Context,
	category string, ouIDs []string, limit, offset int,
	filters map[string]interface{}) ([]providers.Entity, error) {
	return s.store.GetEntityListByOUIDs(ctx, category, ouIDs, limit, offset, filters)
}

func (s *cacheBackedEntityStore) ValidateEntityIDs(ctx context.Context,
	entityIDs []string) ([]string, error) {
	return s.store.ValidateEntityIDs(ctx, entityIDs)
}

func (s *cacheBackedEntityStore) GetEntitiesByIDs(ctx context.Context,
	entityIDs []string) ([]providers.Entity, error) {
	return s.store.GetEntitiesByIDs(ctx, entityIDs)
}

func (s *cacheBackedEntityStore) ValidateEntityIDsInOUs(ctx context.Context,
	entityIDs []string, ouIDs []string) ([]string, error) {
	return s.store.ValidateEntityIDsInOUs(ctx, entityIDs, ouIDs)
}

func (s *cacheBackedEntityStore) GetGroupCountForEntity(ctx context.Context,
	entityID string) (int, error) {
	return s.store.GetGroupCountForEntity(ctx, entityID)
}

func (s *cacheBackedEntityStore) GetEntityGroups(ctx context.Context,
	entityID string, limit, offset int) ([]providers.EntityGroup, error) {
	return s.store.GetEntityGroups(ctx, entityID, limit, offset)
}

func (s *cacheBackedEntityStore) UpdateEntityResourceServerID(ctx context.Context,
	entityID string, resourceServerID *string) error {
	if err := s.store.UpdateEntityResourceServerID(ctx, entityID, resourceServerID); err != nil {
		return err
	}

	s.invalidateEntityByID(ctx, entityID)
	return nil
}

func (s *cacheBackedEntityStore) GetEntitiesByResourceServerID(ctx context.Context,
	resourceServerID string) ([]providers.Entity, error) {
	return s.store.GetEntitiesByResourceServerID(ctx, resourceServerID)
}

func (s *cacheBackedEntityStore) IsEntityDeclarative(ctx context.Context, id string) (bool, error) {
	return s.store.IsEntityDeclarative(ctx, id)
}

func (s *cacheBackedEntityStore) GetIndexedAttributes() map[string]bool {
	return s.store.GetIndexedAttributes()
}

func (s *cacheBackedEntityStore) LoadIndexedAttributes(attributes []string) error {
	return s.store.LoadIndexedAttributes(attributes)
}

// --- Cache helpers ---

func identifierCacheKey(filterKey, filterValue string) cache.CacheKey {
	return cache.CacheKey{Key: filterKey + ":" + filterValue}
}

// parseEntityAttributes unmarshals the entity's SystemAttributes and Attributes
// into a single merged map. SystemAttributes take precedence on key collisions.
func (s *cacheBackedEntityStore) parseEntityAttributes(
	ctx context.Context, entity *providers.Entity,
) map[string]interface{} {
	if entity == nil {
		return nil
	}
	merged := make(map[string]interface{})
	for _, raw := range []json.RawMessage{entity.Attributes, entity.SystemAttributes} {
		if len(raw) == 0 {
			continue
		}
		var attrs map[string]interface{}
		if err := json.Unmarshal(raw, &attrs); err != nil {
			s.logger.Warn(ctx, "Failed to unmarshal entity attributes for cache key resolution",
				log.String("entityID", entity.ID), log.Error(err))
			continue
		}
		for k, v := range attrs {
			merged[k] = v
		}
	}
	return merged
}

func (s *cacheBackedEntityStore) cacheEntityIDByIdentifiers(ctx context.Context, entity *providers.Entity) {
	if entity == nil || entity.ID == "" {
		return
	}
	attrs := s.parseEntityAttributes(ctx, entity)
	for key := range s.cacheableIdentifiers {
		val, _ := attrs[key].(string)
		if val == "" {
			continue
		}
		if err := s.entityIDByIdentifierCache.Set(ctx,
			identifierCacheKey(key, val), &entity.ID); err != nil {
			s.logger.Error(ctx, "Failed to cache entity ID by identifier",
				log.String("key", key), log.String("value", val), log.Error(err))
		}
	}
}

// identifierCacheKeys resolves the identifier cache keys the entity currently occupies. Callers
// resolve them before a write or delete, while the entity still holds its pre-change identifier
// values, and drop them with deleteIdentifierCacheKeys once the change has landed.
func (s *cacheBackedEntityStore) identifierCacheKeys(
	ctx context.Context, entityID string) []cache.CacheKey {
	if entityID == "" || len(s.cacheableIdentifiers) == 0 {
		return nil
	}
	var entity *providers.Entity
	if cached, ok := s.entityByIDCache.Get(ctx, cache.CacheKey{Key: entityID}); ok && cached != nil {
		entity = cached
	} else {
		fetched, err := s.store.GetEntity(ctx, entityID)
		if err != nil {
			s.logger.Error(ctx, "Failed to fetch entity for identifier cache invalidation",
				log.String("entityID", entityID), log.Error(err))
			return nil
		}
		entity = &fetched
	}
	attrs := s.parseEntityAttributes(ctx, entity)
	keys := make([]cache.CacheKey, 0, len(s.cacheableIdentifiers))
	for key := range s.cacheableIdentifiers {
		val, _ := attrs[key].(string)
		if val == "" {
			continue
		}
		keys = append(keys, identifierCacheKey(key, val))
	}
	return keys
}

// deleteIdentifierCacheKeys drops the given identifier cache entries.
func (s *cacheBackedEntityStore) deleteIdentifierCacheKeys(ctx context.Context, keys []cache.CacheKey) {
	for _, key := range keys {
		if err := s.entityIDByIdentifierCache.Delete(ctx, key); err != nil {
			s.logger.Error(ctx, "Failed to invalidate identifier cache",
				log.String("key", key.Key), log.Error(err))
		}
	}
}

func (s *cacheBackedEntityStore) cacheEntityByID(ctx context.Context, entity *providers.Entity) {
	if entity == nil || entity.ID == "" {
		return
	}
	if err := s.entityByIDCache.Set(ctx, cache.CacheKey{Key: entity.ID}, entity); err != nil {
		s.logger.Error(ctx, "Failed to cache entity by ID",
			log.String("entityID", entity.ID), log.Error(err))
	}
}

func (s *cacheBackedEntityStore) cacheEntityWithCredentialsByID(ctx context.Context,
	ewc *entityWithCredentials) {
	if ewc == nil || ewc.Entity == nil || ewc.Entity.ID == "" {
		return
	}
	if err := s.entityWithCredentialsByIDCache.Set(ctx,
		cache.CacheKey{Key: ewc.Entity.ID}, ewc); err != nil {
		s.logger.Error(ctx, "Failed to cache entity with credentials by ID",
			log.String("entityID", ewc.Entity.ID), log.Error(err))
	}
}

func (s *cacheBackedEntityStore) invalidateEntityByID(ctx context.Context, entityID string) {
	if entityID == "" {
		return
	}
	if err := s.entityByIDCache.Delete(ctx, cache.CacheKey{Key: entityID}); err != nil {
		s.logger.Error(ctx, "Failed to invalidate entity cache by ID",
			log.String("entityID", entityID), log.Error(err))
	}
	if err := s.entityWithCredentialsByIDCache.Delete(ctx, cache.CacheKey{Key: entityID}); err != nil {
		s.logger.Error(ctx, "Failed to invalidate entity with credentials cache by ID",
			log.String("entityID", entityID), log.Error(err))
	}
}
