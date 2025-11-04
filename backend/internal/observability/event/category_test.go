/*
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
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

package event

import (
	"testing"
	"time"
)

func TestGetCategory(t *testing.T) {
	tests := []struct {
		name         string
		eventType    EventType
		wantCategory EventCategory
	}{
		// Authentication events
		{
			name:         "authentication started",
			eventType:    EventTypeAuthenticationStarted,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "authentication completed",
			eventType:    EventTypeAuthenticationCompleted,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "authentication failed",
			eventType:    EventTypeAuthenticationFailed,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "credentials auth started",
			eventType:    EventTypeCredentialsAuthStarted,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "credentials auth completed",
			eventType:    EventTypeCredentialsAuthCompleted,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "OTP sent",
			eventType:    EventTypeOTPSent,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "OTP verified",
			eventType:    EventTypeOTPVerified,
			wantCategory: CategoryAuthentication,
		},
		{
			name:         "social auth started",
			eventType:    EventTypeSocialAuthStarted,
			wantCategory: CategoryAuthentication,
		},

		// Authorization events
		{
			name:         "authorization started",
			eventType:    EventTypeAuthorizationStarted,
			wantCategory: CategoryAuthorization,
		},
		{
			name:         "authorization completed",
			eventType:    EventTypeAuthorizationCompleted,
			wantCategory: CategoryAuthorization,
		},
		{
			name:         "authorization code generated",
			eventType:    EventTypeAuthorizationCodeGenerated,
			wantCategory: CategoryAuthorization,
		},

		// Token events
		{
			name:         "token issued",
			eventType:    EventTypeTokenIssued,
			wantCategory: CategoryTokens,
		},
		{
			name:         "access token generated",
			eventType:    EventTypeAccessTokenGenerated,
			wantCategory: CategoryTokens,
		},
		{
			name:         "refresh token generated",
			eventType:    EventTypeRefreshTokenGenerated,
			wantCategory: CategoryTokens,
		},
		{
			name:         "PKCE validated",
			eventType:    EventTypePKCEValidated,
			wantCategory: CategoryTokens,
		},

		// Flow events
		{
			name:         "flow started",
			eventType:    EventTypeFlowStarted,
			wantCategory: CategoryFlows,
		},
		{
			name:         "flow completed",
			eventType:    EventTypeFlowCompleted,
			wantCategory: CategoryFlows,
		},
		{
			name:         "flow node execution started",
			eventType:    EventTypeFlowNodeExecutionStarted,
			wantCategory: CategoryFlows,
		},

		// Registration events
		{
			name:         "registration started",
			eventType:    EventTypeRegistrationStarted,
			wantCategory: CategoryRegistration,
		},
		{
			name:         "user provisioned",
			eventType:    EventTypeUserProvisioned,
			wantCategory: CategoryRegistration,
		},

		// Session events
		{
			name:         "session created",
			eventType:    EventTypeSessionCreated,
			wantCategory: CategorySessions,
		},
		{
			name:         "session expired",
			eventType:    EventTypeSessionExpired,
			wantCategory: CategorySessions,
		},

		// Unknown event type
		{
			name:         "unknown event type",
			eventType:    EventType("unknown.event.type"),
			wantCategory: CategoryUnknown,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := GetCategory(tt.eventType)
			if got != tt.wantCategory {
				t.Errorf("GetCategory(%s) = %s, want %s", tt.eventType, got, tt.wantCategory)
			}
		})
	}
}

func TestEvent_GetCategory(t *testing.T) {
	tests := []struct {
		name         string
		event        *Event
		wantCategory EventCategory
	}{
		{
			name: "authentication event",
			event: &Event{
				TraceID:   "trace-1",
				EventID:   "event-1",
				Type:      string(EventTypeAuthenticationStarted),
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategoryAuthentication,
		},
		{
			name: "authorization event",
			event: &Event{
				TraceID:   "trace-2",
				EventID:   "event-2",
				Type:      string(EventTypeAuthorizationStarted),
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategoryAuthorization,
		},
		{
			name: "token event",
			event: &Event{
				TraceID:   "trace-3",
				EventID:   "event-3",
				Type:      string(EventTypeTokenIssued),
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategoryTokens,
		},
		{
			name: "flow event",
			event: &Event{
				TraceID:   "trace-4",
				EventID:   "event-4",
				Type:      string(EventTypeFlowStarted),
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategoryFlows,
		},
		{
			name: "session event",
			event: &Event{
				TraceID:   "trace-5",
				EventID:   "event-5",
				Type:      string(EventTypeSessionCreated),
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategorySessions,
		},
		{
			name: "registration event",
			event: &Event{
				TraceID:   "trace-6",
				EventID:   "event-6",
				Type:      string(EventTypeRegistrationStarted),
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategoryRegistration,
		},
		{
			name: "unknown event type",
			event: &Event{
				TraceID:   "trace-7",
				EventID:   "event-7",
				Type:      "unknown.custom.event",
				Component: "test",
				Timestamp: time.Now(),
			},
			wantCategory: CategoryUnknown,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := tt.event.GetCategory()
			if got != tt.wantCategory {
				t.Errorf("Event.GetCategory() = %s, want %s", got, tt.wantCategory)
			}
		})
	}
}

func TestGetAllCategories(t *testing.T) {
	categories := GetAllCategories()

	if len(categories) == 0 {
		t.Error("GetAllCategories() returned empty slice")
	}

	// Expected categories (excluding CategoryAll and CategoryUnknown)
	expectedCategories := map[EventCategory]bool{
		CategoryAuthentication: false,
		CategoryAuthorization:  false,
		CategoryTokens:         false,
		CategoryFlows:          false,
		CategorySessions:       false,
		CategoryRegistration:   false,
	}

	for _, cat := range categories {
		if _, exists := expectedCategories[cat]; exists {
			expectedCategories[cat] = true
		} else {
			t.Errorf("Unexpected category in GetAllCategories(): %s", cat)
		}
	}

	// Verify all expected categories are present
	for cat, found := range expectedCategories {
		if !found {
			t.Errorf("Expected category %s not found in GetAllCategories()", cat)
		}
	}

	// Verify CategoryAll and CategoryUnknown are NOT in the list
	for _, cat := range categories {
		if cat == CategoryAll {
			t.Error("CategoryAll should not be in GetAllCategories()")
		}
		if cat == CategoryUnknown {
			t.Error("CategoryUnknown should not be in GetAllCategories()")
		}
	}
}

func TestIsValidCategory(t *testing.T) {
	tests := []struct {
		name     string
		category EventCategory
		want     bool
	}{
		{
			name:     "valid authentication category",
			category: CategoryAuthentication,
			want:     true,
		},
		{
			name:     "valid authorization category",
			category: CategoryAuthorization,
			want:     true,
		},
		{
			name:     "valid tokens category",
			category: CategoryTokens,
			want:     true,
		},
		{
			name:     "valid flows category",
			category: CategoryFlows,
			want:     true,
		},
		{
			name:     "valid sessions category",
			category: CategorySessions,
			want:     true,
		},
		{
			name:     "valid registration category",
			category: CategoryRegistration,
			want:     true,
		},
		{
			name:     "valid CategoryAll",
			category: CategoryAll,
			want:     true,
		},
		{
			name:     "valid CategoryUnknown",
			category: CategoryUnknown,
			want:     true,
		},
		{
			name:     "invalid custom category",
			category: EventCategory("observability.custom"),
			want:     false,
		},
		{
			name:     "invalid random string",
			category: EventCategory("not-a-category"),
			want:     false,
		},
		{
			name:     "empty category",
			category: EventCategory(""),
			want:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsValidCategory(tt.category)
			if got != tt.want {
				t.Errorf("IsValidCategory(%s) = %v, want %v", tt.category, got, tt.want)
			}
		})
	}
}

func TestCategoryConstants(t *testing.T) {
	// Verify category constants are not empty
	if CategoryAuthentication == "" {
		t.Error("CategoryAuthentication should not be empty")
	}
	if CategoryAuthorization == "" {
		t.Error("CategoryAuthorization should not be empty")
	}
	if CategoryTokens == "" {
		t.Error("CategoryTokens should not be empty")
	}
	if CategoryFlows == "" {
		t.Error("CategoryFlows should not be empty")
	}
	if CategorySessions == "" {
		t.Error("CategorySessions should not be empty")
	}
	if CategoryRegistration == "" {
		t.Error("CategoryRegistration should not be empty")
	}
	if CategoryAll == "" {
		t.Error("CategoryAll should not be empty")
	}
	if CategoryUnknown == "" {
		t.Error("CategoryUnknown should not be empty")
	}

	// Verify categories have expected prefix
	expectedPrefix := "observability."
	categories := append(GetAllCategories(), CategoryAll, CategoryUnknown)

	for _, cat := range categories {
		if len(cat) < len(expectedPrefix) || string(cat)[:len(expectedPrefix)] != expectedPrefix {
			t.Errorf("Category %s does not start with expected prefix %s", cat, expectedPrefix)
		}
	}
}

func TestEventTypeToCategoryMapping_Comprehensive(t *testing.T) {
	// Verify all defined event types have a category mapping
	allEventTypes := []EventType{
		// Authentication
		EventTypeAuthenticationStarted,
		EventTypeAuthenticationMethodSelected,
		EventTypeCredentialsAuthStarted,
		EventTypeCredentialsAuthCompleted,
		EventTypeCredentialsAuthFailed,
		EventTypeOTPSent,
		EventTypeOTPVerificationStarted,
		EventTypeOTPVerified,
		EventTypeOTPVerificationFailed,
		EventTypeSocialAuthStarted,
		EventTypeSocialAuthCallbackReceived,
		EventTypeSocialAuthCompleted,
		EventTypeSocialAuthFailed,
		EventTypeAuthenticationCompleted,
		EventTypeAuthenticationFailed,

		// Authorization
		EventTypeAuthorizationStarted,
		EventTypeAuthorizationValidated,
		EventTypeAuthorizationRedirect,
		EventTypeAuthorizationCodeGenerated,
		EventTypeAuthorizationCompleted,
		EventTypeAuthorizationFailed,

		// Tokens
		EventTypeTokenRequestReceived,
		EventTypeTokenRequestValidated,
		EventTypeAuthorizationCodeValidated,
		EventTypePKCEValidated,
		EventTypePKCEFailed,
		EventTypeAccessTokenGenerated,
		EventTypeIDTokenGenerated,
		EventTypeRefreshTokenGenerated,
		EventTypeTokenIssued,
		EventTypeTokenRequestFailed,
		EventTypeRefreshTokenUsed,

		// Flows
		EventTypeFlowStarted,
		EventTypeFlowNodeExecutionStarted,
		EventTypeFlowNodeExecutionCompleted,
		EventTypeFlowNodeExecutionFailed,
		EventTypeFlowUserInputRequired,
		EventTypeFlowCompleted,
		EventTypeFlowFailed,

		// Registration
		EventTypeRegistrationStarted,
		EventTypeUserProvisioned,
		EventTypeRegistrationCompleted,
		EventTypeRegistrationFailed,

		// Sessions
		EventTypeSessionCreated,
		EventTypeSessionUpdated,
		EventTypeSessionExpired,
		EventTypeSessionDestroyed,
	}

	for _, eventType := range allEventTypes {
		t.Run(string(eventType), func(t *testing.T) {
			category := GetCategory(eventType)
			if category == CategoryUnknown {
				t.Errorf("Event type %s is not mapped to any category", eventType)
			}
			if !IsValidCategory(category) {
				t.Errorf("Event type %s maps to invalid category %s", eventType, category)
			}
		})
	}
}

func TestCategoryToEventTypeConsistency(t *testing.T) {
	// Verify that each category has at least one event type mapped to it
	categoryEventCount := make(map[EventCategory]int)

	allEventTypes := []EventType{
		EventTypeAuthenticationStarted, EventTypeAuthenticationCompleted, EventTypeAuthenticationFailed,
		EventTypeAuthorizationStarted, EventTypeAuthorizationCompleted, EventTypeAuthorizationFailed,
		EventTypeTokenIssued, EventTypeAccessTokenGenerated, EventTypeRefreshTokenGenerated,
		EventTypeFlowStarted, EventTypeFlowCompleted, EventTypeFlowFailed,
		EventTypeRegistrationStarted, EventTypeRegistrationCompleted, EventTypeRegistrationFailed,
		EventTypeSessionCreated, EventTypeSessionExpired, EventTypeSessionDestroyed,
	}

	for _, eventType := range allEventTypes {
		category := GetCategory(eventType)
		categoryEventCount[category]++
	}

	// Verify each main category has events
	mainCategories := []EventCategory{
		CategoryAuthentication,
		CategoryAuthorization,
		CategoryTokens,
		CategoryFlows,
		CategoryRegistration,
		CategorySessions,
	}

	for _, cat := range mainCategories {
		count := categoryEventCount[cat]
		if count == 0 {
			t.Errorf("Category %s has no event types mapped to it", cat)
		}
	}
}
