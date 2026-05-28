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

import React, {useMemo} from 'react';
import DownloadCard from './DownloadCard';

/**
 * Props for the SampleDownload component.
 */
interface SampleDownloadProps {
  /**
   * Sample name prefix, matching the asset filename before the version segment.
   * For example, `sample-app-wayfinder` matches `sample-app-wayfinder-0.40.0-macos-arm64.zip`.
   */
  sample: string;
}

/**
 * Renders a download card for a sample distribution, based on the provided sample name prefix.
 * The component constructs a regex pattern to match the expected asset filename format and passes it to
 * the DownloadCard. If no matching asset is found, a fallback message is displayed.
 */
export default function SampleDownload({sample}: SampleDownloadProps): React.ReactElement {
  const pattern = useMemo(() => {
    const escaped = sample.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped}-[0-9A-Za-z.+-]+-(macos|linux|win)-(arm64|x64)\\.zip$`, 'i');
  }, [sample]);
  return (
    <DownloadCard
      pattern={pattern}
      showAllPlatforms
      collapseOtherPlatforms
      compact
      fallback={<p>The sample distribution is currently unavailable. Please check back soon.</p>}
    />
  );
}
