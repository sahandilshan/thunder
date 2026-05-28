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

import OriginalNavbarItem from '@theme-original/NavbarItem';
import React from 'react';
import GitHubStarButton from './GitHubStarButton';
import PersonaDropdown from './PersonaDropdown';

type OriginalProps = Omit<React.ComponentProps<typeof OriginalNavbarItem>, 'type' | 'mobile'> & {
  type?: string;
  mobile?: boolean;
};

export default function NavbarItem({type = undefined, mobile = undefined, ...rest}: OriginalProps): React.ReactElement {
  if (type === 'custom-PersonaDropdown') {
    return <PersonaDropdown />;
  }
  if (type === 'custom-GitHubStarButton') {
    return <GitHubStarButton mobile={mobile} />;
  }
  return <OriginalNavbarItem type={type} mobile={mobile} {...rest} />;
}
