// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package entity

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"

	"github.com/thunder-id/thunderid/internal/system/cache"
	"github.com/thunder-id/thunderid/internal/system/log"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"
	"github.com/thunder-id/thunderid/tests/mocks/cachemock"
)

// CacheBackedEntityStoreTestSuite tests the cacheBackedEntityStore.
type CacheBackedEntityStoreTestSuite struct {
	suite.Suite
	mockStore                      *entityStoreInterfaceMock
	entityByIDCache                *cachemock.CacheInterfaceMock[*providers.Entity]
	entityWithCredentialsByIDCache *cachemock.CacheInterfaceMock[*entityWithCredentials]
	entityIDByIdentifierCache      *cachemock.CacheInterfaceMock[*string]
	cachedStore                    *cacheBackedEntityStore
	entityByIDData                 map[string]*providers.Entity
	entityWithCredsByIDData        map[string]*entityWithCredentials
	entityIDByIdentifierData       map[string]*string
}

func TestCacheBackedEntityStoreTestSuite(t *testing.T) {
	suite.Run(t, new(CacheBackedEntityStoreTestSuite))
}

func (s *CacheBackedEntityStoreTestSuite) SetupTest() {
	s.mockStore = newEntityStoreInterfaceMock(s.T())
	s.entityByIDData = make(map[string]*providers.Entity)
	s.entityWithCredsByIDData = make(map[string]*entityWithCredentials)
	s.entityIDByIdentifierData = make(map[string]*string)

	s.entityByIDCache = cachemock.NewCacheInterfaceMock[*providers.Entity](s.T())
	s.entityWithCredentialsByIDCache = cachemock.NewCacheInterfaceMock[*entityWithCredentials](s.T())
	s.entityIDByIdentifierCache = cachemock.NewCacheInterfaceMock[*string](s.T())

	setupEntityCacheMock(s.entityByIDCache, s.entityByIDData)
	setupEntityCacheMock(s.entityWithCredentialsByIDCache, s.entityWithCredsByIDData)
	setupEntityCacheMock(s.entityIDByIdentifierCache, s.entityIDByIdentifierData)

	s.entityByIDCache.EXPECT().IsEnabled().Return(true).Maybe()
	s.entityWithCredentialsByIDCache.EXPECT().IsEnabled().Return(true).Maybe()
	s.entityIDByIdentifierCache.EXPECT().IsEnabled().Return(true).Maybe()

	s.cachedStore = &cacheBackedEntityStore{
		entityByIDCache:                s.entityByIDCache,
		entityWithCredentialsByIDCache: s.entityWithCredentialsByIDCache,
		entityIDByIdentifierCache:      s.entityIDByIdentifierCache,
		cacheableIdentifiers:           map[string]bool{"clientId": true},
		store:                          s.mockStore,
		logger: log.GetLogger().With(
			log.String(log.LoggerKeyComponentName, "CacheBackedEntityStore")),
	}
}

func setupEntityCacheMock[T any](
	mockCache *cachemock.CacheInterfaceMock[T],
	data map[string]T,
) {
	mockCache.EXPECT().Set(mock.Anything, mock.Anything, mock.Anything).
		RunAndReturn(func(ctx context.Context, key cache.CacheKey, value T) error {
			data[key.Key] = value
			return nil
		}).Maybe()

	mockCache.EXPECT().Get(mock.Anything, mock.Anything).
		RunAndReturn(func(ctx context.Context, key cache.CacheKey) (T, bool) {
			if val, ok := data[key.Key]; ok {
				return val, true
			}
			var zero T
			return zero, false
		}).Maybe()

	mockCache.EXPECT().Delete(mock.Anything, mock.Anything).
		RunAndReturn(func(ctx context.Context, key cache.CacheKey) error {
			delete(data, key.Key)
			return nil
		}).Maybe()

	mockCache.EXPECT().Clear(mock.Anything).
		RunAndReturn(func(ctx context.Context) error {
			for k := range data {
				delete(data, k)
			}
			return nil
		}).Maybe()

	mockCache.EXPECT().GetName().Return("mockCache").Maybe()
	mockCache.EXPECT().CleanupExpired().Maybe()
}

