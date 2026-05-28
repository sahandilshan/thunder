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

package agent

import "encoding/json"

// Agent represents the structure for agent request and response in tests.
type Agent struct {
	ID          string          `json:"id,omitempty"`
	OUID        string          `json:"ouId,omitempty"`
	OUHandle    string          `json:"ouHandle,omitempty"`
	Type        string          `json:"type,omitempty"`
	Name        string          `json:"name,omitempty"`
	Description string          `json:"description,omitempty"`
	Owner       string          `json:"owner,omitempty"`
	Attributes  json.RawMessage `json:"attributes,omitempty"`
	IsReadOnly  bool            `json:"isReadOnly"`

	AuthFlowID                string              `json:"authFlowId,omitempty"`
	RegistrationFlowID        string              `json:"registrationFlowId,omitempty"`
	IsRegistrationFlowEnabled bool                `json:"isRegistrationFlowEnabled,omitempty"`
	ThemeID                   string              `json:"themeId,omitempty"`
	LayoutID                  string              `json:"layoutId,omitempty"`
	AllowedUserTypes          []string            `json:"allowedUserTypes,omitempty"`
	InboundAuthConfig         []InboundAuthConfig `json:"inboundAuthConfig,omitempty"`
}

// InboundAuthConfig represents an inbound authentication configuration entry.
type InboundAuthConfig struct {
	Type   string          `json:"type"`
	Config *OAuthAgentConfig `json:"config,omitempty"`
}

// OAuthAgentConfig represents the OAuth client configuration for an agent.
type OAuthAgentConfig struct {
	ClientID                string   `json:"clientId,omitempty"`
	ClientSecret            string   `json:"clientSecret,omitempty"`
	RedirectURIs            []string `json:"redirectUris,omitempty"`
	GrantTypes              []string `json:"grantTypes,omitempty"`
	ResponseTypes           []string `json:"responseTypes,omitempty"`
	TokenEndpointAuthMethod string   `json:"tokenEndpointAuthMethod,omitempty"`
	PKCERequired            bool     `json:"pkceRequired,omitempty"`
	PublicClient            bool     `json:"publicClient,omitempty"`
}

// AgentListResponse represents the paginated list response for agents.
type AgentListResponse struct {
	TotalResults int           `json:"totalResults"`
	StartIndex   int           `json:"startIndex"`
	Count        int           `json:"count"`
	Agents       []Agent       `json:"agents"`
	Links        []interface{} `json:"links"`
}

// AgentGroup represents a group entry in the agent's group list.
type AgentGroup struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	OUID string `json:"ouId"`
}

// AgentGroupListResponse is the paginated group list response.
type AgentGroupListResponse struct {
	TotalResults int           `json:"totalResults"`
	StartIndex   int           `json:"startIndex"`
	Count        int           `json:"count"`
	Groups       []AgentGroup  `json:"groups"`
	Links        []interface{} `json:"links"`
}

// TokenExchangeResponse represents the response from a token exchange request.
type TokenExchangeResponse struct {
	AccessToken      string `json:"access_token,omitempty"`
	TokenType        string `json:"token_type,omitempty"`
	ExpiresIn        int64  `json:"expires_in,omitempty"`
	IssuedTokenType  string `json:"issued_token_type,omitempty"`
	Scope            string `json:"scope,omitempty"`
	Error            string `json:"error,omitempty"`
	ErrorDescription string `json:"error_description,omitempty"`
}
