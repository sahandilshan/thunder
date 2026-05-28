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

import {execSync} from 'child_process';
import * as fs from 'fs';
import type {IncomingMessage} from 'http';
import * as https from 'https';
import * as os from 'os';
import * as path from 'path';
import ThunderRepo from './constants/ThunderRepo';

const PLATFORM_MAP: Record<string, string> = {darwin: 'macos', linux: 'linux', win32: 'win'};
const ARCH_MAP: Record<string, string> = {x64: 'x64', arm64: 'arm64'};
const RELEASES_URL = `https://${ThunderRepo.DOMAIN}/data/releases.json`;

interface ReleaseAsset {
  name: string;
  downloadUrl: string;
}

interface Release {
  tagName: string;
  isLatest: boolean;
  assets: ReleaseAsset[];
}

interface ReleasesData {
  latestRelease: Release;
  releases: Release[];
}

export function getPlatformAsset(version: string): string {
  const platform = PLATFORM_MAP[process.platform];
  const arch = ARCH_MAP[process.arch];
  if (!platform || !arch) {
    throw new Error(`Unsupported platform: ${process.platform}/${process.arch}`);
  }
  return `${ThunderRepo.HANDLE}-${version}-${platform}-${arch}.zip`;
}

function fetchWithRedirects(url: string): Promise<IncomingMessage> {
  return new Promise((resolve, reject) => {
    https
      .get(url, {headers: {'User-Agent': 'thunderid-npx'}}, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          void fetchWithRedirects(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        resolve(res);
      })
      .on('error', reject);
  });
}

function fetchJson<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    https
      .get(url, {headers: {'User-Agent': 'thunderid-npx'}}, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          void fetchJson<T>(res.headers.location).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        let body = '';
        res.on('data', (chunk: string) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body) as T);
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        });
      })
      .on('error', reject);
  });
}

async function fetchReleasesData(): Promise<ReleasesData> {
  try {
    return await fetchJson<ReleasesData>(RELEASES_URL);
  } catch {
    // Fallback: reconstruct ReleasesData shape from GitHub API
    const ghUrl = `https://api.github.com/repos/${ThunderRepo.REPO}/releases/latest`;
    const gh = await fetchJson<{tag_name?: string; assets?: {name: string; browser_download_url: string}[]}>(ghUrl);
    if (!gh.tag_name) throw new Error('tag_name missing from GitHub release response');
    const release: Release = {
      tagName: gh.tag_name,
      isLatest: true,
      assets: (gh.assets ?? []).map((a) => ({name: a.name, downloadUrl: a.browser_download_url})),
    };
    return {latestRelease: release, releases: [release]};
  }
}

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (received: number, total: number) => void,
): Promise<void> {
  const res = await fetchWithRedirects(url);
  const total = parseInt(res.headers['content-length'] ?? '0', 10);
  let received = 0;

  await new Promise<void>((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    res.on('data', (chunk: Buffer) => {
      received += chunk.length;
      if (total && onProgress) {
        onProgress(received, total);
      }
    });
    res.pipe(file);
    file.on('finish', () => file.close(() => resolve()));
    file.on('error', reject);
    res.on('error', reject);
  });
}

function extractZip(zipPath: string, destDir: string): void {
  fs.mkdirSync(destDir, {recursive: true});
  if (process.platform === 'win32') {
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, {stdio: 'pipe'});
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, {stdio: 'pipe'});
  }
}

export async function downloadAndExtract(
  version: string,
  destDir: string,
  onStatus?: (msg: string) => void,
): Promise<void> {
  const assetName = getPlatformAsset(version);

  const data = await fetchReleasesData();
  const release = data.releases.find((r) => r.tagName === `v${version}`) ?? data.latestRelease;
  const asset = release.assets.find((a) => a.name === assetName);
  if (!asset) {
    throw new Error(`No release asset found for ${assetName}`);
  }

  const zipPath = path.join(os.tmpdir(), assetName);

  onStatus?.(`Downloading Thunder v${version} for ${process.platform}/${process.arch}`);
  await downloadFile(asset.downloadUrl, zipPath, (received, total) => {
    const pct = Math.round((received / total) * 100);
    onStatus?.(`Downloading Thunder v${version} — ${pct}%`);
  });

  onStatus?.('Extracting...');
  extractZip(zipPath, destDir);

  try {
    fs.unlinkSync(zipPath);
  } catch {
    /* ignore */
  }
}

export async function getLatestThunderVersion(): Promise<string> {
  const data = await fetchReleasesData();
  const tag = data.latestRelease.tagName;
  if (!tag) throw new Error('tagName missing from releases data');
  return tag.replace(/^v/, '');
}
