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

import type {Plugin} from 'unified';

interface Options {
  productName: string;
  productSlug: string;
  /**
   * Additional token-to-value substitutions. Each key is the literal token
   * (e.g. `{{ConsoleUrl}}`) replaced with the corresponding value.
   */
  replacements?: Record<string, string>;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
}

function applyReplacements(value: string, replacements: Record<string, string>): string {
  let result = value;
  for (const [token, replacement] of Object.entries(replacements)) {
    result = result.replaceAll(token, replacement);
  }
  return result;
}

function replaceInTextNode(node: HastNode, replacements: Record<string, string>): void {
  if (node.type === 'text' && typeof node.value === 'string') {
    node.value = applyReplacements(node.value, replacements);
  }
}

/**
 * Recursively visits every `code` element in the hast tree — both fenced code
 * blocks (`pre > code`) and inline code spans — and replaces token occurrences
 * in their text children with the configured values.
 */
function replaceInCodeNodes(node: HastNode, replacements: Record<string, string>): void {
  if (node.type === 'element' && node.tagName === 'code' && node.children) {
    for (const child of node.children) {
      replaceInTextNode(child, replacements);
    }
    // Don't recurse into code children — text nodes already handled above.
    return;
  }

  if (node.children) {
    for (const child of node.children) {
      replaceInCodeNodes(child, replacements);
    }
  }
}

const rehypeProductName: Plugin<[Options]> = function (options: Options) {
  const {productName, productSlug, replacements: extra = {}} = options;
  const replacements: Record<string, string> = {
    '{{ProductName}}': productName,
    '{{productSlug}}': productSlug,
    ...extra,
  };

  return (tree: unknown) => {
    replaceInCodeNodes(tree as HastNode, replacements);
  };
};

export default rehypeProductName;
