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

import {execSync, spawnSync} from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {log} from '@clack/prompts';
import colors from 'picocolors';
import type {Recipe, DeployOptions} from '../../models/deploy';

interface FlyTomlOptions {
  appName: string;
  dbType: string;
}

function getFlyToml({appName, dbType}: FlyTomlOptions): string {
  const lines = [
    `app = "${appName}"`,
    `primary_region = "iad"`,
    ``,
    `[http_service]`,
    `  internal_port = 8090`,
    `  force_https = true`,
    `  auto_stop_machines = true`,
    `  auto_start_machines = true`,
    `  min_machines_running = 0`,
  ];

  if (dbType === 'sqlite') {
    lines.push(``, `[[mounts]]`, `  source = "thunder_data"`, `  destination = "/data"`);
  }

  return lines.join('\n') + '\n';
}

const fly: Recipe = {
  id: 'fly',
  displayName: 'Fly.io',
  description: 'Free tier, persistent volumes for SQLite, single command',
  comingSoon: true,
  cliName: 'flyctl',
  installCmd: 'curl -L https://fly.io/install.sh | sh',
  postInstallPath: path.join(os.homedir(), '.fly', 'bin'),

  preflight(): Promise<void> {
    const auth = spawnSync('flyctl', ['auth', 'whoami'], {stdio: 'pipe'});
    if (auth.status !== 0) {
      log.info('Not logged in to Fly.io — opening browser to authenticate...');
      execSync('flyctl auth login', {stdio: 'inherit'});
    }
    return Promise.resolve();
  },

  deploy({appName = 'thunder-app', dbType, dbUrl}: DeployOptions): Promise<void> {
    const cwd = process.cwd();

    fs.writeFileSync(path.join(cwd, 'fly.toml'), getFlyToml({appName, dbType}), 'utf8');
    log.success('Generated fly.toml');

    log.info(`Creating Fly.io app: ${colors.cyan(appName)}`);
    execSync(`flyctl launch --name "${appName}" --no-deploy --copy-config --yes`, {stdio: 'inherit'});

    if (dbType === 'sqlite') {
      log.info('Creating persistent volume for SQLite...');
      execSync(`flyctl volumes create thunder_data --size 1 --yes --app "${appName}"`, {stdio: 'inherit'});
    }

    if (dbType === 'postgres' && dbUrl) {
      log.info('Setting database secret...');
      execSync(`flyctl secrets set "DATABASE_URL=${dbUrl}" --app "${appName}"`, {stdio: 'inherit'});
    }

    log.info('Building and deploying (this takes a few minutes)...');
    execSync('flyctl deploy', {stdio: 'inherit'});

    log.success(`${colors.bold(colors.green('Deployed!'))} ${colors.cyan(`https://${appName}.fly.dev`)}`);
    return Promise.resolve();
  },
};

export default fly;