func (s *CacheBackedEntityStoreTestSuite) makeEntity(id, clientID string) providers.Entity {
	sysAttrs := map[string]interface{}{"clientId": clientID}
	sysAttrsJSON, _ := json.Marshal(sysAttrs)
	return providers.Entity{
		ID:               id,
		Category:         providers.EntityCategoryApp,
		Type:             "application",
		State:            providers.EntityStateActive,
		SystemAttributes: json.RawMessage(sysAttrsJSON),
	}
}

const (
	testEntityID = "entity-1"
	// testCachedRSID is the resource server an entity owns in the cache round-trip tests.
	testCachedRSID = "rs-1"
)

// GetEntity tests

func (s *CacheBackedEntityStoreTestSuite) TestGetEntity_CacheHit() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity

	result, err := s.cachedStore.GetEntity(context.Background(), entity.ID)
	s.Nil(err)
	s.Equal(entity.ID, result.ID)
	s.mockStore.AssertNotCalled(s.T(), "GetEntity")
}

func (s *CacheBackedEntityStoreTestSuite) TestGetEntity_CacheMiss() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.mockStore.On("GetEntity", mock.Anything, entity.ID).Return(entity, nil).Once()

	result, err := s.cachedStore.GetEntity(context.Background(), entity.ID)
	s.Nil(err)
	s.Equal(entity.ID, result.ID)
	s.mockStore.AssertExpectations(s.T())

	cached, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.True(ok)
	s.Equal(entity.ID, cached.ID)
}

func (s *CacheBackedEntityStoreTestSuite) TestGetEntity_StoreError() {
	storeErr := errors.New("db error")
	s.mockStore.On("GetEntity", mock.Anything, "bad-id").Return(providers.Entity{}, storeErr).Once()

	_, err := s.cachedStore.GetEntity(context.Background(), "bad-id")
	s.Equal(storeErr, err)

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: "bad-id"})
	s.False(ok)
}

// GetEntityWithCredentials tests

func (s *CacheBackedEntityStoreTestSuite) TestGetEntityWithCredentials_CacheHit() {
	entity := s.makeEntity(testEntityID, "client-1")
	ewc := &entityWithCredentials{
		Entity:            &entity,
		SchemaCredentials: json.RawMessage(`{"password":"hashed"}`),
		SystemCredentials: json.RawMessage(`{"secret":"val"}`),
	}
	s.entityWithCredsByIDData[entity.ID] = ewc

	result, err := s.cachedStore.GetEntityWithCredentials(context.Background(), entity.ID)
	s.Nil(err)
	s.Equal(entity.ID, result.Entity.ID)
	s.Equal(ewc.SchemaCredentials, result.SchemaCredentials)
	s.mockStore.AssertNotCalled(s.T(), "GetEntityWithCredentials")
}

func (s *CacheBackedEntityStoreTestSuite) TestGetEntityWithCredentials_CacheMiss() {
	entity := s.makeEntity(testEntityID, "client-1")
	ewc := &entityWithCredentials{
		Entity:            &entity,
		SchemaCredentials: json.RawMessage(`{"password":"hashed"}`),
		SystemCredentials: json.RawMessage(`{"secret":"val"}`),
	}
	s.mockStore.On("GetEntityWithCredentials", mock.Anything, entity.ID).Return(ewc, nil).Once()

	result, err := s.cachedStore.GetEntityWithCredentials(context.Background(), entity.ID)
	s.Nil(err)
	s.Equal(entity.ID, result.Entity.ID)
	s.mockStore.AssertExpectations(s.T())

	cached, ok := s.entityWithCredentialsByIDCache.Get(context.Background(),
		cache.CacheKey{Key: entity.ID})
	s.True(ok)
	s.Equal(entity.ID, cached.Entity.ID)
}

func (s *CacheBackedEntityStoreTestSuite) TestGetEntityWithCredentials_StoreError() {
	storeErr := errors.New("db error")
	s.mockStore.On("GetEntityWithCredentials", mock.Anything, "bad-id").
		Return(nil, storeErr).Once()

	_, err := s.cachedStore.GetEntityWithCredentials(context.Background(), "bad-id")
	s.Equal(storeErr, err)

	_, ok := s.entityWithCredentialsByIDCache.Get(context.Background(),
		cache.CacheKey{Key: "bad-id"})
	s.False(ok)
}

