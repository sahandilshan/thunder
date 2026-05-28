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

import {useActiveDocContext} from '@docusaurus/plugin-content-docs/client';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {applyPersona, getPersonaOptions, STORAGE_KEY, type Persona} from './persona-utils';
import type {DocusaurusProductConfig} from '@site/docusaurus.product.config';

export default function PersonaDropdown(): React.ReactElement | null {
  const {siteConfig} = useDocusaurusContext();
  const config = siteConfig.customFields?.product as DocusaurusProductConfig;
  const personas = getPersonaOptions(config.project.name);
  const [persona, setPersona] = useState<Persona>(() => {
    if (typeof window === 'undefined') return 'all';
    const saved = localStorage.getItem(STORAGE_KEY) as Persona | null;
    return saved && personas.some((p) => p.value === saved) ? saved : 'all';
  });

  useEffect(() => {
    applyPersona(persona);
  }, [persona]);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeDocContext = useActiveDocContext('default');
  const isDocsSidebar = activeDocContext?.activeDoc?.sidebar === 'docsSidebar';

  const handleSelect = useCallback((value: Persona) => {
    setPersona(value);
    localStorage.setItem(STORAGE_KEY, value);
    applyPersona(value);
    setIsOpen(false);
  }, []);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  if (!isDocsSidebar) {
    return null;
  }

  const current = personas.find((p) => p.value === persona) ?? personas[0];

  return (
    <div ref={containerRef} className={`persona-dropdown${isOpen ? ' persona-dropdown--open' : ''}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={`Viewing as: ${current.label}`}
        className="persona-dropdown__trigger"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
        <span className="persona-dropdown__label">{current.label}</span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`persona-dropdown__chevron${isOpen ? ' persona-dropdown__chevron--open' : ''}`}
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <ul className="persona-dropdown__menu" role="listbox" aria-label="Select your role">
          {personas.map((option) => (
            <li key={option.value} role="none">
              <button
                type="button"
                role="option"
                aria-selected={persona === option.value}
                className={`persona-dropdown__item${persona === option.value ? ' persona-dropdown__item--active' : ''}`}
                onClick={() => handleSelect(option.value)}
              >
                <span className="persona-dropdown__item-label">{option.label}</span>
                <span className="persona-dropdown__item-desc">{option.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
