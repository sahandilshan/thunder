// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package resourceindicators

import (
	"context"
	"testing"

	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/suite"

	"github.com/thunder-id/thunderid/internal/oauth/oauth2/constants"
	"github.com/thunder-id/thunderid/tests/mocks/resourcemock"
)

type ResourceIndicatorsTestSuite struct {
	suite.Suite
	mockResourceService *resourcemock.ResourceServiceInterfaceMock
}

func TestResourceIndicatorsTestSuite(t *testing.T) {
	suite.Run(t, new(ResourceIndicatorsTestSuite))
}

func (suite *ResourceIndicatorsTestSuite) SetupTest() {
	suite.mockResourceService = resourcemock.NewResourceServiceInterfaceMock(suite.T())
}

// ValidateResourceURIs tests

func (suite *ResourceIndicatorsTestSuite) TestValidateResourceURIs_Valid() {
	err := ValidateResourceURIs([]string{"https://api.example.com/resource"})
	assert.Nil(suite.T(), err)
}

func (suite *ResourceIndicatorsTestSuite) TestValidateResourceURIs_Empty() {
	err := ValidateResourceURIs([]string{})
	assert.Nil(suite.T(), err)
}

func (suite *ResourceIndicatorsTestSuite) TestValidateResourceURIs_MissingScheme() {
	err := ValidateResourceURIs([]string{"api.example.com/resource"})
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestValidateResourceURIs_WithFragment() {
	err := ValidateResourceURIs([]string{"https://api.example.com/resource#frag"})
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
	assert.Contains(suite.T(), err.ErrorDescription, "fragment")
}

func (suite *ResourceIndicatorsTestSuite) TestValidateResourceURIs_InvalidURI() {
	err := ValidateResourceURIs([]string{"://bad"})
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

// ResolveResourceServers tests

func (suite *ResourceIndicatorsTestSuite) TestResolveResourceServers_Empty() {
	resolved, err := ResolveResourceServers(context.Background(), suite.mockResourceService, []string{})
	assert.Nil(suite.T(), err)
	assert.Nil(suite.T(), resolved)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveResourceServers_Found() {
	rs := providers.ResourceServer{ID: "rs01", Identifier: "https://api.example.com"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://api.example.com").
		Return(&rs, nil)

	resolved, err := ResolveResourceServers(context.Background(), suite.mockResourceService,
		[]string{"https://api.example.com"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), []*providers.ResourceServer{&rs}, resolved)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveResourceServers_NotFound_ReturnsInvalidTarget() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RSE-4041"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://unknown.example.com").
		Return(nil, svcErr)

	resolved, err := ResolveResourceServers(context.Background(), suite.mockResourceService,
		[]string{"https://unknown.example.com"})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveResourceServers_StoreFailure_ReturnsServerError() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ServerErrorType, Code: "SSE-5000"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://api.example.com").
		Return(nil, svcErr)

	resolved, err := ResolveResourceServers(context.Background(), suite.mockResourceService,
		[]string{"https://api.example.com"})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorServerError, err.Error)
	assert.Equal(suite.T(), "Failed to resolve resource server", err.ErrorDescription)
}

// ResolveTargetResourceServer tests

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_SingleResource_Resolves() {
	rs := providers.ResourceServer{ID: "rs01", Identifier: "https://api.example.com"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://api.example.com").
		Return(&rs, nil)

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{"https://api.example.com"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), &rs, resolved)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_MultipleResources_ReturnsInvalidTarget() {
	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{"https://a.example.com", "https://b.example.com"})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_UnknownIdentifier_ReturnsInvalidTarget() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RSE-4041"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://unknown.example.com").
		Return(nil, svcErr)

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{"https://unknown.example.com"})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_LookupServerError_ReturnsServerError() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ServerErrorType, Code: "SSE-5000"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://api.example.com").
		Return(nil, svcErr)

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{"https://api.example.com"})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorServerError, err.Error)
}

