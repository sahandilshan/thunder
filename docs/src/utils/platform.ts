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

export type OsKey = 'linux' | 'macos' | 'win';
export type ArchKey = 'arm64' | 'x64';

export interface DetectedPlatform {
  arch: ArchKey | null;
  os: OsKey | null;
}

interface NavigatorWithUserAgentData extends Navigator {
  userAgentData?: {
    getHighEntropyValues?: (
      hints: ('architecture' | 'bitness' | 'platform')[],
    ) => Promise<{architecture?: string; bitness?: string; platform?: string}>;
  };
}

export function detectOperatingSystem(userAgent: string, platform: string): OsKey | null {
  const ua = userAgent.toLowerCase();
  const pf = platform.toLowerCase();

  if (pf.includes('mac') || /(mac os x|macintosh)/.test(ua)) return 'macos';
  if (pf.includes('win') || ua.includes('windows')) return 'win';
  if (pf.includes('linux') || ua.includes('linux')) return 'linux';
  return null;
}

export function detectArchitecture(userAgent: string, os: OsKey | null): ArchKey | null {
  const ua = userAgent.toLowerCase();

  if (/(arm64|aarch64|armv8|apple silicon|silicon)/.test(ua)) return 'arm64';

  if (/\b(wow64|win64|x64|x86_64|amd64|intel)\b/.test(ua)) {
    // Safari on Apple Silicon often surfaces Intel-style tokens in the UA string.
    // Avoid recommending x64 on macOS without explicit ARM evidence.
    if (os === 'macos') return null;
    return 'x64';
  }

  return null;
}

export async function detectPlatform(): Promise<DetectedPlatform> {
  if (typeof navigator === 'undefined') return {arch: null, os: null};

  const {platform, userAgent} = navigator;
  const fallbackOs = detectOperatingSystem(userAgent, platform);
  const fallback: DetectedPlatform = {arch: detectArchitecture(userAgent, fallbackOs), os: fallbackOs};

  const {userAgentData} = navigator as NavigatorWithUserAgentData;
  if (!userAgentData?.getHighEntropyValues) return fallback;

  try {
    const v = await userAgentData.getHighEntropyValues(['architecture', 'bitness', 'platform']);
    const detPf = v.platform?.toLowerCase() ?? '';
    const detArch = v.architecture?.toLowerCase() ?? '';
    const detBits = v.bitness?.toLowerCase() ?? '';

    const os: OsKey | null =
      detPf === 'macos' ? 'macos' : detPf === 'windows' ? 'win' : detPf === 'linux' ? 'linux' : fallback.os;
    const arch: ArchKey | null =
      detArch === 'arm' ? 'arm64' : detArch === 'x86' && detBits === '64' ? 'x64' : fallback.arch;

    return {arch, os};
  } catch {
    return fallback;
  }
}
