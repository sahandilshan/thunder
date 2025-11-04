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

// Package observability provides observability capabilities for Thunder including
// event logging, metrics collection, distributed tracing, and health monitoring.
package observability

import (
	"errors"
	"path/filepath"
	"sync"

	"github.com/asgardeo/thunder/internal/observability/adapter"
	"github.com/asgardeo/thunder/internal/observability/adapter/console"
	"github.com/asgardeo/thunder/internal/observability/adapter/file"
	"github.com/asgardeo/thunder/internal/observability/event"
	"github.com/asgardeo/thunder/internal/observability/formatter"
	jsonformatter "github.com/asgardeo/thunder/internal/observability/formatter/json"
	"github.com/asgardeo/thunder/internal/observability/publisher"
	"github.com/asgardeo/thunder/internal/observability/subscriber"
	"github.com/asgardeo/thunder/internal/observability/subscriber/defaultsubscriber"
	"github.com/asgardeo/thunder/internal/system/config"
	"github.com/asgardeo/thunder/internal/system/log"
)

const loggerComponentName = "ObservabilityService"

// Service provides observability event publishing functionality.
// This is the main entry point for the observability system.
// It manages the lifecycle of the publisher, which in turn manages subscribers.
//
// Architecture:
//   - Service (High-level): Manages lifecycle, configuration, initialization
//   - CategoryPublisher (Low-level): Implements event publishing logic
//   - Subscribers (Low-level): Consume events
//
// The service layer owns the singleton pattern and initialization logic,
// while the publisher layer provides the implementation.
type Service struct {
	publisher         publisher.CategoryPublisher
	logger            *log.Logger
	config            *Config
	enabled           bool
	defaultSubscriber subscriber.Subscriber // Reference to default subscriber for lifecycle management
}

var (
	serviceInstance *Service
	serviceOnce     sync.Once
)

// GetService returns the singleton instance of the observability service.
// Uses default configuration. For custom configuration, use InitializeWithConfig first.
func GetService() *Service {
	serviceOnce.Do(func() {
		serviceInstance = newService(nil)
	})
	return serviceInstance
}

// InitializeWithConfig initializes the observability service with custom configuration.
// Must be called before GetService to take effect.
// Returns error only if FailureMode is "strict", otherwise logs error and disables observability.
func InitializeWithConfig(cfg *Config) (*Service, error) {
	var svc *Service

	serviceOnce.Do(func() {
		svc = newServiceWithConfig(cfg)
		serviceInstance = svc
	})

	if serviceInstance == nil {
		return nil, errors.New("failed to initialize observability service")
	}

	return serviceInstance, nil
}

// NewService creates and initializes a new observability service with the given configuration.
func newService(cfg *Config) *Service {
	return newServiceWithConfig(cfg)
}

// newServiceWithConfig creates and initializes a new observability service.
func newServiceWithConfig(cfg *Config) *Service {
	logger := log.GetLogger().With(log.String(log.LoggerKeyComponentName, loggerComponentName))

	// Use default config if none provided
	if cfg == nil {
		cfg = DefaultConfig()
	}

	// Check if observability is disabled
	if !cfg.Enabled {
		logger.Debug("Observability service is disabled by configuration")
		return &Service{
			publisher: nil,
			logger:    logger,
			config:    cfg,
			enabled:   false,
		}
	}

	logger.Info("Initializing observability service",
		log.String("outputType", cfg.Output.Type))

	// Create event bus (no queue needed)
	pub := publisher.NewCategoryPublisher()

	svc := &Service{
		publisher: pub,
		logger:    logger,
		config:    cfg,
		enabled:   true,
	}

	// Initialize default subscribers
	svc.initializeSubscribers()

	logger.Debug("Observability service initialized successfully")
	return svc
}

// initializeSubscribers sets up the default subscribers for analytics events.
func (s *Service) initializeSubscribers() {
	// Create formatter based on config
	var fmtr formatter.Formatter
	switch s.config.Output.Format {
	case FormatJSON:
		fmtr = jsonformatter.NewJSONFormatter()
	default:
		fmtr = jsonformatter.NewJSONFormatter()
		s.logger.Warn("Unknown output format, using JSON",
			log.String("format", s.config.Output.Format))
	}

	// Create adapter based on config
	var adptr adapter.OutputAdapter
	var err error

	switch s.config.Output.Type {
	case OutputTypeFile:
		// Use file path from config or default
		analyticsFile := s.config.Output.File.Path
		if analyticsFile == "" {
			analyticsDir := filepath.Join(config.GetThunderRuntime().ThunderHome, "logs", "analytics")
			analyticsFile = filepath.Join(analyticsDir, "analytics.log")
		}

		adptr, err = file.NewFileAdapter(analyticsFile)
		if err != nil {
			s.logger.Warn("Failed to create file adapter, falling back to console",
				log.String("filePath", analyticsFile),
				log.Error(err))
			// Fallback to console
			adptr = console.NewConsoleAdapter()
		} else {
			s.logger.Debug("Using file adapter",
				log.String("filePath", analyticsFile))
		}

	case OutputTypeConsole:
		adptr = console.NewConsoleAdapter()
		s.logger.Debug("Using console adapter")

	default:
		s.logger.Warn("Unknown output type, using console",
			log.String("outputType", s.config.Output.Type))
		adptr = console.NewConsoleAdapter()
	}

	// Create and subscribe the default subscriber
	// Store reference for lifecycle management (unsubscribe, reconfigure, etc.)
	s.defaultSubscriber = defaultsubscriber.NewDefaultSubscriber(fmtr, adptr)
	s.publisher.Subscribe(s.defaultSubscriber)

	s.logger.Debug("Default subscriber initialized successfully")
}

// PublishEvent publishes an event to the observability system.
// This is a no-op if observability is disabled.
func (s *Service) PublishEvent(evt *event.Event) {
	// Quick exit if observability is disabled
	if !s.enabled || s.publisher == nil {
		return
	}

	if evt == nil {
		s.logger.Warn("Attempted to publish nil event")
		return
	}

	s.publisher.Publish(evt)
	s.logger.Debug("Event published",
		log.String("eventType", evt.Type),
		log.String("eventID", evt.EventID),
		log.String("traceID", evt.TraceID))
}

// IsEnabled returns true if observability is enabled and operational.
func (s *Service) IsEnabled() bool {
	return s.enabled && s.publisher != nil
}

// GetConfig returns the current configuration.
func (s *Service) GetConfig() *Config {
	return s.config
}

// GetPublisher returns the underlying publisher for advanced use cases.
// Most users should use PublishEvent() instead.
// This is provided for cases where you need direct access to:
// - Subscribe/Unsubscribe subscribers programmatically
// - Query active categories
// Returns nil if observability is disabled.
func (s *Service) GetPublisher() publisher.CategoryPublisher {
	return s.publisher
}

// GetDefaultSubscriber returns the default subscriber instance.
// This is useful for testing, querying subscriber state, or replacing the default subscriber.
// Returns nil if no default subscriber is configured or observability is disabled.
func (s *Service) GetDefaultSubscriber() subscriber.Subscriber {
	return s.defaultSubscriber
}

// Shutdown gracefully shuts down the observability service.
func (s *Service) Shutdown() {
	s.logger.Debug("Shutting down observability service")

	if s.publisher != nil {
		// Unsubscribe the default subscriber before shutting down the publisher
		if s.defaultSubscriber != nil {
			s.publisher.Unsubscribe(s.defaultSubscriber)
			s.defaultSubscriber = nil
		}

		s.publisher.Shutdown()
	}

	s.enabled = false
	s.logger.Debug("Observability service shutdown complete")
}