// When no resource is supplied, the resolver asks the provider to resolve the empty identifier; a
// default-aware provider turns this into the deployment's configured default resource server.
func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_NoResource_ProviderResolvesDefault() {
	rs := providers.ResourceServer{ID: "rs-1", Identifier: "https://api.example.com"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(&rs, nil)

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), &rs, resolved)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_NoResource_ProviderClientError() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RSE-4041"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(nil, svcErr)

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_NoResource_ProviderServerError() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ServerErrorType, Code: "SCE-5000"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(nil, svcErr)

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorServerError, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_NilResourceService_ReturnsInvalidTarget() {
	resolved, err := ResolveTargetResourceServer(context.Background(), nil, []string{})

	assert.Nil(suite.T(), resolved)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

// DownscopeToResourceServer tests

func (suite *ResourceIndicatorsTestSuite) TestDownscopeToResourceServer_DropsInvalidScopes() {
	suite.mockResourceService.On("ValidatePermissions", mock.Anything, "rs01", []string{"read", "write", "delete"}).
		Return([]string{"write"}, nil)

	scopes, err := DownscopeToResourceServer(context.Background(), suite.mockResourceService, "rs01",
		[]string{"read", "write", "delete"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), []string{"read", "delete"}, scopes)
}

func (suite *ResourceIndicatorsTestSuite) TestDownscopeToResourceServer_PreservesOrder() {
	suite.mockResourceService.On("ValidatePermissions", mock.Anything, "rs01", []string{"c", "a", "b"}).
		Return([]string{}, nil)

	scopes, err := DownscopeToResourceServer(context.Background(), suite.mockResourceService, "rs01",
		[]string{"c", "a", "b"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), []string{"c", "a", "b"}, scopes)
}

func (suite *ResourceIndicatorsTestSuite) TestDownscopeToResourceServer_EmptyScopes_Unchanged() {
	scopes, err := DownscopeToResourceServer(context.Background(), suite.mockResourceService, "rs01",
		[]string{})

	assert.Nil(suite.T(), err)
	assert.Empty(suite.T(), scopes)
}

func (suite *ResourceIndicatorsTestSuite) TestDownscopeToResourceServer_ValidatePermissionsError_ReturnsServerError() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ServerErrorType, Code: "RSE-5000"}
	suite.mockResourceService.On("ValidatePermissions", mock.Anything, "rs01", []string{"read"}).
		Return(nil, svcErr)

	scopes, err := DownscopeToResourceServer(context.Background(), suite.mockResourceService, "rs01",
		[]string{"read"})

	assert.Nil(suite.T(), scopes)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorServerError, err.Error)
}

// ComputeRSValidScopes tests

func (suite *ResourceIndicatorsTestSuite) TestComputeRSValidScopes_Empty() {
	result, err := ComputeRSValidScopes(context.Background(), suite.mockResourceService,
		[]*providers.ResourceServer{}, []string{"read"})
	assert.Nil(suite.T(), err)
	assert.Empty(suite.T(), result)
}

func (suite *ResourceIndicatorsTestSuite) TestComputeRSValidScopes_DropsInvalidPerRS() {
	rs := &providers.ResourceServer{ID: "rs01", Identifier: "https://rs01.example.com"}
	suite.mockResourceService.On("ValidatePermissions", mock.Anything, "rs01", []string{"read", "write"}).
		Return([]string{"write"}, nil)

	result, err := ComputeRSValidScopes(context.Background(), suite.mockResourceService,
		[]*providers.ResourceServer{rs}, []string{"read", "write"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), map[string][]string{"rs01": {"read"}}, result)
}

func (suite *ResourceIndicatorsTestSuite) TestComputeRSValidScopes_ValidatePermissionsError_ReturnsServerError() {
	rs := &providers.ResourceServer{ID: "rs01", Identifier: "https://rs01.example.com"}
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ServerErrorType, Code: "RSE-5000"}
	suite.mockResourceService.On("ValidatePermissions", mock.Anything, "rs01", []string{"read"}).
		Return(nil, svcErr)

	result, err := ComputeRSValidScopes(context.Background(), suite.mockResourceService,
		[]*providers.ResourceServer{rs}, []string{"read"})

	assert.Nil(suite.T(), result)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorServerError, err.Error)
}

