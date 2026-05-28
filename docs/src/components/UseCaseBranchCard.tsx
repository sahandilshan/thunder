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

import Link from '@docusaurus/Link';
import React from 'react';

interface UseCaseBranchCardProps {
  href: string;
  animationClass: string;
  icon: React.ReactNode;
  accentColor: string;
  iconBackground: string;
  category: string;
  title: string;
  description: string;
  bullets: string[];
}

export default function UseCaseBranchCard({
  href,
  animationClass,
  icon,
  accentColor,
  iconBackground,
  category,
  title,
  description,
  bullets,
}: UseCaseBranchCardProps) {
  return (
    <Link
      to={href}
      className={`uc-card uc-branch-card ${animationClass}`}
      style={{
        ['--uc-branch-accent' as string]: accentColor,
        ['--uc-branch-icon-bg' as string]: iconBackground,
      }}
    >
      <div className="uc-branch-icon">{icon}</div>

      <div className="uc-branch-category">{category}</div>

      <div className="uc-branch-title">{title}</div>

      <div className="uc-branch-description">{description}</div>

      <div className="uc-branch-when">
        <div className="uc-branch-when-label">Choose when</div>

        <ul className="uc-branch-when-list">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </div>

      <span className="uc-branch-link">View pattern -&gt;</span>
    </Link>
  );
}
