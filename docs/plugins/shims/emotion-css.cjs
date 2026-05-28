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

// SSR shim for @emotion/css — Emotion creates a DOM cache at module init
// which fails in Node.js (document is not defined). This no-op shim is used
// only during Docusaurus server-side rendering; the real package runs in the browser.

function noop() {
  return '';
}

module.exports = {
  css: noop,
  cx: noop,
  injectGlobal: noop,
  keyframes: noop,
  hydrate: noop,
  flush: noop,
  merge: noop,
  getRegisteredStyles: function () {
    return [];
  },
  cache: {key: 'css', registered: {}, inserted: {}, sheet: {tags: []}},
};
