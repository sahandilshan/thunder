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

package jwe

// KeyEncAlgorithm represents the JWE key management algorithm (alg header parameter)
type KeyEncAlgorithm string

const (
	// RSAOAEP uses SHA-1 for OAEP masking (RFC 7518 §4.3). Prefer RSAOAEP256 for new deployments.
	RSAOAEP KeyEncAlgorithm = "RSA-OAEP"
	// RSAOAEP256 represents RSA-OAEP using SHA-256 key encryption (RFC 7518 §4.3)
	RSAOAEP256 KeyEncAlgorithm = "RSA-OAEP-256"
	// A128KW represents AES Key Wrap with 128-bit key (RFC 7518 §4.4)
	A128KW KeyEncAlgorithm = "A128KW"
	// A192KW represents AES Key Wrap with 192-bit key (RFC 7518 §4.4)
	A192KW KeyEncAlgorithm = "A192KW"
	// A256KW represents AES Key Wrap with 256-bit key (RFC 7518 §4.4)
	A256KW KeyEncAlgorithm = "A256KW"
	// ECDHES represents ECDH-ES key encryption (RFC 7518 §4.6)
	ECDHES KeyEncAlgorithm = "ECDH-ES"
	// ECDHESA128KW represents ECDH-ES with AES 128-bit Key Wrap (RFC 7518 §4.6)
	ECDHESA128KW KeyEncAlgorithm = "ECDH-ES+A128KW"
	// ECDHESA192KW represents ECDH-ES with AES 192-bit Key Wrap (RFC 7518 §4.6)
	ECDHESA192KW KeyEncAlgorithm = "ECDH-ES+A192KW"
	// ECDHESA256KW represents ECDH-ES with AES 256-bit Key Wrap (RFC 7518 §4.6)
	ECDHESA256KW KeyEncAlgorithm = "ECDH-ES+A256KW"
	// A128GCMKW represents AES GCM Key Wrap with 128-bit key (RFC 7518 §4.7)
	A128GCMKW KeyEncAlgorithm = "A128GCMKW"
	// A192GCMKW represents AES GCM Key Wrap with 192-bit key (RFC 7518 §4.7)
	A192GCMKW KeyEncAlgorithm = "A192GCMKW"
	// A256GCMKW represents AES GCM Key Wrap with 256-bit key (RFC 7518 §4.7)
	A256GCMKW KeyEncAlgorithm = "A256GCMKW"
)

// ContentEncAlgorithm represents the JWE content encryption algorithm (enc header parameter)
type ContentEncAlgorithm string

const (
	// A128CBCHS256 represents AES-128-CBC with HMAC-SHA-256 content encryption (RFC 7518 §5.2)
	A128CBCHS256 ContentEncAlgorithm = "A128CBC-HS256"
	// A192CBCHS384 represents AES-192-CBC with HMAC-SHA-384 content encryption (RFC 7518 §5.2)
	A192CBCHS384 ContentEncAlgorithm = "A192CBC-HS384"
	// A256CBCHS512 represents AES-256-CBC with HMAC-SHA-512 content encryption (RFC 7518 §5.2)
	A256CBCHS512 ContentEncAlgorithm = "A256CBC-HS512"
	// A128GCM represents AES GCM using 128-bit key (RFC 7518 §5.3)
	A128GCM ContentEncAlgorithm = "A128GCM"
	// A192GCM represents AES GCM using 192-bit key (RFC 7518 §5.3)
	A192GCM ContentEncAlgorithm = "A192GCM"
	// A256GCM represents AES GCM using 256-bit key (RFC 7518 §5.3)
	A256GCM ContentEncAlgorithm = "A256GCM"
)
