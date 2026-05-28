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
	"fmt"
	"net/url"
	"strings"
)

// ParseResult captures the outcome of the strict origin parse gate.
// Raw is the verbatim header value after a successful gate decision; the
// matcher uses Raw both for regex matching (operator-owns-regex) and as the
// echo target on allow. IsNull is set only when the input is the literal CORS
// "null" origin. Canonical holds the RFC-6454-style canonical form of the
// origin (set only for non-null inputs); it is computed once at parse time so
// the matcher hot path can perform O(1) literal lookup without re-parsing.
type ParseResult struct {
	Raw       string
	IsNull    bool
	Canonical string
}

// ParseOrigin implements the parse gate. It is a yes/no decision for the
// caller, but on success it also stashes the canonical form so downstream
// matching is allocation-light. On failure it returns ErrInvalidOrigin.
//
// The gate refuses:
//   - inputs containing ASCII control characters (including CR, LF, NUL, TAB);
//   - inputs that are not the literal "null" and do not parse as a valid
//     http(s) URL with a host and no path/query/fragment/userinfo.
//
// "null" is accepted as a distinct outcome (IsNull=true) and matched only by
// literal rules whose value is "null".
func ParseOrigin(header string) (ParseResult, error) {
	if header == "" {
		return ParseResult{}, fmt.Errorf("%w: empty header", ErrInvalidOrigin)
	}
	if containsControlChar(header) {
		return ParseResult{}, fmt.Errorf("%w: control character in header", ErrInvalidOrigin)
	}
	if header == "null" {
		return ParseResult{Raw: header, IsNull: true}, nil
	}

	u, err := url.Parse(header)
	if err != nil {
		return ParseResult{}, fmt.Errorf("%w: %w", ErrInvalidOrigin, err)
	}
	switch strings.ToLower(u.Scheme) {
	case schemeHTTP, schemeHTTPS:
	default:
		return ParseResult{}, fmt.Errorf("%w: unsupported scheme %q", ErrInvalidOrigin, u.Scheme)
	}
	if u.Host == "" {
		return ParseResult{}, fmt.Errorf("%w: missing host", ErrInvalidOrigin)
	}
	if u.User != nil {
		return ParseResult{}, fmt.Errorf("%w: userinfo not allowed", ErrInvalidOrigin)
	}
	if u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return ParseResult{}, fmt.Errorf("%w: path, query, or fragment not allowed", ErrInvalidOrigin)
	}
	canonical, err := canonicalizeFromURL(u)
	if err != nil {
		return ParseResult{}, err
	}
	return ParseResult{Raw: header, Canonical: canonical}, nil
}

// containsControlChar reports whether s contains any byte in the C0 or DEL
// control range. Origin headers are ASCII per the Fetch spec, so byte-level
// inspection is sufficient.
func containsControlChar(s string) bool {
	for i := 0; i < len(s); i++ {
		b := s[i]
		if b < 0x20 || b == 0x7f {
			return true
		}
	}
	return false
}
