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

import type {WrapperProps} from '@docusaurus/types';
import type ColorModeToggleType from '@theme/ColorModeToggle';
import ColorModeToggle from '@theme-original/ColorModeToggle';
import {useColorScheme} from '@wso2/oxygen-ui';
import {useEffect, type ReactNode} from 'react';

type Props = WrapperProps<typeof ColorModeToggleType>;

export default function ColorModeToggleWrapper(props: Props): ReactNode {
  // MUI color mode setting
  const {systemMode, setMode} = useColorScheme();

  // "value" holds the color theme. Either "light" or "dark"
  const {value} = props;

  // change mode based on "value" prop
  // "dark" or "light" are also used for MUI
  useEffect(() => {
    setMode(value);

    // Set CSS class on body tag to sync Scalar API Reference theme with the main Docusaurus theme.
    // The dark-mode and light-mode classes are used by Scalar to determine which theme to apply.
    const effectiveMode = value ?? systemMode;

    const applyModeClass = () => {
      document.body.classList.remove('dark-mode', 'light-mode');
      if (effectiveMode) {
        document.body.classList.add(`${effectiveMode}-mode`);
      }
    };

    applyModeClass();

    // Watch for class changes on body element and re-apply mode class if needed
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          const hasModeClass =
            document.body.classList.contains('dark-mode') || document.body.classList.contains('light-mode');
          if (!hasModeClass && effectiveMode) {
            document.body.classList.add(`${effectiveMode}-mode`);
          }
        }
      });
    });

    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
    };
  }, [setMode, value, systemMode]);

  return <ColorModeToggle {...props} />;
}
