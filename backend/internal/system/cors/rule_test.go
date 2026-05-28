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
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/suite"
)

type RuleTestSuite struct {
	suite.Suite
}

func TestRuleTestSuite(t *testing.T) {
	suite.Run(t, new(RuleTestSuite))
}

// matchVia is a small helper that compiles one literal entry, builds a
// matcher around it, parses the test input, and reports whether the matcher
// accepts the input. It exercises the realistic compile + parse + match path
// used in production.
func (suite *RuleTestSuite) matchLiteralAgainst(literal, input string) bool {
	rule, err := compileLiteral(literal)
	suite.Require().NoError(err)
	m := newMatcher([]originRule{rule})
	parsed, parseErr := ParseOrigin(input)
	if parseErr != nil {
		// Parse-gate failure → matcher should reject; we propagate by
		// returning false rather than asserting so callers can write
		// negative-path tests against unparseable inputs.
		allow, _ := m.Match(ParseResult{Raw: input})
		return allow
	}
	allow, _ := m.Match(parsed)
	return allow
}

func (suite *RuleTestSuite) TestLiteralCanonicalEqualityMatches() {
	assert.True(suite.T(), suite.matchLiteralAgainst("https://example.com", "https://example.com"))
	// Case-insensitive on scheme + host.
	assert.True(suite.T(), suite.matchLiteralAgainst("https://example.com", "HTTPS://Example.COM"))
}

func (suite *RuleTestSuite) TestLiteralRequiresExplicitPortMatch() {
	// Operator owns the port spelling: a portless rule does not match a
	// default-port input, and vice versa. Operators that want both must list
	// each variant explicitly.
	assert.False(suite.T(), suite.matchLiteralAgainst("https://example.com", "https://example.com:443"))
	assert.False(suite.T(), suite.matchLiteralAgainst("https://example.com:443", "https://example.com"))
}

func (suite *RuleTestSuite) TestLiteralRejectsDifferentScheme() {
	assert.False(suite.T(), suite.matchLiteralAgainst("https://example.com", "http://example.com"))
}

func (suite *RuleTestSuite) TestLiteralRejectsDifferentPort() {
	assert.False(suite.T(), suite.matchLiteralAgainst("https://example.com:8443", "https://example.com"))
}

func (suite *RuleTestSuite) TestLiteralRejectsDifferentHost() {
	assert.False(suite.T(), suite.matchLiteralAgainst("https://example.com", "https://evil.com"))
}

func (suite *RuleTestSuite) TestLiteralRejectsUncanonicalizableInput() {
	// The matcher does not panic on an input that fails the parse gate; it
	// simply rejects.
	assert.False(suite.T(), suite.matchLiteralAgainst("https://example.com", "garbage://"))
}

func (suite *RuleTestSuite) TestLiteralNullMatchesOnlyNull() {
	rule, err := compileLiteral("null")
	suite.Require().NoError(err)
	m := newMatcher([]originRule{rule})

	allowNull, _ := m.Match(ParseResult{Raw: "null", IsNull: true})
	assert.True(suite.T(), allowNull)

	parsed, err := ParseOrigin("https://example.com")
	suite.Require().NoError(err)
	allowOrigin, _ := m.Match(parsed)
	assert.False(suite.T(), allowOrigin)
}

func (suite *RuleTestSuite) TestLiteralNonNullDoesNotMatchNullInput() {
	rule, err := compileLiteral("https://example.com")
	suite.Require().NoError(err)
	m := newMatcher([]originRule{rule})
	allow, _ := m.Match(ParseResult{Raw: "null", IsNull: true})
	assert.False(suite.T(), allow)
}

func (suite *RuleTestSuite) TestLiteralKindIsLiteral() {
	rule, err := compileLiteral("https://example.com")
	suite.Require().NoError(err)
	assert.Equal(suite.T(), kindLiteral, rule.kind())
}

func (suite *RuleTestSuite) TestRegexMatchesAgainstRawHeader() {
	rule, err := compileRegex(`^https://[a-z]+\.example\.com$`)
	suite.Require().NoError(err)
	m := newMatcher([]originRule{rule})

	lower, err := ParseOrigin("https://tenant.example.com")
	suite.Require().NoError(err)
	allowLower, _ := m.Match(lower)
	assert.True(suite.T(), allowLower)

	upper, err := ParseOrigin("https://Tenant.example.com")
	suite.Require().NoError(err)
	allowUpper, _ := m.Match(upper)
	assert.False(suite.T(), allowUpper,
		"regex sees raw header verbatim — case sensitivity is the operator's responsibility")

	other, err := ParseOrigin("https://evil.com")
	suite.Require().NoError(err)
	allowOther, _ := m.Match(other)
	assert.False(suite.T(), allowOther)
}

func (suite *RuleTestSuite) TestRegexKindIsRegex() {
	rule, err := compileRegex(`.+`)
	suite.Require().NoError(err)
	assert.Equal(suite.T(), kindRegex, rule.kind())
}