// IdentifyEntity tests

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_CallsStore() {
	entityID := testEntityID
	filters := map[string]interface{}{"clientId": "client-1"}
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).Return(&entityID, nil).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Nil(err)
	s.Equal(entityID, *result)
	s.mockStore.AssertExpectations(s.T())
}

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_StoreError() {
	filters := map[string]interface{}{"clientId": "bad-client"}
	storeErr := errors.New("not found")
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).Return(nil, storeErr).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Equal(storeErr, err)
	s.Nil(result)
	s.mockStore.AssertExpectations(s.T())
}

// UpdateSystemAttributes tests

func (s *CacheBackedEntityStoreTestSuite) TestUpdateSystemAttributes_InvalidatesEntityCache() {
	entity := s.makeEntity(testEntityID, "old-client")
	s.entityByIDData[entity.ID] = &entity

	newSysAttrs, _ := json.Marshal(map[string]interface{}{"clientId": "new-client"})
	s.mockStore.On("UpdateSystemAttributes", mock.Anything, entity.ID,
		json.RawMessage(newSysAttrs)).Return(nil).Once()

	err := s.cachedStore.UpdateSystemAttributes(context.Background(), entity.ID, newSysAttrs)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.False(ok)
}

// GetEntityWithCredentials cache helper edge cases

