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

	"github.com/thunder-id/thunderid/internal/system/resourcedependency"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"
)

type ResourceServerOwnerLookupTestSuite struct {
	suite.Suite
}

func TestResourceServerOwnerLookupTestSuite(t *testing.T) {
	suite.Run(t, new(ResourceServerOwnerLookupTestSuite))
}

func (s *ResourceServerOwnerLookupTestSuite) TestEmptyResourceServerIDReportsNoOwner() {
	lookup := NewResourceServerOwnerLookup(NewEntityServiceInterfaceMock(s.T()))

	owner, err := lookup.GetResourceServerOwner(context.Background(), "")

	s.Require().NoError(err)
	s.Nil(owner)
}

func (s *ResourceServerOwnerLookupTestSuite) TestNoReferencingEntityReportsNoOwner() {
	svc := NewEntityServiceInterfaceMock(s.T())
	svc.On("GetEntitiesByResourceServerID", mock.Anything, "rs-1").
		Return([]providers.Entity{}, nil)

	owner, err := NewResourceServerOwnerLookup(svc).
		GetResourceServerOwner(context.Background(), "rs-1")

	s.Require().NoError(err)
	s.Nil(owner)
}

func (s *ResourceServerOwnerLookupTestSuite) TestAgentOwnerResolvedWithDisplayName() {
	sysAttrs, err := json.Marshal(map[string]interface{}{"name": "My Agent"})
	s.Require().NoError(err)

	svc := NewEntityServiceInterfaceMock(s.T())
	svc.On("GetEntitiesByResourceServerID", mock.Anything, "rs-1").
		Return([]providers.Entity{{
			ID: "agent-1", Category: providers.EntityCategoryAgent, SystemAttributes: sysAttrs,
		}}, nil)

	owner, err := NewResourceServerOwnerLookup(svc).
		GetResourceServerOwner(context.Background(), "rs-1")

	s.Require().NoError(err)
	s.Require().NotNil(owner)
	s.Equal(resourcedependency.ResourceTypeAgent, owner.Type)
	s.Equal("agent-1", owner.ID)
	s.Equal("My Agent", owner.Name)
}

func (s *ResourceServerOwnerLookupTestSuite) TestApplicationOwnerResolved() {
	svc := NewEntityServiceInterfaceMock(s.T())
	svc.On("GetEntitiesByResourceServerID", mock.Anything, "rs-1").
		Return([]providers.Entity{{ID: "app-1", Category: providers.EntityCategoryApp}}, nil)

	owner, err := NewResourceServerOwnerLookup(svc).
		GetResourceServerOwner(context.Background(), "rs-1")

	s.Require().NoError(err)
	s.Require().NotNil(owner)
	s.Equal(resourcedependency.ResourceTypeApplication, owner.Type)
	s.Empty(owner.Name)
}

func (s *ResourceServerOwnerLookupTestSuite) TestNonOwningCategoryIgnored() {
	svc := NewEntityServiceInterfaceMock(s.T())
	svc.On("GetEntitiesByResourceServerID", mock.Anything, "rs-1").
		Return([]providers.Entity{{ID: "user-1", Category: providers.EntityCategoryUser}}, nil)

	owner, err := NewResourceServerOwnerLookup(svc).
		GetResourceServerOwner(context.Background(), "rs-1")

	s.Require().NoError(err)
	s.Nil(owner)
}

func (s *ResourceServerOwnerLookupTestSuite) TestLookupErrorPropagated() {
	svc := NewEntityServiceInterfaceMock(s.T())
	svc.On("GetEntitiesByResourceServerID", mock.Anything, "rs-1").
		Return([]providers.Entity(nil), errors.New("db error"))

	owner, err := NewResourceServerOwnerLookup(svc).
		GetResourceServerOwner(context.Background(), "rs-1")

	s.Require().Error(err)
	s.Nil(owner)
}

func (s *ResourceServerOwnerLookupTestSuite) TestDisplayNameFromSystemAttributes() {
	s.Empty(displayNameFromSystemAttributes(nil))
	s.Empty(displayNameFromSystemAttributes(json.RawMessage(`{bad`)))
	s.Empty(displayNameFromSystemAttributes(json.RawMessage(`{}`)))
	s.Equal("My Agent", displayNameFromSystemAttributes(json.RawMessage(`{"name":"My Agent"}`)))
}
