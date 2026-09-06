// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package entity

import (
	"context"
	"encoding/json"

	"github.com/thunder-id/thunderid/internal/resource"
	"github.com/thunder-id/thunderid/internal/system/resourcedependency"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"
)

// systemAttributeName is the system attribute holding an agent's or application's display name.
const systemAttributeName = "name"

// resourceServerOwnerLookup implements resource.EntityOwnerLookup using the entity service. It
// keeps the resource package free of a dependency on the entity package: ownership is resolved by
// looking up the entity that references the resource server, never by inspecting the resource
// server's type.
type resourceServerOwnerLookup struct {
	entityService EntityServiceInterface
}

// NewResourceServerOwnerLookup creates the resource server owner lookup backed by the entity
// service. Wired into the resource service by servicemanager.
func NewResourceServerOwnerLookup(entityService EntityServiceInterface) resource.EntityOwnerLookup {
	return &resourceServerOwnerLookup{entityService: entityService}
}

// GetResourceServerOwner returns the entity that owns the resource server, or nil when the resource
// server is standalone. At most one entity may reference a resource server, so the first match is
// authoritative.
func (l *resourceServerOwnerLookup) GetResourceServerOwner(
	ctx context.Context, resourceServerID string,
) (*resource.ResourceServerOwner, error) {
	if resourceServerID == "" {
		return nil, nil
	}

	entities, err := l.entityService.GetEntitiesByResourceServerID(ctx, resourceServerID)
	if err != nil {
		return nil, err
	}

	for i := range entities {
		ownerType, ok := ownerResourceType(entities[i].Category)
		if !ok {
			continue
		}
		return &resource.ResourceServerOwner{
			Type: ownerType,
			ID:   entities[i].ID,
			Name: displayNameFromSystemAttributes(entities[i].SystemAttributes),
		}, nil
	}

	return nil, nil
}

// ownerResourceType maps an entity category to its dependency resource type. Only agents and
// applications may own a resource server.
func ownerResourceType(category providers.EntityCategory) (string, bool) {
	switch category {
	case providers.EntityCategoryAgent:
		return resourcedependency.ResourceTypeAgent, true
	case providers.EntityCategoryApp:
		return resourcedependency.ResourceTypeApplication, true
	default:
		return "", false
	}
}

// displayNameFromSystemAttributes extracts the display name stored in an entity's system
// attributes; returns an empty string when absent or unparsable.
func displayNameFromSystemAttributes(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var attrs map[string]interface{}
	if err := json.Unmarshal(raw, &attrs); err != nil {
		return ""
	}
	name, _ := attrs[systemAttributeName].(string)
	return name
}
