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

import {useBaseUrlUtils} from '@docusaurus/useBaseUrl';
import React, {ReactNode, useEffect, useMemo, useState} from 'react';
import IOSLogo from '@site/src/components/icons/IOSLogo';
import LinuxLogo from '@site/src/components/icons/LinuxLogo';
import WindowsLogo from '@site/src/components/icons/WindowsLogo';
import usePlatform from '@site/src/hooks/usePlatform';
import {
  groupAssetsByOs,
  parseDistributionAssets,
  pickAssetForPlatform,
  type DistributionAsset,
  type ReleasesData,
} from '@site/src/utils/downloadAssets';
import type {OsKey} from '@site/src/utils/platform';

/**
 * Props for the DownloadCard component.
 */
interface DownloadCardProps {
  /**
   * A regex pattern to match the desired asset from the releases data.
   * The pattern should include named capture groups for `os` and `arch` to enable platform-specific selection.
   * For example: `^sample-app-wayfinder-[0-9A-Za-z.+-]+-(macos|linux|win)-(arm64|x64)\\.zip$`
   */
  pattern: RegExp;
  /**
   * Content to display if there was an error fetching the releases data or if no assets matched the pattern.
   */
  fallback?: ReactNode;
  /**
   * Optional content to display in the card footer, below the download options.
   * This can be used for additional instructions, links, or disclaimers related to the download.
   */
  footer?: ReactNode;
  /**
   * Whether to show download options for all platforms found in the releases data, or just the one matching the
   * user's platform. If `true`, platforms will be grouped by OS and the recommended option for the user's platform
   * will be highlighted. Defaults to `false`.
   */
  showAllPlatforms?: boolean;
  /**
   * When `showAllPlatforms` is `true`, whether to initially collapse the other platforms behind a
   * "Show other platforms" toggle. Defaults to `false`.
   */
  collapseOtherPlatforms?: boolean;
  /**
   * Whether to use a more compact layout for the card, with smaller text and tighter spacing. Defaults to `false`.
   */
  compact?: boolean;
}

// Mapping of OS keys to their corresponding icons and labels for display in the UI.
const OS_ICONS: Record<OsKey, React.ReactNode> = {
  linux: <LinuxLogo size={18} />,
  macos: <IOSLogo size={18} />,
  win: <WindowsLogo size={18} />,
};

// Mapping of OS keys to their human-readable labels for display in the UI.
const OS_LABELS: Record<OsKey, string> = {
  linux: 'Linux',
  macos: 'Mac OS',
  win: 'Windows',
};

/**
 * A card component that displays a download link for the latest release asset matching a specified pattern,
 * with optional support for showing all platform options and additional footer content.
 */
export default function DownloadCard({
  pattern,
  fallback = 'Unable to load download options at this time.',
  footer = null,
  showAllPlatforms = false,
  collapseOtherPlatforms = false,
  compact = false,
}: DownloadCardProps): ReactNode {
  const {withBaseUrl} = useBaseUrlUtils();
  const platform = usePlatform();
  const [assets, setAssets] = useState<DistributionAsset[] | null>(null);
  const [tag, setTag] = useState<string>('');
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(withBaseUrl('/data/releases.json'), {signal: controller.signal})
      .then((r) => r.json() as Promise<ReleasesData>)
      .then((data) => {
        const release = data.latestRelease ?? data.releases?.[0];
        if (!release) {
          setErrored(true);
          return;
        }
        setErrored(false);
        setTag(release.tagName);
        setAssets(parseDistributionAssets(release.assets, pattern));
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setErrored(true);
      });
    return () => controller.abort();
  }, [withBaseUrl, pattern]);

  const selected = useMemo(() => pickAssetForPlatform(assets ?? [], platform), [assets, platform]);
  const matched = selected && selected.os === platform?.os && selected.arch === platform?.arch;
  const groups = useMemo(
    () => (showAllPlatforms ? groupAssetsByOs(assets ?? [], selected?.os ?? null) : []),
    [assets, selected, showAllPlatforms],
  );

  if (errored || (assets !== null && assets.length === 0)) {
    return fallback;
  }

  if (!selected) {
    return null;
  }

  const wrapperClass = `download-card${compact ? ' download-card--compact' : ''}`;

  return (
    <div className={wrapperClass}>
      <div className="releases-download-feature">
        <div className="releases-download-feature-copy">
          <span className="releases-download-feature-kicker">
            {matched ? 'Recommended for this device' : 'Selected download'}
          </span>
          <h3>
            {selected.osLabel} · {selected.archLabel}
          </h3>
          <div className="releases-download-feature-meta">
            <span>{selected.sizeLabel}</span>
            {tag ? <span>{tag}</span> : null}
            <span>{selected.name}</span>
          </div>
        </div>
        <a className="releases-download-primary" href={selected.downloadUrl} target="_blank" rel="noreferrer">
          <span>Download for {selected.osLabel}</span>
          <span
            className="releases-download-icon"
            aria-hidden="true"
            style={{display: 'inline-flex', alignItems: 'center'}}
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{width: '20px', height: '20px'}}
            >
              <path d="M12 3v12" />
              <path d="m7 10 5 5 5-5" />
              <path d="M5 21h14" />
            </svg>
          </span>
        </a>
      </div>
      {showAllPlatforms && groups.length > 0
        ? (() => {
            const grid = (
              <div className="releases-other-downloads-grid">
                {groups.map(({os, assets: osAssets}) => (
                  <section key={os} className="releases-other-downloads-card">
                    <header className="releases-other-downloads-header">
                      <span aria-hidden="true" className="releases-other-downloads-os-icon">
                        {OS_ICONS[os]}
                      </span>
                      <h4>{OS_LABELS[os]}</h4>
                    </header>
                    <div className="releases-other-downloads-architectures">
                      {osAssets.map((asset) => {
                        const isRecommended = asset.downloadUrl === selected.downloadUrl;
                        return (
                          <a
                            key={asset.name}
                            className="releases-other-downloads-architecture"
                            href={asset.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <span className="releases-other-downloads-architecture-title">
                              {asset.osLabel} {asset.archLabel} ({asset.name.slice(asset.name.lastIndexOf('.'))})
                            </span>
                            <span className="releases-other-downloads-architecture-meta">{asset.sizeLabel}</span>
                            {isRecommended ? <em>Recommended</em> : null}
                          </a>
                        );
                      })}
                    </div>
                  </section>
                ))}
              </div>
            );
            return collapseOtherPlatforms ? (
              <details className="download-card__other">
                <summary>Other Download Options</summary>
                {grid}
              </details>
            ) : (
              grid
            );
          })()
        : null}
      {footer}
    </div>
  );
}
