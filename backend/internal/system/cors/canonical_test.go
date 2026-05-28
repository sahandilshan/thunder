/*
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package cors

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

type CanonicalTestSuite struct {
	suite.Suite
}

func TestCanonicalTestSuite(t *testing.T) {
	suite.Run(t, new(CanonicalTestSuite))
}

func (suite *CanonicalTestSuite) TestHTTPSNoPortKeptPortless() {
	got, err := canonicalize("https://example.com")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "https://example.com", got)
}

func (suite *CanonicalTestSuite) TestHTTPNoPortKeptPortless() {
	got, err := canonicalize("http://example.com")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "http://example.com", got)
}

func (suite *CanonicalTestSuite) TestHTTPSDefaultPortPreserved() {
	got, err := canonicalize("https://example.com:443")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "https://example.com:443", got)
}

func (suite *CanonicalTestSuite) TestHTTPDefaultPortPreserved() {
	got, err := canonicalize("http://example.com:80")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "http://example.com:80", got)
}

func (suite *CanonicalTestSuite) TestExplicitPortPreserved() {
	got, err := canonicalize("https://example.com:8443")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "https://example.com:8443", got)
}

func (suite *CanonicalTestSuite) TestSchemeAndHostLowercased() {
	got, err := canonicalize("HTTPS://Example.COM:443")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "https://example.com:443", got)
}

func (suite *CanonicalTestSuite) TestExplicitDefaultPortDistinctFromImplicit() {
	// The operator owns the port spelling: portless and default-port forms are
	// canonicalized as distinct origins so the literal-rule list stays
	// explicit about which variants are allowed.
	a, errA := canonicalize("https://example.com")
	suite.Require().NoError(errA)
	b, errB := canonicalize("https://example.com:443")
	suite.Require().NoError(errB)
	assert.NotEqual(suite.T(), a, b)
	assert.Equal(suite.T(), "https://example.com", a)
	assert.Equal(suite.T(), "https://example.com:443", b)
}

func (suite *CanonicalTestSuite) TestEmptyRejected() {
	_, err := canonicalize("")
	suite.Require().Error(err)
	assert.True(suite.T(), errors.Is(err, ErrInvalidOrigin))
}

func (suite *CanonicalTestSuite) TestUnsupportedSchemeRejected() {
	_, err := canonicalize("ftp://example.com")
	suite.Require().Error(err)
	assert.True(suite.T(), errors.Is(err, ErrInvalidOrigin))
}

func (suite *CanonicalTestSuite) TestMissingHostRejected() {
	_, err := canonicalize("https://")
	suite.Require().Error(err)
	assert.True(suite.T(), errors.Is(err, ErrInvalidOrigin))
}

func (suite *CanonicalTestSuite) TestTrailingDotStripped() {
	// FQDN-with-trailing-dot must canonicalize the same as the bare host.
	a, errA := canonicalize("https://example.com.")
	suite.Require().NoError(errA)
	b, errB := canonicalize("https://example.com")
	suite.Require().NoError(errB)
	assert.Equal(suite.T(), b, a)
}

func (suite *CanonicalTestSuite) TestIDNUnicodeAndPunycodeEqual() {
	// Unicode form and Punycode form must produce the same canonical key
	// so a literal-rule match is consistent regardless of how the operator
	// or browser spelled the host.
	uni, errA := canonicalize("https://münchen.example")
	suite.Require().NoError(errA)
	puny, errB := canonicalize("https://xn--mnchen-3ya.example")
	suite.Require().NoError(errB)
	assert.Equal(suite.T(), puny, uni)
}

func (suite *CanonicalTestSuite) TestIPv6HostBracketed() {
	got, err := canonicalize("https://[::1]:8443")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "https://[::1]:8443", got)
}

func (suite *CanonicalTestSuite) TestIPv6HostNoPortBracketedNoPort() {
	got, err := canonicalize("https://[::1]")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "https://[::1]", got)
}

func (suite *CanonicalTestSuite) TestIPv4HostUnbracketed() {
	got, err := canonicalize("http://127.0.0.1:8080")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), "http://127.0.0.1:8080", got)
}

func (suite *CanonicalTestSuite) TestNonIDNStrictHostPassedThrough() {
	// Underscores fail IDNA-strict but browsers and dev tooling routinely
	// emit them; canonicalization must not reject the host. We do not assert
	// the exact byte-for-byte output to avoid coupling to the idna package's
	// behavior for non-IDN labels — only that the call succeeds.
	_, err := canonicalize("https://my_service.example")
	suite.Require().NoError(err)
}
