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

import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebar: SidebarsConfig = {
  javascriptSdkSidebar: [
    {
      type: 'doc',
      id: 'sdks/javascript/overview',
    },
    {
      type: 'category',
      label: 'Core APIs',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'sdks/javascript/apis/thunderid-javascript-client',
          label: 'ThunderIDJavaScriptClient',
        },
        {
          type: 'doc',
          id: 'sdks/javascript/apis/configuration',
          label: 'Configuration',
        },
        {
          type: 'doc',
          id: 'sdks/javascript/apis/http-client',
          label: 'HttpClient',
        },
        {
          type: 'doc',
          id: 'sdks/javascript/apis/storage-manager',
          label: 'StorageManager',
        },
      ],
    },
    {
      type: 'category',
      label: 'Auth Flow Functions',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'V1 Flows',
          collapsed: true,
          items: [
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/embedded-sign-in-flow',
              label: 'Embedded Sign-In Flow',
            },
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/embedded-sign-up-flow',
              label: 'Embedded Sign-Up Flow',
            },
          ],
        },
        {
          type: 'category',
          label: 'V2 Flows',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/embedded-sign-in-flow-v2',
              label: 'Sign-In Flow',
            },
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/embedded-sign-up-flow-v2',
              label: 'Sign-Up Flow',
            },
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/embedded-recovery-flow-v2',
              label: 'Recovery Flow',
            },
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/embedded-onboarding-flow-v2',
              label: 'User Onboarding Flow',
            },
            {
              type: 'doc',
              id: 'sdks/javascript/apis/flows/flow-meta-v2',
              label: 'Flow Meta',
            },
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'User & Profile',
      collapsed: false,
      items: [
        {
          type: 'doc',
          id: 'sdks/javascript/apis/user/user-profile',
          label: 'User Profile',
        },
        {
          type: 'doc',
          id: 'sdks/javascript/apis/user/schemas',
          label: 'SCIM2 Schemas',
        },
      ],
    },
    {
      type: 'category',
      label: 'Branding & Theme',
      collapsed: true,
      items: [
        {
          type: 'doc',
          id: 'sdks/javascript/apis/branding',
          label: 'Branding',
        },
        {
          type: 'doc',
          id: 'sdks/javascript/apis/theme',
          label: 'Theme',
        },
      ],
    },
    {
      type: 'doc',
      id: 'sdks/javascript/apis/i18n',
      label: 'Internationalization',
    },
    {
      type: 'doc',
      id: 'sdks/javascript/apis/errors',
      label: 'Errors',
    },
    {
      type: 'doc',
      id: 'sdks/javascript/apis/utilities',
      label: 'Utilities',
    },
  ],
};

export default sidebar.javascriptSdkSidebar;