func (s *CacheBackedEntityStoreTestSuite) TestGetEntityWithCredentials_NilResult_DoesNotCache() {
	s.mockStore.On("GetEntityWithCredentials", mock.Anything, "nil-entity").
		Return(&entityWithCredentials{}, nil).Once()

	result, err := s.cachedStore.GetEntityWithCredentials(context.Background(), "nil-entity")
	s.Nil(err)
	s.NotNil(result)
	s.mockStore.AssertExpectations(s.T())

	// Result has nil providers.Entity, so it should not be cached.
	_, ok := s.entityWithCredentialsByIDCache.Get(context.Background(),
		cache.CacheKey{Key: "nil-entity"})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestGetEntityWithCredentials_CacheSetError() {
	entity := s.makeEntity(testEntityID, "client-1")
	ewc := &entityWithCredentials{
		Entity:            &entity,
		SchemaCredentials: json.RawMessage(`{"password":"hashed"}`),
	}

	failingCredsCache := cachemock.NewCacheInterfaceMock[*entityWithCredentials](s.T())
	failingCredsCache.EXPECT().Get(mock.Anything, mock.Anything).
		Return(nil, false).Once()
	failingCredsCache.EXPECT().Set(mock.Anything, mock.Anything, mock.Anything).
		Return(errors.New("cache set error")).Once()
	failingCredsCache.EXPECT().Delete(mock.Anything, mock.Anything).Return(nil).Maybe()
	failingCredsCache.EXPECT().GetName().Return("failingCredsCache").Maybe()
	failingCredsCache.EXPECT().CleanupExpired().Maybe()

	store := &cacheBackedEntityStore{
		entityByIDCache:                s.entityByIDCache,
		entityWithCredentialsByIDCache: failingCredsCache,
		entityIDByIdentifierCache:      s.entityIDByIdentifierCache,
		cacheableIdentifiers:           map[string]bool{"clientId": true},
		store:                          s.mockStore,
		logger: log.GetLogger().With(
			log.String(log.LoggerKeyComponentName, "CacheBackedEntityStore")),
	}

	s.mockStore.On("GetEntityWithCredentials", mock.Anything, entity.ID).Return(ewc, nil).Once()

	result, err := store.GetEntityWithCredentials(context.Background(), entity.ID)
	s.Nil(err)
	s.Equal(entity.ID, result.Entity.ID)
}

func (s *CacheBackedEntityStoreTestSuite) TestInvalidateEntityByID_CredsDeleteError() {
	failingCredsCache := cachemock.NewCacheInterfaceMock[*entityWithCredentials](s.T())
	failingCredsCache.EXPECT().Get(mock.Anything, mock.Anything).Return(nil, false).Maybe()
	failingCredsCache.EXPECT().Set(mock.Anything, mock.Anything, mock.Anything).Return(nil).Maybe()
	failingCredsCache.EXPECT().Delete(mock.Anything, mock.Anything).
		Return(errors.New("cache delete error")).Once()
	failingCredsCache.EXPECT().GetName().Return("failingCredsCache").Maybe()
	failingCredsCache.EXPECT().CleanupExpired().Maybe()

	store := &cacheBackedEntityStore{
		entityByIDCache:                s.entityByIDCache,
		entityWithCredentialsByIDCache: failingCredsCache,
		entityIDByIdentifierCache:      s.entityIDByIdentifierCache,
		cacheableIdentifiers:           map[string]bool{"clientId": true},
		store:                          s.mockStore,
		logger: log.GetLogger().With(
			log.String(log.LoggerKeyComponentName, "CacheBackedEntityStore")),
	}

	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity
	s.mockStore.On("DeleteEntity", mock.Anything, entity.ID).Return(nil).Once()

	// Should not propagate the cache delete error.
	err := store.DeleteEntity(context.Background(), entity.ID)
	s.Nil(err)
}

// UpdateCredentials / UpdateSystemCredentials tests

func (s *CacheBackedEntityStoreTestSuite) TestUpdateCredentials_InvalidatesBothCaches() {
	tests := []struct {
		name       string
		storeFn    string
		updateFunc func(ctx context.Context, entityID string, creds json.RawMessage) error
	}{
		{"UpdateCredentials", "UpdateCredentials", s.cachedStore.UpdateCredentials},
		{"UpdateSystemCredentials", "UpdateSystemCredentials", s.cachedStore.UpdateSystemCredentials},
	}

	for _, tc := range tests {
		s.Run(tc.name, func() {
			entity := s.makeEntity(testEntityID, "client-1")
			s.entityByIDData[entity.ID] = &entity
			s.entityWithCredsByIDData[entity.ID] = &entityWithCredentials{Entity: &entity}

			newCreds := json.RawMessage(`{"key":"new"}`)
			s.mockStore.On(tc.storeFn, mock.Anything, entity.ID, newCreds).Return(nil).Once()

			err := tc.updateFunc(context.Background(), entity.ID, newCreds)
			s.Nil(err)
			s.mockStore.AssertExpectations(s.T())

			_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
			s.False(ok)
			_, ok = s.entityWithCredentialsByIDCache.Get(context.Background(),
				cache.CacheKey{Key: entity.ID})
			s.False(ok)
		})
	}
}

// DeleteEntity tests

func (s *CacheBackedEntityStoreTestSuite) TestDeleteEntity_InvalidatesEntityCache() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity

	s.mockStore.On("DeleteEntity", mock.Anything, entity.ID).Return(nil).Once()

	err := s.cachedStore.DeleteEntity(context.Background(), entity.ID)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestDeleteEntity_StoreError() {
	entity := s.makeEntity("entity-2", "client-2")
	s.entityByIDData[entity.ID] = &entity

	storeErr := errors.New("delete error")
	s.mockStore.On("DeleteEntity", mock.Anything, entity.ID).Return(storeErr).Once()

	err := s.cachedStore.DeleteEntity(context.Background(), entity.ID)
	s.Equal(storeErr, err)

	// Cache should NOT be invalidated on error.
	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.True(ok)
}

// CreateEntity tests

func (s *CacheBackedEntityStoreTestSuite) TestCreateEntity_CachesEntityByID() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.mockStore.On("CreateEntity", mock.Anything, entity, json.RawMessage(nil),
		json.RawMessage(nil)).Return(nil).Once()

	err := s.cachedStore.CreateEntity(context.Background(), entity, nil, nil)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	cached, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.True(ok)
	s.Equal(entity.ID, cached.ID)

	cachedID, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.True(ok)
	s.Equal(entity.ID, *cachedID)
}

func (s *CacheBackedEntityStoreTestSuite) TestCreateEntity_StoreError_DoesNotCache() {
	entity := s.makeEntity(testEntityID, "client-1")
	storeErr := errors.New("create error")
	s.mockStore.On("CreateEntity", mock.Anything, entity, json.RawMessage(nil),
		json.RawMessage(nil)).Return(storeErr).Once()

	err := s.cachedStore.CreateEntity(context.Background(), entity, nil, nil)
	s.Equal(storeErr, err)

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.False(ok)

	_, ok = s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.False(ok)
}

