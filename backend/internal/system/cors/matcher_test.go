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

type MatcherTestSuite struct {
	suite.Suite
}

func TestMatcherTestSuite(t *testing.T) {
	suite.Run(t, new(MatcherTestSuite))
}

func (suite *MatcherTestSuite) buildMatcher(entries ...entry) *Matcher {
	rules, err := compileAll(entries)
	suite.Require().NoError(err)
	return newMatcher(rules)
}

func (suite *MatcherTestSuite) TestEmptyMatcherRejectsAll() {
	m := newMatcher(nil)
	allow, echo := m.Match(ParseResult{Raw: "https://example.com"})
	assert.False(suite.T(), allow)
	assert.Empty(suite.T(), echo)
	assert.Equal(suite.T(), 0, m.Size())
}

func (suite *MatcherTestSuite) TestNilMatcherRejectsAll() {
	var m *Matcher
	allow, echo := m.Match(ParseResult{Raw: "https://example.com"})
	assert.False(suite.T(), allow)
	assert.Empty(suite.T(), echo)
	assert.Equal(suite.T(), 0, m.Size())
}

func (suite *MatcherTestSuite) TestMatchEchoesRawHeader() {
	m := suite.buildMatcher(literalEntry{Value: "https://example.com"})
	parsed, err := ParseOrigin("HTTPS://Example.COM")
	suite.Require().NoError(err)
	allow, echo := m.Match(parsed)
	assert.True(suite.T(), allow)
	assert.Equal(suite.T(), "HTTPS://Example.COM", echo,
		"echo must be the verbatim parsed Raw, not the rule's canonical form")
}

func (suite *MatcherTestSuite) TestFirstMatchWins() {
	m := suite.buildMatcher(
		literalEntry{Value: "https://example.com"},
		regexEntry{Pattern: `^https://example\.com$`},
	)
	parsed, err := ParseOrigin("https://example.com")
	suite.Require().NoError(err)
	allow, echo := m.Match(parsed)
	assert.True(suite.T(), allow)
	assert.Equal(suite.T(), "https://example.com", echo)
	assert.Equal(suite.T(), 2, m.Size())
}

func (suite *MatcherTestSuite) TestRegexFallbackWhenLiteralMisses() {
	m := suite.buildMatcher(
		literalEntry{Value: "https://exact.com"},
		regexEntry{Pattern: `^https://[a-z]+\.staging\.example\.com$`},
	)
	allow, echo := m.Match(ParseResult{Raw: "https://tenant.staging.example.com"})
	assert.True(suite.T(), allow)
	assert.Equal(suite.T(), "https://tenant.staging.example.com", echo)
}

func (suite *MatcherTestSuite) TestNoMatchRejected() {
	m := suite.buildMatcher(
		literalEntry{Value: "https://example.com"},
		regexEntry{Pattern: `^https://[a-z]+\.example\.com$`},
	)
	allow, echo := m.Match(ParseResult{Raw: "https://malicious.com"})
	assert.False(suite.T(), allow)
	assert.Empty(suite.T(), echo)
}

func (suite *MatcherTestSuite) TestNullOriginMatchesOnlyNullRule() {
	m := suite.buildMatcher(literalEntry{Value: "null"})
	allow, echo := m.Match(ParseResult{Raw: "null", IsNull: true})
	assert.True(suite.T(), allow)
	assert.Equal(suite.T(), "null", echo)
}

func (suite *MatcherTestSuite) TestNullOriginRejectedByLiteralOrigins() {
	m := suite.buildMatcher(literalEntry{Value: "https://example.com"})
	allow, _ := m.Match(ParseResult{Raw: "null", IsNull: true})
	assert.False(suite.T(), allow)
}

func (suite *MatcherTestSuite) TestNewMatcherCopiesRuleSlice() {
	rules, err := compileAll([]entry{literalEntry{Value: "https://example.com"}})
	suite.Require().NoError(err)

	m := newMatcher(rules)

	// Mutate the caller's slice; the matcher must be unaffected.
	rules[0] = nil

	parsed, err := ParseOrigin("https://example.com")
	suite.Require().NoError(err)
	allow, _ := m.Match(parsed)
	assert.True(suite.T(), allow)
}

func (suite *MatcherTestSuite) TestLiteralAndRegexCounts() {
	m := suite.buildMatcher(
		literalEntry{Value: "https://a.com"},
		literalEntry{Value: "https://b.com"},
		literalEntry{Value: "null"},
		regexEntry{Pattern: `^https://[a-z]+\.example\.com$`},
	)
	assert.Equal(suite.T(), 4, m.Size())
	assert.Equal(suite.T(), 3, m.LiteralCount())
	assert.Equal(suite.T(), 1, m.RegexCount())
}

