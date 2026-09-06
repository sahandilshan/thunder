// Copyright 2026 The ThunderID Authors
// SPDX-License-Identifier: Apache-2.0

package granthandlers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// The rule that an entity's own resource server is the default audience for a token whose subject
// is not the client lives in exactly one place: resourceindicators.ResolveAudienceBinding. These
// tests fail if a grant handler starts deciding it for itself.

// grantHandlerSources returns the non-test Go sources of this package, keyed by file name.
func grantHandlerSources(t *testing.T) map[string]string {
	t.Helper()
	entries, err := os.ReadDir(".")
	require.NoError(t, err)

	sources := make(map[string]string, len(entries))
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		content, readErr := os.ReadFile(filepath.Clean(name))
		require.NoError(t, readErr)
		sources[name] = string(content)
	}
	require.NotEmpty(t, sources)
	return sources
}

func TestGrantHandlersDoNotReadTheBoundResourceServerThemselves(t *testing.T) {
	for name, src := range grantHandlerSources(t) {
		assert.NotContains(t, src, "InboundResourceServerID",
			"%s must not read the client's bound resource server; ResolveAudienceBinding owns that rule", name)
	}
}

func TestGrantHandlersDelegateAudienceResolutionToResourceIndicators(t *testing.T) {
	// Each grant that issues an access token from an audience decision must reach it through the
	// shared resolver, and must declare whose identity the token represents.
	expectedSubject := map[string]string{
		"authorization_code.go": "resourceindicators.SubjectPrincipal",
		"token_exchange.go":     "resourceindicators.SubjectPrincipal",
		"jwt_bearer.go":         "resourceindicators.SubjectPrincipal",
		"client_credentials.go": "resourceindicators.SubjectClient",
	}

	sources := grantHandlerSources(t)
	for name, subject := range expectedSubject {
		src, ok := sources[name]
		require.True(t, ok, "%s not found", name)
		assert.Contains(t, src, "resourceindicators.ResolveAudienceBinding", "%s must use the shared resolver", name)
		assert.Contains(t, src, subject, "%s must resolve its audience as %s", name, subject)
	}
}

// The RFC 8707 §2 "absolute URI" rule applies to the caller-supplied resource parameter, not to an
// identifier this server resolved from its own database and recorded on an authorization code or a
// CIBA record. ResolveTargetResourceServer therefore no longer applies it, and every grant handler
// that reads a resource off the token request must check it itself. This test fails if a handler
// starts reading tokenRequest.Resources without doing so.
func TestGrantHandlersValidateCallerSuppliedResourcesAtTheBoundary(t *testing.T) {
	for name, src := range grantHandlerSources(t) {
		if !strings.Contains(src, "tokenRequest.Resources") {
			continue
		}
		assert.Contains(t, src, "resourceindicators.ValidateResourceURIs(tokenRequest.Resources)",
			"%s reads the caller's resource parameter and must validate it at the boundary", name)
	}
}
