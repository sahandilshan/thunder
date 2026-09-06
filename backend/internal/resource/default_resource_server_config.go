// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package resource

import (
	"context"
	"encoding/json"
)

// DefaultResourceServerConfig contains the default resource server configuration.
type DefaultResourceServerConfig struct {
	ResourceServerID string `json:"resourceServerId" yaml:"resourceServerId"`
}

// DefaultResourceServerConfigHandler handles default resource server configuration.
type DefaultResourceServerConfigHandler struct {
	resourceService ResourceServiceInterface
}

// NewDefaultResourceServerConfigHandler creates a default resource server configuration handler.
func NewDefaultResourceServerConfigHandler(
	resourceService ResourceServiceInterface,
) *DefaultResourceServerConfigHandler {
	if resourceService == nil {
		panic("default resource server config handler requires a non-nil resource service")
	}
	return &DefaultResourceServerConfigHandler{resourceService: resourceService}
}

// Decode parses a default resource server configuration.
func (*DefaultResourceServerConfigHandler) Decode(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return DefaultResourceServerConfig{}, nil
	}
	var cfg DefaultResourceServerConfig
	if err := json.Unmarshal(raw, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

// Validate validates a default resource server configuration.
func (h *DefaultResourceServerConfigHandler) Validate(incoming, readOnly, _ any) error {
	cfg, _ := incoming.(DefaultResourceServerConfig)
	if ro, ok := readOnly.(DefaultResourceServerConfig); ok && ro.ResourceServerID != "" {
		return errDeclarativeDefaultLocked
	}
	if cfg.ResourceServerID == "" {
		return nil
	}
	rs, svcErr := h.resourceService.GetResourceServer(context.Background(), cfg.ResourceServerID)
	if svcErr != nil {
		if svcErr.Code == ErrorResourceServerNotFound.Code {
			return errUnknownDefaultResourceServer
		}
		return errDefaultResourceServerLookupFailed
	}
	// A resource server owned by an agent or application backs that entity's inbound access, so
	// pointing the deployment default at it would resolve every unscoped request to that one
	// entity's audience. It also follows the owning entity's lifecycle: deleting the entity deletes
	// the resource server and would leave this configuration pointing at nothing.
	if rs.Type.IsEntityOwned() {
		return errEntityOwnedDefaultResourceServer
	}
	return nil
}

// Merge combines read-only and writable default resource server configurations.
func (*DefaultResourceServerConfigHandler) Merge(readOnly, writable any) any {
	if ro, ok := readOnly.(DefaultResourceServerConfig); ok && ro.ResourceServerID != "" {
		return ro
	}
	if w, ok := writable.(DefaultResourceServerConfig); ok {
		return w
	}
	return DefaultResourceServerConfig{}
}
