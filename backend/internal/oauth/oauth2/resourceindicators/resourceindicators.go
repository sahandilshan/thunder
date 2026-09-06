// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

// Package resourceindicators provides shared helpers for RFC 8707 resource indicator
// processing across OAuth 2.0 grant handlers and the authorization endpoint.
package resourceindicators

import (
	"context"
	"net/url"

	tidcommon "github.com/thunder-id/thunderid/pkg/thunderidengine/common"
	"github.com/thunder-id/thunderid/pkg/thunderidengine/providers"

	"github.com/thunder-id/thunderid/internal/oauth/oauth2/constants"
	"github.com/thunder-id/thunderid/internal/oauth/oauth2/model"
	"github.com/thunder-id/thunderid/internal/system/log"
)

// ValidateResourceURIs returns an error response when any resource URI is not absolute
// or contains a fragment component (RFC 8707 §2, RFC 3986 §4.3).
//
// RFC 8707 constrains the "resource" *request parameter*, so this belongs at the boundary where a
// caller-supplied value enters: the authorization request validator, the PAR push, the CIBA
// backchannel request, and each grant handler's read of the token request. It must not be applied to
// an identifier this server resolved from its own database and recorded on an authorization code or
// a CIBA record. Those identifiers are not request parameters and are not required to be absolute
// URIs — the default identifier of an entity's inbound access is the bare entity ID.
func ValidateResourceURIs(resources []string) *model.ErrorResponse {
	for _, res := range resources {
		parsedURI, err := url.Parse(res)
		if err != nil || parsedURI.Scheme == "" {
			return &model.ErrorResponse{
				Error:            constants.ErrorInvalidTarget,
				ErrorDescription: "Invalid resource parameter: must be an absolute URI",
			}
		}
		if parsedURI.Fragment != "" {
			return &model.ErrorResponse{
				Error:            constants.ErrorInvalidTarget,
				ErrorDescription: "Invalid resource parameter: must not contain a fragment component",
			}
		}
	}
	return nil
}

// ResolveTargetResourceServer resolves the single target Resource Server for a token request.
// At most one resource is allowed; more than one is invalid_target. When exactly one resource is
// supplied it is resolved by identifier. When none is supplied an empty identifier is passed to the
// provider, which (when default-aware) resolves the deployment's configured default resource server;
// if no default is configured the request is rejected (invalid_target) — token issuance is bound to
// exactly one resource server.
//
// Resources are resolved as-is. Caller-supplied values must already have been checked with
// ValidateResourceURIs at the boundary that received them; see that function for why the check does
// not belong here.
func ResolveTargetResourceServer(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	resources []string,
) (*providers.ResourceServer, *model.ErrorResponse) {
	if len(resources) > 1 {
		return nil, &model.ErrorResponse{
			Error:            constants.ErrorInvalidTarget,
			ErrorDescription: "Only a single resource parameter is supported",
		}
	}
	if resourceService == nil {
		return nil, &model.ErrorResponse{
			Error:            constants.ErrorInvalidTarget,
			ErrorDescription: "No resource parameter supplied and no default resource server is configured",
		}
	}

	identifier := ""
	invalidTargetDescription := "No resource parameter supplied and no default resource server is configured"
	if len(resources) == 1 {
		identifier = resources[0]
		invalidTargetDescription = "The resource parameter does not match any registered resource server"
	}
	rs, svcErr := resourceService.GetResourceServerByIdentifier(ctx, identifier)
	if svcErr != nil {
		return nil, resolveTargetError(svcErr, invalidTargetDescription)
	}
	return rs, nil
}

// TokenSubject identifies whose identity the access token being issued represents. It selects
// whether the client's own inbound resource server may act as the default audience.
type TokenSubject string

const (
	// SubjectClient marks a grant whose token subject is the OAuth client itself, which today is
	// only client_credentials. Such a token never defaults to the client's own inbound resource
	// server: a client calling itself is not inbound access.
	SubjectClient TokenSubject = "client"
	// SubjectPrincipal marks a grant whose token subject is a principal signing in to the client
	// (authorization_code, token_exchange, jwt_bearer, ciba). Such a token defaults to the client's
	// own inbound resource server when the client exposes inbound access.
	SubjectPrincipal TokenSubject = "principal"
)

