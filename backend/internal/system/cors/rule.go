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

import "regexp"

// ruleKind identifies whether a compiled rule was sourced from a literal or
// a regex configuration entry. It is intended for diagnostics and logging.
type ruleKind int

const (
	// kindLiteral indicates a rule compiled from a bare-string YAML entry.
	kindLiteral ruleKind = iota
	// kindRegex indicates a rule compiled from a regex YAML entry.
	kindRegex
)

// originRule is the discriminated-union type produced by compile. The matcher
// disassembles compiled rules into kind-specific data structures
// (canonical-key map for literals, regex slice for regex rules) so request-time
// matching avoids interface dispatch and per-request canonicalization. Only
// kind() is needed at runtime; matching itself is performed by the Matcher.
type originRule interface {
	// kind reports the rule's source kind.
	kind() ruleKind
}

// literalRule matches a single canonicalized origin. The canonical form uses
// the lowercased scheme + lowercased host (with IDN labels Punycode-encoded
// and any trailing dot stripped); IPv6 hosts are bracketed. The port is
// preserved verbatim, so a portless origin and the same origin with an
// explicit default port (e.g. "https://example.com" vs.
// "https://example.com:443") remain distinct rules — operators that want both
// allowed must list each entry. The "null" origin is represented by isNull;
// such a rule matches only inputs whose IsNull flag is set.
type literalRule struct {
	canonical string
	isNull    bool
}

// kind reports kindLiteral.
func (r literalRule) kind() ruleKind { return kindLiteral }

// regexRule matches the raw request Origin header against an operator-supplied
// RE2 pattern. The regex sees the raw header byte for byte after only the
// parse gate; no canonicalization or transformation is applied on the regex
// path. Operators own pattern correctness, including any anchoring required
// for full-input match (\A...\z).
type regexRule struct {
	re *regexp.Regexp
}

// kind reports kindRegex.
func (r regexRule) kind() ruleKind { return kindRegex }
