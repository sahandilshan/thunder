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
    href: '#protect-your-agent',
    label: 'Protect Your Agent',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M12 3 4 7v5c0 4.42 3.36 8.56 8 9.56 4.64-1 8-5.14 8-9.56V7z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
  {
    href: '#connect-to-services',
    label: 'Connect to Services',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="6" cy="12" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="18" cy="18" r="2" />
        <path d="M8 12h6" />
        <path d="m14 7-2 3" />
        <path d="m14 17-2-3" />
      </svg>
    ),
  },
  {
    href: '#multi-agent-workflows',
    label: 'Multi-Agent Workflows',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="5" cy="12" r="2" />
        <circle cx="12" cy="5" r="2" />
        <circle cx="19" cy="12" r="2" />
        <circle cx="12" cy="19" r="2" />
        <path d="M7 12h3" />
        <path d="M14 12h3" />
        <path d="M12 7v3" />
        <path d="M12 14v3" />
      </svg>
    ),
  },
];

const solutionPatternNodes: RoadmapNode[] = [
  {
    href: '#client-credentials-grant',
    label: 'Client Credentials',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M7 11V9a5 5 0 0 1 10 0v2" />
        <rect x="5" y="11" width="14" height="9" rx="2" />
        <circle cx="12" cy="16" r="1" />
      </svg>
    ),
  },
  {
    href: '#authorization-code-with-obo',
    label: 'Interactive Delegation',
    icon: (
      <svg viewBox="0 0 24 24">
        <circle cx="8" cy="8" r="3" />
        <path d="M4 20v-2a4 4 0 0 1 4-4h1" />
        <path d="M14 14h6" />
        <path d="m17 11 3 3-3 3" />
      </svg>
    ),
  },
  {
    href: '#backchannel-authorization-ciba',
    label: 'Background Delegation',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        <circle cx="18" cy="6" r="3" />
      </svg>
    ),
  },
  {
    href: '#token-exchange',
    label: 'Token Exchange',
    icon: (
      <svg viewBox="0 0 24 24">
        <path d="M4 8h14" />
        <path d="m15 5 3 3-3 3" />
        <path d="M20 16H6" />
        <path d="m9 19-3-3 3-3" />
      </svg>
    ),
  },
];

export function AIAgentIdentityRoadmap() {
  return (
    <nav className="uc-b2c-roadmap" aria-label="AI agent identity use case roadmap">
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

export function AIAgentSolutionPatternsRoadmap() {
  return (
    <nav className="uc-b2c-roadmap" aria-label="AI agent solution pattern roadmap">
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
