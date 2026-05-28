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

import "errors"

// Sentinel errors returned by the parser and compiler. Callers may wrap these
// for additional context but should compare via errors.Is.
var (
	// ErrInvalidOrigin is returned by ParseOrigin when the request Origin
	// header is syntactically invalid as an HTTP(S) origin.
	ErrInvalidOrigin = errors.New("cors: invalid origin")

	// ErrInvalidLiteral is returned by Compile when a literal allowed-origin
	// entry cannot be parsed as a valid origin.
	ErrInvalidLiteral = errors.New("cors: invalid literal entry")

	// ErrInvalidRegex is returned by Compile when a regex allowed-origin
	// entry fails to compile under RE2.
	ErrInvalidRegex = errors.New("cors: invalid regex entry")

	// ErrEmptyEntry is returned by Compile when an entry carries no value
	// (empty literal string or empty regex pattern).
	ErrEmptyEntry = errors.New("cors: empty entry")

	// ErrWildcardLiteral is returned by Compile when an operator configures
	// the literal "*" entry. CORS does not allow combining the wildcard with
	// credentials, and the project does not support unauthenticated allow-all
	// either; operators must list explicit origins or use a regex entry.
	ErrWildcardLiteral = errors.New("cors: wildcard '*' literal is not supported")
)
