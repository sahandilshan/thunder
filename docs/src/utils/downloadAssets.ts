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

import type {ArchKey, DetectedPlatform, OsKey} from './platform';

export interface ReleaseAssetInput {
  downloadUrl: string;
  name: string;
  sizeLabel: string;
}

export interface DistributionAsset {
  arch: ArchKey;
  archLabel: string;
  downloadUrl: string;
  name: string;
  os: OsKey;
  osLabel: string;
  sizeLabel: string;
}

export interface ReleaseEntry {
  assets: ReleaseAssetInput[];
  tagName: string;
}

export interface ReleasesData {
  latestRelease: ReleaseEntry | null;
  releases: ReleaseEntry[];
}

const OS_LABELS: Record<OsKey, string> = {
  linux: 'Linux',
  macos: 'Mac OS',
  win: 'Windows',
};

const VALID_OS = new Set<string>(Object.keys(OS_LABELS));
const VALID_ARCH = new Set<string>(['arm64', 'x64']);

function archLabel(os: OsKey, arch: ArchKey): string {
  if (os === 'macos') {
    return arch === 'arm64' ? 'ARM64 (Apple Silicon)' : 'x64 (Intel)';
  }
  return arch === 'arm64' ? 'ARM64' : 'x64';
}

/**
 * Parse release assets that match the given filename pattern. The pattern must
 * capture (os, arch) as groups 1 and 2 respectively.
 */
export function parseDistributionAssets(
  assets: ReleaseAssetInput[],
  pattern: RegExp,
): DistributionAsset[] {
  const result: DistributionAsset[] = [];
  for (const asset of assets) {
    pattern.lastIndex = 0;
    const match = pattern.exec(asset.name);
    if (!match) continue;
    if (!VALID_OS.has(match[1]) || !VALID_ARCH.has(match[2])) continue;
    const os = match[1] as OsKey;
    const arch = match[2] as ArchKey;
    result.push({
      arch,
      archLabel: archLabel(os, arch),
      downloadUrl: asset.downloadUrl,
      name: asset.name,
      os,
      osLabel: OS_LABELS[os],
      sizeLabel: asset.sizeLabel,
    });
  }
  return result;
}

/**
 * Pick the asset that best matches the detected platform. Falls back to the
 * same OS with a different arch, then to the first asset, then null.
 */
export function pickAssetForPlatform(
  assets: DistributionAsset[],
  platform: DetectedPlatform | null,
): DistributionAsset | null {
  if (assets.length === 0) return null;
  return (
    assets.find((a) => a.os === platform?.os && a.arch === platform?.arch) ??
    assets.find((a) => a.os === platform?.os) ??
    assets[0]
  );
}

/**
 * Group assets by OS in a stable order, optionally prioritising the OS of the
 * detected platform first. Useful when rendering an "all platforms" grid.
 */
export function groupAssetsByOs(
  assets: DistributionAsset[],
  preferredOs?: OsKey | null,
): {os: OsKey; assets: DistributionAsset[]}[] {
  const defaultOrder: OsKey[] = ['linux', 'win', 'macos'];
  const order = preferredOs ? [preferredOs, ...defaultOrder.filter((o) => o !== preferredOs)] : defaultOrder;
  return order
    .map((os) => ({os, assets: assets.filter((a) => a.os === os)}))
    .filter((g) => g.assets.length > 0);
}