// UpdateEntity tests

func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntity_InvalidatesEntityByID() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity

	s.mockStore.On("UpdateEntity", mock.Anything, &entity).Return(nil).Once()

	err := s.cachedStore.UpdateEntity(context.Background(), &entity)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	// The entry is dropped rather than re-seeded, so the next read reloads from the store.
	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.False(ok, "UpdateEntity must invalidate the by-ID cache, not re-seed it")
}

// The update statement writes only a subset of the entity's columns, so the caller's struct is not
// a faithful image of the stored row. Re-seeding the cache from it published a partial entity: an
// agent update omitting ResourceServerID made the owned resource server unreachable until the
// process restarted. A read after an update must see the persisted value, not the caller's blank.
func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntity_ReadAfterUpdateSeesPersistedResourceServerID() {
	stored := s.makeEntity(testEntityID, "client-1")
	stored.ResourceServerID = testCachedRSID
	s.entityByIDData[stored.ID] = &stored

	// The caller supplies a partial entity, as the agent service does on update.
	partial := s.makeEntity(testEntityID, "client-1")
	partial.ResourceServerID = ""

	s.mockStore.On("UpdateEntity", mock.Anything, &partial).Return(nil).Once()
	// The store still holds the resource server reference: the update never writes that column.
	s.mockStore.On("GetEntity", mock.Anything, testEntityID).Return(stored, nil).Once()

	s.Nil(s.cachedStore.UpdateEntity(context.Background(), &partial))

	result, err := s.cachedStore.GetEntity(context.Background(), testEntityID)
	s.Nil(err)
	s.Equal(testCachedRSID, result.ResourceServerID,
		"read after update returned the caller's blank ResourceServerID instead of the stored one")
}

// The by-ID entry is invalidated on both sides of the write. Callers run UpdateEntity inside their
// own transaction, so the post-write invalidation lands before commit and a concurrent reader can
// repopulate the entry from uncommitted state; on rollback that entry would describe a row that
// never existed. Evicting first bounds the exposure to the window around the write itself. The cost
// is that a failed update also costs one cache miss, which this test pins down.
func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntity_EvictsBeforeTheWrite() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity

	s.mockStore.On("UpdateEntity", mock.Anything, &entity).
		Run(func(mock.Arguments) {
			_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: testEntityID})
			s.False(ok, "the stale entry must be evicted before the write, not only after it")
		}).Return(errors.New("db error")).Once()

	s.Error(s.cachedStore.UpdateEntity(context.Background(), &entity))

	// The pre-write eviction stands even though the write failed: the next read re-reads the row.
	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntityResourceServerID_InvalidatesAfterWrite() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity

	rsID := testCachedRSID
	s.mockStore.On("UpdateEntityResourceServerID", mock.Anything, testEntityID, &rsID).
		Run(func(mock.Arguments) {
			// The cached entry must still be present while the write is in flight, proving the
			// invalidation happens afterwards rather than before.
			_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: testEntityID})
			s.True(ok, "invalidation must happen after the write, not before")
		}).Return(nil).Once()

	s.Nil(s.cachedStore.UpdateEntityResourceServerID(context.Background(), testEntityID, &rsID))

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: testEntityID})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntityResourceServerID_StoreFailureLeavesCacheIntact() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity

	rsID := testCachedRSID
	s.mockStore.On("UpdateEntityResourceServerID", mock.Anything, testEntityID, &rsID).
		Return(errors.New("db error")).Once()

	s.Error(s.cachedStore.UpdateEntityResourceServerID(context.Background(), testEntityID, &rsID))

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: testEntityID})
	s.True(ok)
}

