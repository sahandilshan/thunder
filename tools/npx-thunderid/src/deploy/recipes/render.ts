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

import * as fs from 'fs';
import * as path from 'path';
import {log, note} from '@clack/prompts';
import colors from 'picocolors';
import type {Recipe, DeployOptions} from '../../models/deploy';

interface RenderYamlOptions {
  appName: string;
  dbType: string;
}

function getRenderYaml({appName, dbType}: RenderYamlOptions): string {
  const lines = [
    `services:`,
    `  - type: web`,
    `    name: ${appName}`,
    `    env: docker`,
    `    dockerfilePath: ./Dockerfile`,
    `    dockerContext: .`,
    `    healthCheckPath: /health`,
  ];

  if (dbType === 'sqlite') {
    lines.push(`    disk:`, `      name: thunder-data`, `      mountPath: /data`, `      sizeGB: 1`);
  }

  if (dbType === 'postgres') {
    lines.push(`    envVars:`, `      - key: DATABASE_URL`, `        sync: false`);
  }

  return lines.join('\n') + '\n';
}

const render: Recipe = {
  id: 'render',
  displayName: 'Render',
  description: 'Free tier web services — generates files, requires GitHub',
  comingSoon: true,

  preflight(): Promise<void> {
    return Promise.resolve();
  },

  deploy({appName = 'thunder-app', dbType}: DeployOptions): Promise<void> {
    const cwd = process.cwd();

    fs.writeFileSync(path.join(cwd, 'render.yaml'), getRenderYaml({appName, dbType}), 'utf8');
    log.success('Generated render.yaml');

    const steps = [
      `Files ready: ${colors.cyan('Dockerfile')} + ${colors.cyan('render.yaml')}`,
      ``,
      `Next steps:`,
      `  1. Commit and push this directory to a GitHub repository`,
      `  2. Go to ${colors.cyan('https://render.com')} → New → Web Service`,
      `  3. Connect your GitHub repo — Render auto-detects ${colors.cyan('render.yaml')}`,
    ];

    if (dbType === 'postgres') {
      steps.push(`  4. Set ${colors.cyan('DATABASE_URL')} under Environment in the Render dashboard`);
    }

    note(steps.join('\n'), 'Render — complete setup in the dashboard');
    return Promise.resolve();
  },
};

export default render;