// ResolveAndDownscope tests

func (suite *ResourceIndicatorsTestSuite) TestResolveAndDownscope_NoResources_Unchanged() {
	resolved, scopes, err := ResolveAndDownscope(context.Background(), suite.mockResourceService,
		[]string{}, []string{"read", "write"})

	assert.Nil(suite.T(), err)
	assert.Nil(suite.T(), resolved)
	assert.Equal(suite.T(), []string{"read", "write"}, scopes)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAndDownscope_Downscopes() {
	rs := providers.ResourceServer{ID: "rs01", Identifier: "https://rs01.example.com"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://rs01.example.com").
		Return(&rs, nil)
	suite.mockResourceService.On("ValidatePermissions", mock.Anything, "rs01", []string{"read", "write"}).
		Return([]string{"write"}, nil)

	resolved, scopes, err := ResolveAndDownscope(context.Background(), suite.mockResourceService,
		[]string{"https://rs01.example.com"}, []string{"read", "write"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), []*providers.ResourceServer{&rs}, resolved)
	assert.Equal(suite.T(), []string{"read"}, scopes)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAndDownscope_UnknownIdentifier_ReturnsInvalidTarget() {
	svcErr := &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RSE-4041"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://unknown.example.com").
		Return(nil, svcErr)

	resolved, scopes, err := ResolveAndDownscope(context.Background(), suite.mockResourceService,
		[]string{"https://unknown.example.com"}, []string{"read"})

	assert.Nil(suite.T(), resolved)
	assert.Nil(suite.T(), scopes)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

// The resolver resolves identifiers as-is; a value that is not an absolute URI is simply looked up
// and reported as unknown. The RFC 8707 §2 shape rule is enforced at the boundary that receives
// caller input, so that an identifier this server recorded itself is not judged by it.
func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_NonURIResolvesAsIdentifier() {
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "api.example.com/resource").
		Return(nil, &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RS-1002"})

	resolved, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService,
		[]string{"api.example.com/resource"})

	assert.Nil(suite.T(), resolved)
	suite.Require().NotNil(err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

// ResolveAudienceBinding tests

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_NoResourceNoPermissionScopes_ReturnsNil() {
	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		&providers.OAuthClient{}, SubjectPrincipal, nil, nil)

	assert.Nil(suite.T(), rs)
	assert.Nil(suite.T(), err)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_PermissionScopes_ResolvesDefault() {
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(&providers.ResourceServer{ID: "rs-1", Identifier: "https://api.example.com"}, nil)

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		&providers.OAuthClient{}, SubjectPrincipal, nil, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.NotNil(suite.T(), rs)
	assert.Equal(suite.T(), "rs-1", rs.ID)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_ExplicitResourceNoPermissionScopes_Resolves() {
	rs := providers.ResourceServer{ID: "rs01", Identifier: "https://api.example.com"}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://api.example.com").
		Return(&rs, nil)

	resolved, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		&providers.OAuthClient{}, SubjectPrincipal, []string{"https://api.example.com"}, nil)

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), &rs, resolved)
}

// ResolveAudienceBinding — inbound resource server (entity inbound access) tests

const (
	testInboundRSID         = "inbound-rs-id"
	testInboundRSIdentifier = "https://agent.example.com"
	testOtherRSIdentifier   = "https://other.example.com"
)

// inboundClient returns a client whose own entity owns testInboundRSID.
func inboundClient() *providers.OAuthClient {
	return &providers.OAuthClient{ClientID: "client-1", InboundResourceServerID: testInboundRSID}
}

func (suite *ResourceIndicatorsTestSuite) stubInboundResourceServer() {
	suite.mockResourceService.On("GetResourceServer", mock.Anything, testInboundRSID).
		Return(&providers.ResourceServer{ID: testInboundRSID, Identifier: testInboundRSIdentifier}, nil)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_PrincipalBoundRSNoResourceNoScopes() {
	suite.stubInboundResourceServer()

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, nil, nil)

	assert.Nil(suite.T(), err)
	assert.NotNil(suite.T(), rs)
	assert.Equal(suite.T(), testInboundRSIdentifier, rs.Identifier)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_PrincipalBoundRSWinsOverDeploymentDefault() {
	suite.stubInboundResourceServer()

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, nil, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.NotNil(suite.T(), rs)
	assert.Equal(suite.T(), testInboundRSID, rs.ID)
	suite.mockResourceService.AssertNotCalled(suite.T(), "GetResourceServerByIdentifier", mock.Anything, "")
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_ExplicitResourceWinsOverBoundRS() {
	other := providers.ResourceServer{ID: "other-rs", Identifier: testOtherRSIdentifier}
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, testOtherRSIdentifier).
		Return(&other, nil)

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, []string{testOtherRSIdentifier}, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), &other, rs)
	suite.mockResourceService.AssertNotCalled(suite.T(), "GetResourceServer", mock.Anything, testInboundRSID)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_ClientSubjectIgnoresBoundRS() {
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(&providers.ResourceServer{ID: "default-rs", Identifier: "https://default.example.com"}, nil)

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectClient, nil, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), "default-rs", rs.ID)
	suite.mockResourceService.AssertNotCalled(suite.T(), "GetResourceServer", mock.Anything, testInboundRSID)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_ClientSubjectNoScopesStaysUnbound() {
	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectClient, nil, nil)

	assert.Nil(suite.T(), err)
	assert.Nil(suite.T(), rs)
	suite.mockResourceService.AssertNotCalled(suite.T(), "GetResourceServer", mock.Anything, testInboundRSID)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_NoBoundRSPrincipalStaysUnbound() {
	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		&providers.OAuthClient{ClientID: "client-1"}, SubjectPrincipal, nil, nil)

	assert.Nil(suite.T(), err)
	assert.Nil(suite.T(), rs)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_NoBoundRSPrincipalUsesDeploymentDefault() {
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(&providers.ResourceServer{ID: "default-rs", Identifier: "https://default.example.com"}, nil)

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		&providers.OAuthClient{ClientID: "client-1"}, SubjectPrincipal, nil, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), "default-rs", rs.ID)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_NilClientStaysUnbound() {
	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		nil, SubjectPrincipal, nil, nil)

	assert.Nil(suite.T(), err)
	assert.Nil(suite.T(), rs)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_BoundRSLookupFailureIsServerError() {
	suite.mockResourceService.On("GetResourceServer", mock.Anything, testInboundRSID).
		Return(nil, &tidcommon.ServiceError{Type: tidcommon.ServerErrorType, Code: "RS-5000"})

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, nil, nil)

	assert.Nil(suite.T(), rs)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorServerError, err.Error)
}

