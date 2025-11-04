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

// Package event provides event models and types for the observability system.
package event

import (
	"github.com/asgardeo/thunder/internal/system/log"
)

// EventCategory represents a category for grouping related events.
// Used by the event bus for efficient routing - subscribers declare which
// categories they're interested in, and events are only delivered to
// subscribers that match the event's category.
//
// Benefits:
// - Performance: Skip events with no interested subscribers
// - Flexibility: Subscribers can filter by category, event type, or both
// - Organization: Logical grouping of related events
//
// Example usage:
//
//	subscriber.GetCategories() returns [CategoryAuthentication, CategoryTokens]
//	Event with category "authentication" → only delivered to auth subscribers
type EventCategory string

const (
	// CategoryAuthentication groups all authentication-related events.
	CategoryAuthentication EventCategory = "observability.authentication"

	// CategoryAuthorization groups all authorization-related events.
	CategoryAuthorization EventCategory = "observability.authorization"

	// CategoryTokens groups all token-related events.
	CategoryTokens EventCategory = "observability.tokens" // #nosec G101 -- Not a credential, observability category name

	// CategoryFlows groups all flow execution events.
	CategoryFlows EventCategory = "observability.flows"

	// CategorySessions groups all session-related events.
	CategorySessions EventCategory = "observability.sessions"

	// CategoryRegistration groups all user registration events.
	CategoryRegistration EventCategory = "observability.registration"

	// CategoryAll is a special category that matches all events.
	// Subscribers to this category receive all events regardless of type.
	CategoryAll EventCategory = "observability.all"

	// CategoryUnknown represents events that are not mapped to any category.
	// This indicates a missing mapping in eventTypeToCategory and should be investigated.
	CategoryUnknown EventCategory = "observability.unknown"
)

// eventTypeToCategory maps each event type to its category.
// This enables automatic routing of events to appropriate categories.
var eventTypeToCategory = map[EventType]EventCategory{
	// Authentication events
	EventTypeAuthenticationStarted:        CategoryAuthentication,
	EventTypeAuthenticationMethodSelected: CategoryAuthentication,
	EventTypeCredentialsAuthStarted:       CategoryAuthentication,
	EventTypeCredentialsAuthCompleted:     CategoryAuthentication,
	EventTypeCredentialsAuthFailed:        CategoryAuthentication,
	EventTypeOTPSent:                      CategoryAuthentication,
	EventTypeOTPVerificationStarted:       CategoryAuthentication,
	EventTypeOTPVerified:                  CategoryAuthentication,
	EventTypeOTPVerificationFailed:        CategoryAuthentication,
	EventTypeSocialAuthStarted:            CategoryAuthentication,
	EventTypeSocialAuthCallbackReceived:   CategoryAuthentication,
	EventTypeSocialAuthCompleted:          CategoryAuthentication,
	EventTypeSocialAuthFailed:             CategoryAuthentication,
	EventTypeAuthenticationCompleted:      CategoryAuthentication,
	EventTypeAuthenticationFailed:         CategoryAuthentication,

	// Authorization events
	EventTypeAuthorizationStarted:       CategoryAuthorization,
	EventTypeAuthorizationValidated:     CategoryAuthorization,
	EventTypeAuthorizationRedirect:      CategoryAuthorization,
	EventTypeAuthorizationCodeGenerated: CategoryAuthorization,
	EventTypeAuthorizationCompleted:     CategoryAuthorization,
	EventTypeAuthorizationFailed:        CategoryAuthorization,

	// Token events
	EventTypeTokenRequestReceived:       CategoryTokens,
	EventTypeTokenRequestValidated:      CategoryTokens,
	EventTypeAuthorizationCodeValidated: CategoryTokens,
	EventTypePKCEValidated:              CategoryTokens,
	EventTypePKCEFailed:                 CategoryTokens,
	EventTypeAccessTokenGenerated:       CategoryTokens,
	EventTypeIDTokenGenerated:           CategoryTokens,
	EventTypeRefreshTokenGenerated:      CategoryTokens,
	EventTypeTokenIssued:                CategoryTokens,
	EventTypeTokenRequestFailed:         CategoryTokens,
	EventTypeRefreshTokenUsed:           CategoryTokens,

	// Flow events
	EventTypeFlowStarted:                CategoryFlows,
	EventTypeFlowNodeExecutionStarted:   CategoryFlows,
	EventTypeFlowNodeExecutionCompleted: CategoryFlows,
	EventTypeFlowNodeExecutionFailed:    CategoryFlows,
	EventTypeFlowUserInputRequired:      CategoryFlows,
	EventTypeFlowCompleted:              CategoryFlows,
	EventTypeFlowFailed:                 CategoryFlows,

	// Registration events
	EventTypeRegistrationStarted:   CategoryRegistration,
	EventTypeUserProvisioned:       CategoryRegistration,
	EventTypeRegistrationCompleted: CategoryRegistration,
	EventTypeRegistrationFailed:    CategoryRegistration,

	// Session events
	EventTypeSessionCreated:   CategorySessions,
	EventTypeSessionUpdated:   CategorySessions,
	EventTypeSessionExpired:   CategorySessions,
	EventTypeSessionDestroyed: CategorySessions,
}

// GetCategory returns the category for a given event type.
// If the event type is not mapped, it returns CategoryUnknown and logs a warning.
// This helps detect missing event type mappings during development.
func GetCategory(eventType EventType) EventCategory {
	if category, exists := eventTypeToCategory[eventType]; exists {
		return category
	}

	// Log warning for unmapped event type to aid debugging
	// This should not happen in production if all event types are properly mapped
	// Using a simple approach to avoid circular dependencies with the log package
	// The caller (Event.GetCategory) can log this if needed
	return CategoryUnknown
}

// GetCategory returns the category for the given event.
// If the event type is not mapped to a category, it returns CategoryUnknown
// and logs a warning to help identify missing mappings.
func (e *Event) GetCategory() EventCategory {
	category := GetCategory(EventType(e.Type))

	// Log warning if event type is unmapped
	if category == CategoryUnknown {
		logger := log.GetLogger().With(log.String(log.LoggerKeyComponentName, "EventCategory"))
		logger.Warn("Event type not mapped to any category",
			log.String("eventType", e.Type),
			log.String("eventID", e.EventID))
	}

	return category
}

// GetAllCategories returns all defined event categories (excluding CategoryAll).
func GetAllCategories() []EventCategory {
	return []EventCategory{
		CategoryAuthentication,
		CategoryAuthorization,
		CategoryTokens,
		CategoryFlows,
		CategorySessions,
		CategoryRegistration,
	}
}

// IsValidCategory checks if a category is valid.
func IsValidCategory(category EventCategory) bool {
	if category == CategoryAll || category == CategoryUnknown {
		return true
	}

	for _, validCategory := range GetAllCategories() {
		if category == validCategory {
			return true
		}
	}

	return false
}
