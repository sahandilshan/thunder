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

import React from 'react';

interface RoadmapNode {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const roadmapNodes: RoadmapNode[] = [
  {
    href: '#add-login-to-your-application',
    label: 'Sign In',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M14 3h6v18h-6" />
        <path d="M10 12h10" />
        <path d="m7 9 3 3-3 3" />
        <path d="M4 4h8v16H4" />
      </svg>
    ),
  },
  {
    href: '#enable-self-sign-up',
    label: 'Self Sign-Up',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M19 8v6" />
        <path d="M16 11h6" />
      </svg>
    ),
  },
  {
    href: '#add-self-service-profile-management',
    label: 'Manage Profile',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21a8 8 0 0 1 16 0" />
      </svg>
    ),
  },
  {
    href: '#add-account-recovery',
    label: 'Recover Access',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M7 11V9a5 5 0 0 1 10 0v2" />
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <path d="M12 15v2" />
      </svg>
    ),
  },
  {
    href: '#onboard-internal-users',
    label: 'Internal Users',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
        <path d="M3 13h18" />
      </svg>
    ),
  },
  {
    href: '#handle-account-closure',
    label: 'Close Accounts',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="9" />
        <path d="m8 8 8 8" />
        <path d="m16 8-8 8" />
      </svg>
    ),
  },
  {
    href: '#defend-against-abuse-and-risk',
    label: 'Defend Against Abuse',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '#gain-identity-insights',
    label: 'Identity Insights',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 3v18h18" />
        <path d="m7 14 4-4 4 4 5-6" />
      </svg>
    ),
  },
];

const solutionPatternNodes: RoadmapNode[] = [
  {
    href: '#integration-approaches',
    label: 'Integration Approaches',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 12h6" />
        <path d="m7 9 3 3-3 3" />
        <path d="M20 12h-6" />
        <path d="m17 9-3 3 3 3" />
      </svg>
    ),
  },
  {
    href: '#identity-sources-and-data',
    label: 'Identity Sources',
    icon: (
      <svg viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5v6c0 1.7 4 3 9 3s9-1.3 9-3V5" />
        <path d="M3 11v6c0 1.7 4 3 9 3s9-1.3 9-3v-6" />
      </svg>
    ),
  },
  {
    href: '#tokens-sessions-and-apis',
    label: 'Tokens & APIs',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="8" cy="12" r="3.5" />
        <path d="M11.5 12H22" />
        <path d="M18 12v3" />
        <path d="M21 12v2" />
      </svg>
    ),
  },
  {
    href: '#run-observe-and-integrate',
    label: 'Run & Observe',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3v3" />
        <path d="M12 18v3" />
        <path d="M3 12h3" />
        <path d="M18 12h3" />
        <path d="m5.6 5.6 2.1 2.1" />
        <path d="m16.3 16.3 2.1 2.1" />
        <path d="m5.6 18.4 2.1-2.1" />
        <path d="m16.3 7.7 2.1-2.1" />
      </svg>
    ),
  },
  {
    href: '#cross-cutting-choices',
    label: 'Cross-Cutting',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M3 6h18" />
        <path d="M3 12h18" />
        <path d="M3 18h18" />
      </svg>
    ),
  },
];

const integrationApproachNodes: RoadmapNode[] = [
  {
    href: '#redirect-based',
    label: 'Redirect-Based',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 12h12" />
        <path d="m12 6 6 6-6 6" />
        <circle cx="20" cy="12" r="2" />
      </svg>
    ),
  },
  {
    href: '#app-native',
    label: 'App-Native',
    icon: (
      <svg viewBox="0 0 24 24">
        <rect x="3" y="4" width="7" height="7" rx="1" />
        <rect x="14" y="4" width="7" height="7" rx="1" />
        <rect x="3" y="13" width="7" height="7" rx="1" />
        <rect x="14" y="13" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    href: '#direct-api',
    label: 'Direct API',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="m8 4-6 8 6 8" />
        <path d="m16 4 6 8-6 8" />
        <path d="M14 4 10 20" />
      </svg>
    ),
  },
];

export function B2CIdentityJourneyRoadmap() {
  return (
    <nav className="uc-b2c-roadmap" aria-label="B2C identity use case roadmap">
      {roadmapNodes.map((node) => (
        <a key={node.href} href={node.href} className="uc-b2c-roadmap__node">
          <span className="uc-b2c-roadmap__icon" aria-hidden>
            {node.icon}
          </span>
          <span className="uc-b2c-roadmap__label">{node.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function B2CSolutionPatternsRoadmap() {
  return (
    <nav className="uc-b2c-roadmap" aria-label="B2C solution pattern roadmap">
      {solutionPatternNodes.map((node) => (
        <a key={node.href} href={node.href} className="uc-b2c-roadmap__node">
          <span className="uc-b2c-roadmap__icon" aria-hidden>
            {node.icon}
          </span>
          <span className="uc-b2c-roadmap__label">{node.label}</span>
        </a>
      ))}
    </nav>
  );
}

export function B2CIntegrationApproachesRoadmap() {
  return (
    <nav className="uc-b2c-roadmap" aria-label="B2C integration approaches roadmap">
      {integrationApproachNodes.map((node) => (
        <a key={node.href} href={node.href} className="uc-b2c-roadmap__node">
          <span className="uc-b2c-roadmap__icon" aria-hidden>
            {node.icon}
          </span>
          <span className="uc-b2c-roadmap__label">{node.label}</span>
        </a>
      ))}
    </nav>
  );
}