func (suite *MatcherTestSuite) TestMatchUsesPreCanonicalizedFastPath() {
	// Construct ParseResult directly so the test would fail if Match ever
	// recomputed the canonical form internally instead of trusting the
	// pre-populated value. This is the production hot path.
	m := suite.buildMatcher(literalEntry{Value: "https://example.com"})
	parsed := ParseResult{
		Raw:       "HTTPS://Example.COM",
		Canonical: "https://example.com",
	}
	allow, echo := m.Match(parsed)
	assert.True(suite.T(), allow)
	assert.Equal(suite.T(), "HTTPS://Example.COM", echo)
}

func (suite *MatcherTestSuite) TestIPv6OriginMatchesLiteral() {
	m := suite.buildMatcher(literalEntry{Value: "https://[::1]:8443"})
	parsed, err := ParseOrigin("https://[::1]:8443")
	suite.Require().NoError(err)
	allow, _ := m.Match(parsed)
	assert.True(suite.T(), allow)
}

func (suite *MatcherTestSuite) TestIDNUnicodeMatchesPunycodeLiteral() {
	m := suite.buildMatcher(literalEntry{Value: "https://xn--mnchen-3ya.example"})
	parsed, err := ParseOrigin("https://münchen.example")
	suite.Require().NoError(err)
	allow, echo := m.Match(parsed)
	assert.True(suite.T(), allow)
	assert.Equal(suite.T(), "https://münchen.example", echo,
		"echo should be the verbatim Origin header even when matched via Punycode form")
}

func (suite *MatcherTestSuite) TestTrailingDotMatchesBareHost() {
	m := suite.buildMatcher(literalEntry{Value: "https://example.com"})
	parsed, err := ParseOrigin("https://example.com.")
	suite.Require().NoError(err)
	allow, _ := m.Match(parsed)
	assert.True(suite.T(), allow)
}

// BenchmarkMatchLiteralHitMap measures the cost of a literal hit through the
// O(1) map path so we can compare it against the legacy O(n) scan if needed
// while sizing rule-set growth budgets.
func BenchmarkMatchLiteralHitMap(b *testing.B) {
	entries := []entry{
		literalEntry{Value: "https://a.example.com"},
		literalEntry{Value: "https://b.example.com"},
		literalEntry{Value: "https://c.example.com"},
		literalEntry{Value: "https://d.example.com"},
		literalEntry{Value: "https://e.example.com"},
	}
	rules, err := compileAll(entries)
	if err != nil {
		b.Fatal(err)
	}
	m := newMatcher(rules)
	parsed, err := ParseOrigin("https://e.example.com")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		allow, _ := m.Match(parsed)
		if !allow {
			b.Fatal("expected allow")
		}
	}
}

// BenchmarkMatchRegexMiss measures the cost of a regex-only matcher when the
// request origin does not match — this is the worst case for CORS overhead.
func BenchmarkMatchRegexMiss(b *testing.B) {
	entries := []entry{
		regexEntry{Pattern: `^https://[a-z]+\.a\.example\.com$`},
		regexEntry{Pattern: `^https://[a-z]+\.b\.example\.com$`},
		regexEntry{Pattern: `^https://[a-z]+\.c\.example\.com$`},
		regexEntry{Pattern: `^https://[a-z]+\.d\.example\.com$`},
		regexEntry{Pattern: `^https://[a-z]+\.e\.example\.com$`},
	}
	rules, err := compileAll(entries)
	if err != nil {
		b.Fatal(err)
	}
	m := newMatcher(rules)
	parsed, err := ParseOrigin("https://attacker.example")
	if err != nil {
		b.Fatal(err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		allow, _ := m.Match(parsed)
		if allow {
			b.Fatal("expected reject")
		}
	}
}

// BenchmarkCompileAllRegex sizes the boot-time cost of compiling a small
// regex set so we can confirm the cached-matcher decision (D1) is justified.
func BenchmarkCompileAllRegex(b *testing.B) {
	entries := []entry{
		regexEntry{Pattern: `^https://[a-z0-9-]+\.tenant\.example\.com$`},
		regexEntry{Pattern: `^https://[a-z0-9-]+\.staging\.example\.com$`},
		regexEntry{Pattern: `^https://[a-z0-9-]+\.dev\.example\.com$`},
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_, err := compileAll(entries)
		if err != nil {
			b.Fatal(err)
		}
	}
}