// Disabling inbound access deletes the resource server before clearing the entity's reference, so a
// client can point at a deleted resource server. That must degrade to "no inbound access" rather
// than failing every token request for the client.
func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_BoundRSNotFoundStaysUnbound() {
	suite.mockResourceService.On("GetResourceServer", mock.Anything, testInboundRSID).
		Return(nil, &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RS-1002"})

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, nil, nil)

	assert.Nil(suite.T(), rs)
	assert.Nil(suite.T(), err)
}

// A stale reference must not fall through to the deployment default. The client declared an inbound
// audience; substituting the deployment-wide one would be broader than what it declared, and would
// give an operator who disabled inbound access the opposite of what they intended.
func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_BoundRSNotFoundStaysUnboundForScopedRequest() {
	suite.mockResourceService.On("GetResourceServer", mock.Anything, testInboundRSID).
		Return(nil, &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RS-1002"})

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, nil, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.Nil(suite.T(), rs)
	suite.mockResourceService.AssertNotCalled(suite.T(), "GetResourceServerByIdentifier", mock.Anything, "")
}

// A client with no inbound access at all still reaches the deployment default, which is the
// behavior the stale-reference case deliberately diverges from.
func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_NoInboundAccessFallsBackToDefault() {
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "").
		Return(&providers.ResourceServer{ID: "default-rs", Identifier: "https://default.example.com"}, nil)

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		&providers.OAuthClient{ClientID: "client-1"}, SubjectPrincipal, nil, []string{"read"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), "default-rs", rs.ID)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_BoundRSIsOnlyEverTheClientsOwn() {
	// The bound resource server is looked up by the id carried on the client itself, so a client can
	// never obtain a token audienced to another entity's resource server through this path.
	var lookedUpIDs []string
	suite.mockResourceService.On("GetResourceServer", mock.Anything, mock.Anything).
		Return(func(_ context.Context, id string) *providers.ResourceServer {
			lookedUpIDs = append(lookedUpIDs, id)
			return &providers.ResourceServer{ID: id, Identifier: testInboundRSIdentifier}
		}, func(_ context.Context, _ string) *tidcommon.ServiceError { return nil })

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, nil, []string{"other-entity:read"})

	assert.Nil(suite.T(), err)
	assert.Equal(suite.T(), testInboundRSID, rs.ID)
	assert.Equal(suite.T(), []string{testInboundRSID}, lookedUpIDs)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_UnknownResourceStillRejected() {
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, "https://unknown.example.com").
		Return(nil, &tidcommon.ServiceError{Type: tidcommon.ClientErrorType, Code: "RS-1002"})

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, []string{"https://unknown.example.com"}, nil)

	assert.Nil(suite.T(), rs)
	suite.Require().NotNil(err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_MultipleResourcesStillRejected() {
	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal,
		[]string{"https://a.example.com", "https://b.example.com"}, nil)

	assert.Nil(suite.T(), rs)
	assert.NotNil(suite.T(), err)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, err.Error)
}