// Walks the real sequence that broke inbound access: an agent owns a resource server, the agent is
// renamed (an update that writes the identity columns but not RESOURCE_SERVER_ID), and the owner is
// then read back. Every read after the update must still resolve the resource server.
func (s *CacheBackedEntityStoreTestSuite) TestResourceServerReferenceSurvivesRenameThroughCache() {
	stored := s.makeEntity(testEntityID, "client-1")
	stored.ResourceServerID = testCachedRSID

	// Warm the cache the way a read before the rename would.
	s.mockStore.On("GetEntity", mock.Anything, testEntityID).Return(stored, nil)
	warmed, err := s.cachedStore.GetEntity(context.Background(), testEntityID)
	s.Nil(err)
	s.Equal(testCachedRSID, warmed.ResourceServerID)

	// Rename: the caller's struct carries the new name and no resource server reference, and the
	// store leaves RESOURCE_SERVER_ID untouched.
	renamed := s.makeEntity(testEntityID, "client-1")
	renamed.Type = "renamed"
	s.mockStore.On("UpdateEntity", mock.Anything, &renamed).Return(nil).Once()
	s.Nil(s.cachedStore.UpdateEntity(context.Background(), &renamed))

	// The store still holds the reference, so the reloaded entity must too.
	afterRename, err := s.cachedStore.GetEntity(context.Background(), testEntityID)
	s.Nil(err)
	s.Equal(testCachedRSID, afterRename.ResourceServerID,
		"the resource server reference was lost after a rename")

	// A repeat read (now served from the refreshed cache) must agree.
	repeat, err := s.cachedStore.GetEntity(context.Background(), testEntityID)
	s.Nil(err)
	s.Equal(testCachedRSID, repeat.ResourceServerID)
}

// IdentifyEntity cache tests

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_CacheHit_CacheableIdentifier() {
	entityID := testEntityID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	result, err := s.cachedStore.IdentifyEntity(context.Background(),
		map[string]interface{}{"clientId": "client-1"})
	s.Nil(err)
	s.Equal(entityID, *result)
	s.mockStore.AssertNotCalled(s.T(), "IdentifyEntity")
}

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_CacheMiss_CacheableIdentifier_PopulatesCache() {
	entityID := testEntityID
	filters := map[string]interface{}{"clientId": "client-1"}
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).Return(&entityID, nil).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Nil(err)
	s.Equal(entityID, *result)
	s.mockStore.AssertExpectations(s.T())

	cachedID, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.True(ok)
	s.Equal(entityID, *cachedID)
}

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_MultipleFilters_BypassesCache() {
	entityID := testEntityID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	filters := map[string]interface{}{"clientId": "client-1", "name": "app"}
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).Return(&entityID, nil).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Nil(err)
	s.Equal(entityID, *result)
	s.mockStore.AssertExpectations(s.T())
}

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_NonCacheableFilter_BypassesCache() {
	entityID := testEntityID
	filters := map[string]interface{}{"email": "user@example.com"}
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).Return(&entityID, nil).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Nil(err)
	s.Equal(entityID, *result)
	s.mockStore.AssertExpectations(s.T())
}

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_StoreError_DoesNotPopulateCache() {
	filters := map[string]interface{}{"clientId": "bad-client"}
	storeErr := errors.New("not found")
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).Return(nil, storeErr).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Equal(storeErr, err)
	s.Nil(result)

	_, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:bad-client"})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestIdentifyEntity_StoreReturnsNil_DoesNotPopulateCache() {
	filters := map[string]interface{}{"clientId": "unknown"}
	s.mockStore.On("IdentifyEntity", mock.Anything, filters).
		Return((*string)(nil), nil).Once()

	result, err := s.cachedStore.IdentifyEntity(context.Background(), filters)
	s.Nil(err)
	s.Nil(result)

	_, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:unknown"})
	s.False(ok)
}

// Identifier cache invalidation tests

