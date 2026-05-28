/**
 * Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

export type Persona = 'all' | 'app' | 'iam' | 'devops';

export const STORAGE_KEY = 'product-docs-persona';

export interface PersonaOption {
  value: Persona;
  label: string;
  description: string;
}

export function getPersonaOptions(productName: string): PersonaOption[] {
  return [
    {value: 'all', label: 'All Roles', description: 'Browse all documentation'},
    {value: 'app', label: 'Application Developer', description: `Integrate ${productName} into your app`},
    {value: 'iam', label: 'IAM Developer', description: `Configure and manage ${productName}`},
    {value: 'devops', label: 'DevOps Engineer', description: `Deploy and operate ${productName}`},
  ];
}

export function applyPersona(persona: Persona): void {
  const html = document.documentElement;
  if (persona === 'all') {
    html.removeAttribute('data-persona');
  } else {
    html.setAttribute('data-persona', persona);
  }
}
