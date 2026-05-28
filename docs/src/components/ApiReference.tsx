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

import BrowserOnly from '@docusaurus/BrowserOnly';
import {ApiReferenceReact, type AnyApiReferenceConfiguration} from '@scalar/api-reference-react';
import '@scalar/api-reference-react/style.css';
import {Box, CircularProgress} from '@wso2/oxygen-ui';

export type ApiReferenceProps = AnyApiReferenceConfiguration & {
  specUrl: string;
};

export default function ApiReference({specUrl, ...rest}: ApiReferenceProps) {
  return (
    <BrowserOnly
      fallback={
        <Box sx={{display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh'}}>
          <CircularProgress />
        </Box>
      }
    >
      {() => (
        <div
          className="apis-page"
          style={{
            position: 'fixed',
            top: 'var(--ifm-navbar-height)',
            left: 0,
            right: 0,
            bottom: 0,
            height: 'calc(100vh - var(--ifm-navbar-height))',
            overflowY: 'scroll',
            overflowX: 'hidden',
            WebkitOverflowScrolling: 'touch',
            background: 'var(--oxygen-palette-background-default)',
          }}
        >
          <ApiReferenceReact
            configuration={{
              url: specUrl,
              theme: 'default',
              layout: 'modern',
              // Hides the `Open in Client` button that takes to Scalar Hosted workspace.
              hideClientButton: true,
              ...rest,
            }}
          />
        </div>
      )}
    </BrowserOnly>
  );
}