func (s *CacheBackedEntityStoreTestSuite) TestDeleteEntity_InvalidatesIdentifierCache() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity
	entityID := entity.ID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	s.mockStore.On("DeleteEntity", mock.Anything, entity.ID).Return(nil).Once()

	err := s.cachedStore.DeleteEntity(context.Background(), entity.ID)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	_, ok := s.entityByIDCache.Get(context.Background(), cache.CacheKey{Key: entity.ID})
	s.False(ok)

	_, ok = s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntity_InvalidatesAndRewarmsIdentifierCache() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity
	entityID := entity.ID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	s.mockStore.On("UpdateEntity", mock.Anything, &entity).Return(nil).Once()

	err := s.cachedStore.UpdateEntity(context.Background(), &entity)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	cachedID, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.True(ok)
	s.Equal(entity.ID, *cachedID)
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateSystemAttributes_InvalidatesIdentifierCache() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity
	entityID := entity.ID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	newSysAttrs, _ := json.Marshal(map[string]interface{}{"clientId": "new-client"})
	s.mockStore.On("UpdateSystemAttributes", mock.Anything, entity.ID,
		json.RawMessage(newSysAttrs)).Return(nil).Once()

	err := s.cachedStore.UpdateSystemAttributes(context.Background(), entity.ID, newSysAttrs)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	_, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestDeleteEntity_InvalidatesIdentifierCache_CacheMiss() {
	entity := s.makeEntity(testEntityID, "client-1")
	entityID := entity.ID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	// providers.Entity is NOT in entityByIDCache — invalidateIdentifierCache must fall back to the store.
	s.mockStore.On("DeleteEntity", mock.Anything, entity.ID).Return(nil).Once()
	s.mockStore.On("GetEntity", mock.Anything, entity.ID).Return(entity, nil).Once()

	err := s.cachedStore.DeleteEntity(context.Background(), entity.ID)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	_, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.False(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateEntity_InvalidatesIdentifierCache_CacheMiss() {
	entity := s.makeEntity(testEntityID, "client-1")
	entityID := entity.ID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	// providers.Entity is NOT in entityByIDCache — invalidateIdentifierCache must fall back to the store
	// BEFORE the update, so it reads the old attributes.
	s.mockStore.On("GetEntity", mock.Anything, entity.ID).Return(entity, nil).Once()
	s.mockStore.On("UpdateEntity", mock.Anything, &entity).Return(nil).Once()

	err := s.cachedStore.UpdateEntity(context.Background(), &entity)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	_, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	// Old key is evicted, then re-warmed with the (unchanged) entity.
	s.True(ok)
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateAttributeMethods_InvalidateIdentifierCache_CacheMiss() {
	tests := []struct {
		name       string
		storeFn    string
		updateFunc func(ctx context.Context, entityID string, attrs json.RawMessage) error
	}{
		{"UpdateAttributes", "UpdateAttributes", s.cachedStore.UpdateAttributes},
		{"UpdateSystemAttributes", "UpdateSystemAttributes", s.cachedStore.UpdateSystemAttributes},
	}

	for _, tc := range tests {
		s.Run(tc.name, func() {
			entity := s.makeEntity(testEntityID, "client-1")
			entityID := entity.ID
			s.entityIDByIdentifierData["clientId:client-1"] = &entityID

			// providers.Entity is NOT in entityByIDCache — store fallback happens before the update.
			s.mockStore.On("GetEntity", mock.Anything, entity.ID).Return(entity, nil).Once()
			newAttrs, _ := json.Marshal(map[string]interface{}{"clientId": "new-client"})
			s.mockStore.On(tc.storeFn, mock.Anything, entity.ID,
				json.RawMessage(newAttrs)).Return(nil).Once()

			err := tc.updateFunc(context.Background(), entity.ID, newAttrs)
			s.Nil(err)
			s.mockStore.AssertExpectations(s.T())

			// Old identifier key should be evicted.
			_, ok := s.entityIDByIdentifierCache.Get(context.Background(),
				cache.CacheKey{Key: "clientId:client-1"})
			s.False(ok)
		})
	}
}

func (s *CacheBackedEntityStoreTestSuite) TestUpdateCredentials_DoesNotInvalidateIdentifierCache() {
	entity := s.makeEntity(testEntityID, "client-1")
	s.entityByIDData[entity.ID] = &entity
	entityID := entity.ID
	s.entityIDByIdentifierData["clientId:client-1"] = &entityID

	newCreds := json.RawMessage(`{"key":"new"}`)
	s.mockStore.On("UpdateCredentials", mock.Anything, entity.ID, newCreds).Return(nil).Once()

	err := s.cachedStore.UpdateCredentials(context.Background(), entity.ID, newCreds)
	s.Nil(err)
	s.mockStore.AssertExpectations(s.T())

	cachedID, ok := s.entityIDByIdentifierCache.Get(context.Background(),
		cache.CacheKey{Key: "clientId:client-1"})
	s.True(ok)
	s.Equal(entity.ID, *cachedID)
}
