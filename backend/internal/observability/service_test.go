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

package observability

import (
	"sync"
	"testing"
	"time"

	"github.com/asgardeo/thunder/internal/observability/event"
)

func TestGetService(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	svc := GetService()
	if svc == nil {
		t.Fatal("GetService() returned nil")
	}

	// Verify singleton behavior
	svc2 := GetService()
	if svc != svc2 {
		t.Error("GetService() should return the same instance")
	}
}

func TestInitializeWithConfig(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "json",
		},
		Metrics: MetricsConfig{
			Enabled:        true,
			ExportInterval: 60 * time.Second,
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	if svc == nil {
		t.Fatal("InitializeWithConfig() returned nil service")
	}

	if !svc.IsEnabled() {
		t.Error("Service should be enabled")
	}
}

func TestService_DisabledConfig(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: false,
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	if svc.IsEnabled() {
		t.Error("Service should be disabled when config.Enabled = false")
	}

	if svc.GetPublisher() != nil {
		t.Error("Publisher should be nil when service is disabled")
	}
}

func TestService_PublishEvent(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "json",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	evt := event.NewEvent("trace-123", string(event.EventTypeAuthenticationStarted), "test")
	evt.WithStatus(event.StatusSuccess)

	// Should not panic
	svc.PublishEvent(evt)

	// Give it time to process
	time.Sleep(100 * time.Millisecond)
}

func TestService_PublishEventDisabled(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: false,
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	evt := event.NewEvent("trace-123", string(event.EventTypeAuthenticationStarted), "test")

	// Should not panic even when disabled
	svc.PublishEvent(evt)
}

func TestService_PublishNilEvent(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	svc := GetService()

	// Should not panic
	svc.PublishEvent(nil)
}

func TestService_GetConfig(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "json",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	retrievedCfg := svc.GetConfig()
	if retrievedCfg == nil {
		t.Error("GetConfig() returned nil")
		return
	}

	if retrievedCfg.Output.Type != OutputTypeConsole {
		t.Errorf("Config Output.Type = %s, want console", retrievedCfg.Output.Type)
	}
}

func TestService_GetPublisher(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	svc := GetService()

	pub := svc.GetPublisher()
	if pub != nil {
		t.Error("GetPublisher() should return nil publisher for disabled service")
	}
}

func TestService_GetDefaultSubscriber(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "json",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	sub := svc.GetDefaultSubscriber()
	if sub == nil {
		t.Error("GetDefaultSubscriber() should return non-nil subscriber for enabled service")
		return
	}

	if sub.GetID() == "" {
		t.Error("Default subscriber should have non-empty ID")
	}
}

func TestService_Shutdown(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "json",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	// Publish an event
	evt := event.NewEvent("trace-123", string(event.EventTypeAuthenticationStarted), "test")
	svc.PublishEvent(evt)

	// Shutdown should not panic
	svc.Shutdown()

	// Verify service is disabled after shutdown
	if svc.IsEnabled() {
		t.Error("Service should be disabled after shutdown")
	}
}

func TestService_ShutdownDisabled(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: false,
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	// Shutdown should not panic even when disabled
	svc.Shutdown()
}

func TestService_FileOutputType(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "file",
			Format: "json",
			File: FileOutputConfig{
				Path: "/tmp/thunder-test-analytics.log",
			},
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	if !svc.IsEnabled() {
		t.Error("Service should be enabled for file output")
	}

	// Cleanup
	svc.Shutdown()
}

func TestService_UnknownOutputType(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "unknown-type",
			Format: "json",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	// Should fall back to console adapter
	if !svc.IsEnabled() {
		t.Error("Service should be enabled with console fallback")
	}

	// Cleanup
	svc.Shutdown()
}

func TestService_UnknownFormatType(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "unknown-format",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	// Should fall back to JSON formatter
	if !svc.IsEnabled() {
		t.Error("Service should be enabled with JSON fallback")
	}

	// Cleanup
	svc.Shutdown()
}

func TestService_MultipleEvents(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	svc := GetService()

	events := []*event.Event{
		event.NewEvent("trace-1", string(event.EventTypeAuthenticationStarted), "test"),
		event.NewEvent("trace-1", string(event.EventTypeAuthenticationCompleted), "test"),
		event.NewEvent("trace-1", string(event.EventTypeTokenIssued), "test"),
	}

	for _, evt := range events {
		svc.PublishEvent(evt)
	}

	// Give time to process all events
	time.Sleep(100 * time.Millisecond)

	// Cleanup
	svc.Shutdown()
}

func TestService_IsEnabled(t *testing.T) {
	tests := []struct {
		name    string
		enabled bool
		want    bool
	}{
		{
			name:    "enabled service",
			enabled: true,
			want:    true,
		},
		{
			name:    "disabled service",
			enabled: false,
			want:    false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Reset singleton for testing
			serviceOnce = sync.Once{}
			serviceInstance = nil

			cfg := &Config{
				Enabled: tt.enabled,
				Output: OutputConfig{
					Type:   "console",
					Format: "json",
				},
			}

			svc, err := InitializeWithConfig(cfg)
			if err != nil {
				t.Fatalf("InitializeWithConfig() error = %v", err)
			}

			if got := svc.IsEnabled(); got != tt.want {
				t.Errorf("IsEnabled() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestService_DefaultConfig(t *testing.T) {
	// Reset singleton for testing
	serviceOnce = sync.Once{}
	serviceInstance = nil

	cfg := &Config{
		Enabled: true,
		Output: OutputConfig{
			Type:   "console",
			Format: "json",
		},
	}

	svc, err := InitializeWithConfig(cfg)
	if err != nil {
		t.Fatalf("InitializeWithConfig() error = %v", err)
	}

	if !svc.IsEnabled() {
		t.Error("Service should be enabled with config")
	}

	retrievedCfg := svc.GetConfig()
	if retrievedCfg.Output.Type != "console" {
		t.Errorf("Output type = %s, want console", retrievedCfg.Output.Type)
	}

	if retrievedCfg.Output.Format != "json" {
		t.Errorf("Format = %s, want json", retrievedCfg.Output.Format)
	}
}