// ResolveAudienceBinding decides the single resource server an access token binds to. It is the one
// place that knows this rule; grant handlers must not derive an audience themselves. Precedence:
//
//  1. an explicit resource, resolved by identifier. This is either the RFC 8707 resource parameter
//     the caller supplied, or the identifier this server resolved earlier in the same exchange and
//     recorded on the authorization code or CIBA record;
//  2. for SubjectPrincipal only, the resource server the client's own entity owns (inbound access);
//  3. the deployment's configured default resource server, when permission scopes are requested;
//  4. otherwise unbound — (nil, nil), and the caller falls back to the client's configured
//     defaultAudience and then to the client_id.
//
// Step 2 is skipped for SubjectClient, so client_credentials keeps its historical chain. It is also
// skipped for a client with no inbound access, so such clients see no behavioral change.
//
// A client that declares an inbound audience but whose reference no longer resolves stops at step 2
// and is unbound. It does not fall through to step 3: the deployment default is a broader audience
// than the one the client declared, and an operator who disabled inbound access to stop a client
// issuing scoped tokens must not get a wider audience instead.
//
// Resources are not re-validated as URIs here; see ValidateResourceURIs.
func ResolveAudienceBinding(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	client *providers.OAuthClient,
	subject TokenSubject,
	resources []string,
	permissionScopes []string,
) (*providers.ResourceServer, *model.ErrorResponse) {
	if len(resources) > 0 {
		return ResolveTargetResourceServer(ctx, resourceService, resources)
	}
	if subject == SubjectPrincipal {
		boundRS, stale, errResp := resolveInboundResourceServer(ctx, resourceService, client)
		if errResp != nil {
			return nil, errResp
		}
		if boundRS != nil {
			return boundRS, nil
		}
		if stale {
			return nil, nil
		}
	}
	if len(permissionScopes) == 0 {
		return nil, nil
	}
	return ResolveTargetResourceServer(ctx, resourceService, nil)
}

// resolveInboundResourceServer resolves the resource server the client's own entity owns. The
// lookup is by the id carried on the client itself, so the resolved resource server is always the
// client's own: this path can never widen a token's audience to another entity's resource server.
//
// The second return value reports a stale reference: the client declares an inbound audience but it
// no longer resolves. Disabling inbound access deletes the resource server before clearing the
// entity's reference to it, so the reference can be stale either transiently or, if the second write
// fails, permanently. Failing the request would take every token grant for the client down with it,
// so the request degrades to unbound instead — but the caller must stop there rather than widen the
// audience to the deployment default.
//
// A client that simply exposes no inbound access returns (nil, false, nil).
func resolveInboundResourceServer(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	client *providers.OAuthClient,
) (*providers.ResourceServer, bool, *model.ErrorResponse) {
	if client == nil || client.InboundResourceServerID == "" || resourceService == nil {
		return nil, false, nil
	}
	rs, svcErr := resourceService.GetResourceServer(ctx, client.InboundResourceServerID)
	if svcErr != nil {
		if svcErr.Type == tidcommon.ServerErrorType {
			return nil, false, &model.ErrorResponse{
				Error:            constants.ErrorServerError,
				ErrorDescription: "Failed to resolve resource server",
			}
		}
		log.GetLogger().With(log.String(log.LoggerKeyComponentName, "ResourceIndicators")).
			Debug(ctx, "Client references a resource server that no longer exists; "+
				"issuing an unbound token instead of widening the audience to the deployment default",
				log.String("clientID", client.ClientID))
		return nil, true, nil
	}
	return rs, false, nil
}

// resolveTargetError maps a resource-service error to invalid_target (client) or server_error.
func resolveTargetError(svcErr *tidcommon.ServiceError, invalidTargetDescription string) *model.ErrorResponse {
	if svcErr.Type == tidcommon.ServerErrorType {
		return &model.ErrorResponse{
			Error:            constants.ErrorServerError,
			ErrorDescription: "Failed to resolve resource server",
		}
	}
	return &model.ErrorResponse{
		Error:            constants.ErrorInvalidTarget,
		ErrorDescription: invalidTargetDescription,
	}
}

// ResolveResourceServers resolves each resource identifier to its registered Resource Server.
// Returns invalid_target on any unknown identifier (RFC 8707 §2.2).
// The returned slice preserves the order of the input identifiers.
func ResolveResourceServers(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	resources []string,
) ([]*providers.ResourceServer, *model.ErrorResponse) {
	if len(resources) == 0 {
		return nil, nil
	}
	resolved := make([]*providers.ResourceServer, 0, len(resources))
	for _, identifier := range resources {
		rs, svcErr := resourceService.GetResourceServerByIdentifier(ctx, identifier)
		if svcErr != nil {
			if svcErr.Type == tidcommon.ServerErrorType {
				return nil, &model.ErrorResponse{
					Error:            constants.ErrorServerError,
					ErrorDescription: "Failed to resolve resource server",
				}
			}
			return nil, &model.ErrorResponse{
				Error:            constants.ErrorInvalidTarget,
				ErrorDescription: "The resource parameter does not match any registered resource server",
			}
		}
		resolved = append(resolved, rs)
	}
	return resolved, nil
}