// The default identifier of an entity's inbound access is the bare entity ID, which is not an
// absolute URI. The authorization endpoint records that identifier on the authorization code and the
// token endpoint resolves it back, so the resolver must accept it. Re-applying the RFC 8707 §2
// caller-input rule here would break every bodyless enable-with-defaults deployment, and only after
// the user had already authenticated.
func (suite *ResourceIndicatorsTestSuite) TestResolveTargetResourceServer_AcceptsRecordedBareEntityIDIdentifier() {
	bareID := "01997c1e-0f5a-7a3c-9b2e-9f1c4c2d5e60"
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, bareID).
		Return(&providers.ResourceServer{ID: testInboundRSID, Identifier: bareID}, nil)

	rs, err := ResolveTargetResourceServer(context.Background(), suite.mockResourceService, []string{bareID})

	assert.Nil(suite.T(), err)
	suite.Require().NotNil(rs)
	assert.Equal(suite.T(), bareID, rs.Identifier)
}

func (suite *ResourceIndicatorsTestSuite) TestResolveAudienceBinding_AcceptsRecordedNonURIIdentifier() {
	bareID := "calendar-agent-api"
	suite.mockResourceService.On("GetResourceServerByIdentifier", mock.Anything, bareID).
		Return(&providers.ResourceServer{ID: testInboundRSID, Identifier: bareID}, nil)

	rs, err := ResolveAudienceBinding(context.Background(), suite.mockResourceService,
		inboundClient(), SubjectPrincipal, []string{bareID}, []string{"read"})

	assert.Nil(suite.T(), err)
	suite.Require().NotNil(rs)
	assert.Equal(suite.T(), bareID, rs.Identifier)
}

// The caller-input rule itself is unchanged: a non-absolute URI supplied as a resource parameter is
// still invalid_target, it is just enforced at the boundary that receives it.
func (suite *ResourceIndicatorsTestSuite) TestValidateResourceURIs_StillRejectsCallerSuppliedNonURI() {
	for _, res := range []string{"01997c1e-0f5a-7a3c-9b2e-9f1c4c2d5e60", "calendar-agent-api", "/orders"} {
		errResp := ValidateResourceURIs([]string{res})
		suite.Require().NotNil(errResp, res)
		assert.Equal(suite.T(), constants.ErrorInvalidTarget, errResp.Error)
	}
	errResp := ValidateResourceURIs([]string{"https://api.example.com/orders#frag"})
	suite.Require().NotNil(errResp)
	assert.Equal(suite.T(), constants.ErrorInvalidTarget, errResp.Error)
}
