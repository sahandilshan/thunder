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
  nuxtSdkSidebar: [
    {
      type: 'doc',
      id: 'sdks/nuxt/overview',
    },
    {
      type: 'category',
      label: 'APIs',
      collapsed: false,
      items: [
        {
          type: 'category',
          label: 'Configuration',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/configuration/module-configuration',
              label: 'Module Configuration',
            },
          ],
        },
        {
          type: 'category',
          label: 'Composables',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/composables/use-thunderid',
              label: 'useThunderID()',
            },
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/composables/use-user',
              label: 'useUser()',
            },
          ],
        },
        {
          type: 'category',
          label: 'Components',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/components/thunderid-root',
              label: '<ThunderIDRoot />',
            },
            {
              type: 'category',
              label: 'Control Components',
              collapsed: true,
              items: [
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/signed-in',
                  label: '<ThunderIDSignedIn />',
                },
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/signed-out',
                  label: '<ThunderIDSignedOut />',
                },
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/loading',
                  label: '<ThunderIDLoading />',
                },
              ],
            },
            {
              type: 'category',
              label: 'Action Components',
              collapsed: true,
              items: [
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/sign-in-button',
                  label: '<ThunderIDSignInButton />',
                },
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/sign-out-button',
                  label: '<ThunderIDSignOutButton />',
                },
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/sign-up-button',
                  label: '<ThunderIDSignUpButton />',
                },
              ],
            },
            {
              type: 'category',
              label: 'User Self-care Components',
              collapsed: true,
              items: [
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/user',
                  label: '<ThunderIDUser />',
                },
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/user-profile',
                  label: '<ThunderIDUserProfile />',
                },
                {
                  type: 'doc',
                  id: 'sdks/nuxt/apis/components/user-dropdown',
                  label: '<ThunderIDUserDropdown />',
                },
              ],
            },
          ],
        },
        {
          type: 'category',
          label: 'Middleware',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/middleware/define-thunderid-middleware',
              label: 'defineThunderIDMiddleware()',
            },
          ],
        },
        {
          type: 'category',
          label: 'Server Utilities',
          collapsed: false,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/server/use-server-session',
              label: 'useServerSession()',
            },
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/server/require-server-session',
              label: 'requireServerSession()',
            },
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/server/get-valid-access-token',
              label: 'getValidAccessToken()',
            },
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/server/get-thunderid-context',
              label: 'getThunderIDContext()',
            },
          ],
        },
        {
          type: 'category',
          label: 'Utilities',
          collapsed: true,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/utils/create-route-matcher',
              label: 'createRouteMatcher()',
            },
          ],
        },
        {
          type: 'category',
          label: 'Errors',
          collapsed: true,
          items: [
            {
              type: 'doc',
              id: 'sdks/nuxt/apis/errors/thunderid-error',
              label: 'ThunderIDError',
            },
          ],
        },
      ],
    },
  ],
};

export default sidebar.nuxtSdkSidebar;