// ResolveAndDownscope resolves each resource identifier to its registered Resource Server and
// returns the subset of requestedScopes that are defined as permissions on at least one resolved
// RS (RFC 6749 §3.3). Unknown identifiers surface as invalid_target (RFC 8707 §2.2); scopes not
// defined on any RS are silently dropped. The downscoped slice preserves the order of
// requestedScopes. When resources is empty or requestedScopes is empty, scopes are returned
// unchanged.
func ResolveAndDownscope(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	resources []string,
	requestedScopes []string,
) ([]*providers.ResourceServer, []string, *model.ErrorResponse) {
	resolvedRSes, errResp := ResolveResourceServers(ctx, resourceService, resources)
	if errResp != nil {
		return nil, nil, errResp
	}
	if len(resolvedRSes) == 0 || len(requestedScopes) == 0 {
		return resolvedRSes, requestedScopes, nil
	}
	rsValidScopes, errResp := ComputeRSValidScopes(ctx, resourceService, resolvedRSes, requestedScopes)
	if errResp != nil {
		return nil, nil, errResp
	}
	allowed := make(map[string]struct{}, len(requestedScopes))
	for _, scopes := range rsValidScopes {
		for _, s := range scopes {
			allowed[s] = struct{}{}
		}
	}
	downscoped := make([]string, 0, len(requestedScopes))
	for _, s := range requestedScopes {
		if _, ok := allowed[s]; ok {
			downscoped = append(downscoped, s)
			delete(allowed, s)
		}
	}
	return resolvedRSes, downscoped, nil
}

// ComputeRSValidScopes returns, for each resolved Resource Server, the subset of requested
// scopes that are defined as permissions on that RS. Scopes not defined on any RS are absent
// from the union of the per-RS slices (downscoping per RFC 6749 §3.3).
func ComputeRSValidScopes(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	resolvedRSes []*providers.ResourceServer,
	requestedScopes []string,
) (map[string][]string, *model.ErrorResponse) {
	rsValidScopes := make(map[string][]string, len(resolvedRSes))
	if len(requestedScopes) == 0 || len(resolvedRSes) == 0 {
		return rsValidScopes, nil
	}
	for _, rs := range resolvedRSes {
		invalid, valErr := resourceService.ValidatePermissions(ctx, rs.ID, requestedScopes)
		if valErr != nil {
			return nil, &model.ErrorResponse{
				Error:            constants.ErrorServerError,
				ErrorDescription: "Failed to validate permissions",
			}
		}
		invalidSet := make(map[string]struct{}, len(invalid))
		for _, p := range invalid {
			invalidSet[p] = struct{}{}
		}
		valid := make([]string, 0, len(requestedScopes))
		for _, p := range requestedScopes {
			if _, isInvalid := invalidSet[p]; !isInvalid {
				valid = append(valid, p)
			}
		}
		rsValidScopes[rs.ID] = valid
	}
	return rsValidScopes, nil
}

// DownscopeToResourceServer returns the subset of scopes that are defined as permissions on the
// given resource server (RFC 6749 §3.3). Scopes not defined on the RS are dropped. Order of the
// input scopes is preserved. When scopes is empty it is returned unchanged.
func DownscopeToResourceServer(
	ctx context.Context,
	resourceService providers.ResourceServerProvider,
	resourceServerID string,
	scopes []string,
) ([]string, *model.ErrorResponse) {
	if len(scopes) == 0 {
		return scopes, nil
	}
	invalid, svcErr := resourceService.ValidatePermissions(ctx, resourceServerID, scopes)
	if svcErr != nil {
		return nil, &model.ErrorResponse{
			Error:            constants.ErrorServerError,
			ErrorDescription: "Failed to validate permissions",
		}
	}
	invalidSet := make(map[string]struct{}, len(invalid))
	for _, p := range invalid {
		invalidSet[p] = struct{}{}
	}
	valid := make([]string, 0, len(scopes))
	for _, s := range scopes {
		if _, isInvalid := invalidSet[s]; !isInvalid {
			valid = append(valid, s)
		}
	}
	return valid, nil
}
