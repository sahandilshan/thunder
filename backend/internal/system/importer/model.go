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
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package importer

import "time"

const (
	operationCreate = "create"
	operationUpdate = "update"

	statusSuccess = "success"
	statusFailed  = "failed"
)

// ImportRequest carries the YAML payload and variable values used to resolve templates.
type ImportRequest struct {
	Content   string                 `json:"content"`
	Variables map[string]interface{} `json:"variables,omitempty"`
	DryRun    bool                   `json:"dryRun,omitempty"`
	Options   *ImportOptions         `json:"options,omitempty"`
}

// ImportOptions controls runtime import behavior.
type ImportOptions struct {
	Upsert          *bool  `json:"upsert,omitempty"`
	ContinueOnError *bool  `json:"continueOnError,omitempty"`
	Target          string `json:"target,omitempty"`
}

// IsUpsertEnabled returns whether upsert behavior is enabled.
// Defaults to true when the option is omitted.
func (o *ImportOptions) IsUpsertEnabled() bool {
	if o == nil || o.Upsert == nil {
		return true
	}

	return *o.Upsert
}

// IsContinueOnErrorEnabled returns whether import should continue after item-level failures.
// Defaults to true when the option is omitted.
func (o *ImportOptions) IsContinueOnErrorEnabled() bool {
	if o == nil || o.ContinueOnError == nil {
		return true
	}

	return *o.ContinueOnError
}

// ImportResponse captures overall and per-document outcomes.
type ImportResponse struct {
	Summary *ImportSummary      `json:"summary"`
	Results []ImportItemOutcome `json:"results"`
}

// DeleteResourceRequest identifies a declarative resource file to remove.
type DeleteResourceRequest struct {
	ResourceType string `json:"resourceType"`
	ResourceKey  string `json:"resourceKey"`
}

// DeleteResourceResponse reports the deleted declarative resource file outcome.
type DeleteResourceResponse struct {
	ResourceType string `json:"resourceType"`
	ResourceKey  string `json:"resourceKey"`
	DeletedFile  string `json:"deletedFile"`
}

// ImportSummary aggregates import metrics.
type ImportSummary struct {
	TotalDocuments int       `json:"totalDocuments"`
	Imported       int       `json:"imported"`
	Failed         int       `json:"failed"`
	ImportedAt     time.Time `json:"importedAt"`
}

// ImportItemOutcome reports the result of one resource document.
type ImportItemOutcome struct {
	ResourceType string `json:"resourceType"`
	ResourceID   string `json:"resourceId,omitempty"`
	ResourceName string `json:"resourceName,omitempty"`
	Operation    string `json:"operation,omitempty"`
	Status       string `json:"status"`
	Code         string `json:"code,omitempty"`
	Message      string `json:"message,omitempty"`
}
