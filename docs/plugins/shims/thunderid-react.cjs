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

// No-op shim for @thunderid/react.
// The frontend design package dist imports these symbols from @thunderid/react,
// but docs only uses theme utilities from that package. This shim prevents
// webpack from failing when it cannot resolve @thunderid/react in the docs build.

module.exports = {
  Consent: () => null,
  ConsentCheckboxList: () => null,
  EmbeddedFlowComponentType: {},
  EmbeddedFlowEventType: {},
  EmbeddedFlowTextVariant: {},
  FlowTimer: () => null,
  extractEmojiFromUri: () => undefined,
  isEmojiUri: () => false,
  useThunderID: () => ({}),
};
