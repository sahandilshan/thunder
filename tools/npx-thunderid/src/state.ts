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
import * as os from 'os';
import * as path from 'path';

interface InstallEntry {
  installPath: string;
  setupComplete: boolean;
  installedAt: string;
}

interface ThunderState {
  installs: Record<string, InstallEntry>;
  lastUsedVersion: string | null;
}

export const STATE_DIR = path.join(os.homedir(), '.thunderid');
const STATE_FILE = path.join(STATE_DIR, 'state.json');

function normalizeState(rawState: unknown): ThunderState {
  if (!rawState || typeof rawState !== 'object') {
    return {installs: {}, lastUsedVersion: null};
  }

  const raw = rawState as Record<string, unknown>;

  if (raw['installs'] && typeof raw['installs'] === 'object') {
    return {
      installs: raw['installs'] as Record<string, InstallEntry>,
      lastUsedVersion: (raw['lastUsedVersion'] as string) || null,
    };
  }

  if (typeof raw['version'] === 'string' && typeof raw['installPath'] === 'string') {
    return {
      installs: {
        [raw['version']]: {
          installPath: raw['installPath'],
          setupComplete: Boolean(raw['setupComplete']),
          installedAt: (raw['installedAt'] as string) || new Date().toISOString(),
        },
      },
      lastUsedVersion: raw['version'],
    };
  }

  return {installs: {}, lastUsedVersion: null};
}

export function readState(): ThunderState {
  try {
    const rawState: unknown = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return normalizeState(rawState);
  } catch {
    return normalizeState(null);
  }
}

export function writeState(version: string, installPath: string, setupComplete = false): void {
  const currentState = readState();
  const nextState: ThunderState = {
    installs: {
      ...currentState.installs,
      [version]: {
        installPath,
        setupComplete,
        installedAt: currentState.installs[version]?.installedAt || new Date().toISOString(),
      },
    },
    lastUsedVersion: version,
  };

  fs.mkdirSync(STATE_DIR, {recursive: true});
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2));
}

export function markSetupComplete(version: string): void {
  const currentState = readState();
  const versionEntry = currentState.installs[version];

  if (!versionEntry) {
    return;
  }

  const nextState: ThunderState = {
    installs: {
      ...currentState.installs,
      [version]: {
        ...versionEntry,
        setupComplete: true,
      },
    },
    lastUsedVersion: version,
  };

  fs.mkdirSync(STATE_DIR, {recursive: true});
  fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2));
}
