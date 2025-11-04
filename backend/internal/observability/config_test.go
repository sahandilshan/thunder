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
	"testing"
	"time"
)

func TestDefaultConfig(t *testing.T) {
	cfg := DefaultConfig()

	if cfg == nil {
		t.Fatal("DefaultConfig() returned nil")
	}

	// Verify default disable state
	if cfg.Enabled {
		t.Error("DefaultConfig() should have Enabled = false")
	}

	// Verify default output type
	if cfg.Output.Type != OutputTypeConsole {
		t.Errorf("DefaultConfig() Output.Type = %s, want console", cfg.Output.Type)
	}

	// Verify default format
	if cfg.Output.Format != FormatJSON {
		t.Errorf("DefaultConfig() Output.Format = %s, want json", cfg.Output.Format)
	}

	// Verify metrics disabled
	if cfg.Metrics.Enabled {
		t.Error("DefaultConfig() should have Metrics.Enabled = false")
	}

	// Verify metrics export interval
	if cfg.Metrics.ExportInterval != 60*time.Second {
		t.Errorf("DefaultConfig() Metrics.ExportInterval = %v, want 60s", cfg.Metrics.ExportInterval)
	}

	// Verify default failure mode
	if cfg.FailureMode != "graceful" {
		t.Errorf("DefaultConfig() FailureMode = %s, want graceful", cfg.FailureMode)
	}
}

func TestConfig_CustomConfiguration(t *testing.T) {
	cfg := &Config{
		Enabled: false,
		Output: OutputConfig{
			File: FileOutputConfig{
				Path:       "/var/log/thunder/events.log",
				BufferSize: 8192,
			},
		},
		Metrics: MetricsConfig{
			Enabled:        false,
			ExportInterval: 120 * time.Second,
		},
		FailureMode: "strict",
	}

	if cfg.Enabled {
		t.Error("Custom config should have Enabled = false")
	}

	if cfg.Output.File.Path != "/var/log/thunder/events.log" {
		t.Errorf("Output.File.Path = %s, want /var/log/thunder/events.log", cfg.Output.File.Path)
	}

	if cfg.Metrics.Enabled {
		t.Error("Metrics should be disabled")
	}

	if cfg.FailureMode != "strict" {
		t.Errorf("FailureMode = %s, want strict", cfg.FailureMode)
	}
}

func TestOutputConfig_FileConfiguration(t *testing.T) {
	cfg := OutputConfig{
		File: FileOutputConfig{
			Path:          "/var/log/thunder/events.log",
			BufferSize:    16384,
			FlushInterval: 5 * time.Second,
			MaxFileSize:   100,
			MaxBackups:    10,
			MaxAge:        30,
			Compress:      true,
		},
	}

	if cfg.File.Path != "/var/log/thunder/events.log" {
		t.Errorf("File.Path = %s", cfg.File.Path)
	}

	if cfg.File.BufferSize != 16384 {
		t.Errorf("File.BufferSize = %d, want 16384", cfg.File.BufferSize)
	}

	if cfg.File.FlushInterval != 5*time.Second {
		t.Errorf("File.FlushInterval = %v, want 5s", cfg.File.FlushInterval)
	}

	if cfg.File.MaxFileSize != 100 {
		t.Errorf("File.MaxFileSize = %d, want 100", cfg.File.MaxFileSize)
	}

	if cfg.File.MaxBackups != 10 {
		t.Errorf("File.MaxBackups = %d, want 10", cfg.File.MaxBackups)
	}

	if cfg.File.MaxAge != 30 {
		t.Errorf("File.MaxAge = %d, want 30", cfg.File.MaxAge)
	}

	if !cfg.File.Compress {
		t.Error("File.Compress should be true")
	}
}

func TestMetricsConfig(t *testing.T) {
	tests := []struct {
		name         string
		config       MetricsConfig
		wantEnabled  bool
		wantInterval time.Duration
	}{
		{
			name: "metrics enabled",
			config: MetricsConfig{
				Enabled:        true,
				ExportInterval: 60 * time.Second,
			},
			wantEnabled:  true,
			wantInterval: 60 * time.Second,
		},
		{
			name: "metrics disabled",
			config: MetricsConfig{
				Enabled:        false,
				ExportInterval: 0,
			},
			wantEnabled:  false,
			wantInterval: 0,
		},
		{
			name: "custom interval",
			config: MetricsConfig{
				Enabled:        true,
				ExportInterval: 5 * time.Minute,
			},
			wantEnabled:  true,
			wantInterval: 5 * time.Minute,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.config.Enabled != tt.wantEnabled {
				t.Errorf("Enabled = %v, want %v", tt.config.Enabled, tt.wantEnabled)
			}
			if tt.config.ExportInterval != tt.wantInterval {
				t.Errorf("ExportInterval = %v, want %v", tt.config.ExportInterval, tt.wantInterval)
			}
		})
	}
}

func TestConfig_FailureModes(t *testing.T) {
	tests := []struct {
		name        string
		failureMode string
	}{
		{
			name:        "graceful mode",
			failureMode: "graceful",
		},
		{
			name:        "strict mode",
			failureMode: "strict",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := &Config{
				FailureMode: tt.failureMode,
			}

			if cfg.FailureMode != tt.failureMode {
				t.Errorf("FailureMode = %s, want %s", cfg.FailureMode, tt.failureMode)
			}
		})
	}
}

func TestConfig_MultipleOutputFormats(t *testing.T) {
	formats := []string{"json", "csv", "xml"}

	for _, format := range formats {
		t.Run(format, func(t *testing.T) {
			cfg := &Config{
				Output: OutputConfig{
					Format: format,
				},
			}

			if cfg.Output.Format != format {
				t.Errorf("Output.Format = %s, want %s", cfg.Output.Format, format)
			}
		})
	}
}

func TestConfig_ZeroValues(t *testing.T) {
	cfg := &Config{}

	if cfg.Enabled {
		t.Error("Zero-value config should have Enabled = false")
	}

	if cfg.Output.Type != "" {
		t.Errorf("Zero-value Output.Type should be empty, got %s", cfg.Output.Type)
	}

	if cfg.Output.Format != "" {
		t.Errorf("Zero-value Output.Format should be empty, got %s", cfg.Output.Format)
	}

	if cfg.Metrics.Enabled {
		t.Error("Zero-value Metrics.Enabled should be false")
	}

	if cfg.FailureMode != "" {
		t.Errorf("Zero-value FailureMode should be empty, got %s", cfg.FailureMode)
	}
}

func TestFileOutputConfig_RotationDefaults(t *testing.T) {
	cfg := FileOutputConfig{
		// Leave rotation params as zero values
	}

	if cfg.MaxFileSize != 0 {
		t.Errorf("MaxFileSize should default to 0, got %d", cfg.MaxFileSize)
	}

	if cfg.MaxBackups != 0 {
		t.Errorf("MaxBackups should default to 0, got %d", cfg.MaxBackups)
	}

	if cfg.MaxAge != 0 {
		t.Errorf("MaxAge should default to 0, got %d", cfg.MaxAge)
	}

	if cfg.Compress {
		t.Error("Compress should default to false")
	}
}
