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

/**
 * Mobile-only API reference — stack navigation pattern.
 *
 * Two full-screen views that fill the space below the existing ThunderID
 * navbar (no additional header needed):
 *
 *   List view  — search box + collapsible tag groups + endpoint rows.
 *                Selecting an endpoint pushes to the detail view.
 *   Detail view — back bar showing the tag name + full scrollable
 *                 endpoint detail (method, path, params, responses).
 *
 * Single scroll axis per screen; no competing split panels.
 */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {parse} from 'yaml';
import PostmanButton from './PostmanButton';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParamSchema {
  type?: string;
  format?: string;
  enum?: string[];
  $ref?: string;
}

interface Param {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: ParamSchema;
}

interface ResponseObj {
  description?: string;
}

interface FlatOp {
  id: string;
  method: string;
  path: string;
  summary: string;
  description?: string;
  tags: string[];
  parameters: Param[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, unknown>;
  };
  responses: Record<string, ResponseObj>;
}

interface TagGroup {
  name: string;
  description: string;
  ops: FlatOp[];
}

interface PropertySchema {
  type?: string;
  format?: string;
  description?: string;
  enum?: string[];
  $ref?: string;
  items?: PropertySchema;
  oneOf?: PropertySchema[];
  anyOf?: PropertySchema[];
  allOf?: PropertySchema[];
  properties?: Record<string, PropertySchema>;
}

interface ModelSchema {
  name: string;
  description?: string;
  type?: string;
  required?: string[];
  properties?: Record<string, PropertySchema>;
  allOf?: PropertySchema[];
  oneOf?: PropertySchema[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options'];

const METHOD_COLOR: Record<string, string> = {
  delete: '#f93e3e',
  get: '#61affe',
  head: '#9012fe',
  options: '#0d5aa7',
  patch: '#50e3c2',
  post: '#49cc90',
  put: '#fca130',
};

const STATUS_COLOR: Record<string, string> = {
  '2': '#49cc90',
  '3': '#61affe',
  '4': '#fca130',
  '5': '#f93e3e',
};

const VALID_PARAM_LOCATIONS = new Set(['path', 'query', 'header', 'cookie']);

// ─── Spec helpers ─────────────────────────────────────────────────────────────

function buildTagGroups(spec: Record<string, unknown>): TagGroup[] {
  // Build a flat map of tag → operations first.
  const tagOpMap = new Map<string, FlatOp[]>();
  const paths = (spec.paths as Record<string, Record<string, unknown>>) ?? {};

  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of HTTP_METHODS) {
      const rawOp = pathItem[method] as Record<string, unknown> | undefined;
      if (!rawOp) continue;

      const opTags = (rawOp.tags as string[] | undefined) ?? ['Other'];

      // Only include parameters that have a recognised 'in' location.
      // Parameters without a valid location would otherwise render as
      // an "UNDEFINED PARAMETERS" section.
      const parameters = ((rawOp.parameters as Param[]) ?? []).filter((p) => p?.in && VALID_PARAM_LOCATIONS.has(p.in));

      const op: FlatOp = {
        description: rawOp.description as string | undefined,
        id: `${method}:${path}`,
        method,
        parameters,
        path,
        requestBody: rawOp.requestBody as FlatOp['requestBody'],
        responses: (rawOp.responses as Record<string, ResponseObj>) ?? {},
        summary: (rawOp.summary as string) ?? path,
        tags: opTags,
      };

      for (const tag of opTags) {
        if (!tagOpMap.has(tag)) tagOpMap.set(tag, []);
        tagOpMap.get(tag)!.push(op);
      }
    }
  }

  // Prefer x-tagGroups when present — this mirrors the desktop sidebar grouping
  // (e.g. "Identities" containing Users, Groups, OUs) rather than showing every
  // raw tag as a separate section.
  const xTagGroups = spec['x-tagGroups'] as {name: string; tags: string[]}[] | undefined;
  if (xTagGroups?.length) {
    return xTagGroups
      .map((group) => ({
        description: '',
        name: group.name,
        ops: group.tags.flatMap((tag) => tagOpMap.get(tag) ?? []),
      }))
      .filter((g) => g.ops.length > 0);
  }

  // Fallback for specs that don't carry x-tagGroups: group by individual tags.
  const specTagDefs = (spec.tags as {name: string; description?: string}[]) ?? [];
  return specTagDefs
    .map((t) => ({description: t.description ?? '', name: t.name, ops: tagOpMap.get(t.name) ?? []}))
    .filter((g) => g.ops.length > 0);
}

function buildModels(spec: Record<string, unknown>): ModelSchema[] {
  const schemas = (spec.components as Record<string, unknown> | undefined)?.schemas as
    | Record<string, unknown>
    | undefined;
  if (!schemas) return [];
  return Object.entries(schemas)
    .map(([name, raw]) => {
      const s = raw as Record<string, unknown>;
      return {
        allOf: s.allOf as PropertySchema[] | undefined,
        description: s.description as string | undefined,
        name,
        oneOf: s.oneOf as PropertySchema[] | undefined,
        properties: s.properties as Record<string, PropertySchema> | undefined,
        required: s.required as string[] | undefined,
        type: s.type as string | undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveTypeLabel(schema: PropertySchema): string {
  if (schema.$ref) return schema.$ref.replace(/^#\/components\/schemas\//, '');
  if (schema.type === 'array' && schema.items) return `array[${resolveTypeLabel(schema.items)}]`;
  if (schema.type) return schema.format ? `${schema.type} (${schema.format})` : schema.type;
  if (schema.oneOf) return 'one of';
  if (schema.anyOf) return 'any of';
  if (schema.allOf) return 'all of';
  return '—';
}

// ─── Shared atoms ─────────────────────────────────────────────────────────────

function MethodBadge({method}: {method: string}) {
  return (
    <span
      style={{
        background: METHOD_COLOR[method] ?? '#888',
        borderRadius: 3,
        color: '#fff',
        display: 'inline-block',
        flexShrink: 0,
        fontSize: '0.67rem',
        fontWeight: 700,
        letterSpacing: '0.03em',
        minWidth: 52,
        padding: '2px 5px',
        textAlign: 'center',
        textTransform: 'uppercase',
      }}
    >
      {method}
    </span>
  );
}

// ─── List view ────────────────────────────────────────────────────────────────

interface ListViewProps {
  filteredGroups: TagGroup[];
  filteredModels: ModelSchema[];
  expandedTags: Set<string>;
  expandedModels: boolean;
  search: string;
  selectedOpId: string | null;
  collectionUrl: string;
  downloadFileName: string;
  onSearch: (q: string) => void;
  onToggleTag: (name: string) => void;
  onToggleModels: () => void;
  onSelectOp: (op: FlatOp) => void;
  onSelectModel: (model: ModelSchema) => void;
}

function ListView({
  filteredGroups,
  filteredModels,
  expandedTags,
  expandedModels,
  search,
  selectedOpId,
  collectionUrl,
  downloadFileName,
  onSearch,
  onToggleTag,
  onToggleModels,
  onSelectOp,
  onSelectModel,
}: ListViewProps) {
  return (
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden'}}>
      {/* Search — always visible at the top */}
      <div
        style={{
          background: 'var(--oxygen-palette-background-paper)',
          borderBottom: '1px solid var(--ifm-color-emphasis-200)',
          flexShrink: 0,
          padding: '10px 14px',
        }}
      >
        <div style={{display: 'flex', justifyContent: 'flex-end', paddingBottom: 8}}>
          <PostmanButton collectionUrl={collectionUrl} downloadFileName={downloadFileName} />
        </div>
        <input
          placeholder="Search endpoints…"
          style={{
            background: 'var(--ifm-background-color)',
            border: '1px solid var(--ifm-color-emphasis-300)',
            borderRadius: 6,
            boxSizing: 'border-box',
            color: 'var(--ifm-font-color-base)',
            fontSize: '0.9rem',
            outline: 'none',
            padding: '8px 10px',
            width: '100%',
          }}
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
        />
      </div>

      {/* Tag groups — full remaining height, scrollable */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        }}
      >
        {filteredGroups.map((group) => {
          const isExpanded = expandedTags.has(group.name);
          return (
            <div key={group.name}>
              <button
                style={{
                  alignItems: 'center',
                  background: 'transparent',
                  border: 'none',
                  borderBottom: '1px solid var(--ifm-color-emphasis-200)',
                  color: 'var(--ifm-font-color-base)',
                  cursor: 'pointer',
                  display: 'flex',
                  gap: 10,
                  padding: '12px 14px',
                  textAlign: 'left',
                  width: '100%',
                }}
                onClick={() => onToggleTag(group.name)}
              >
                <span
                  style={{
                    display: 'inline-block',
                    flexShrink: 0,
                    fontSize: '0.6rem',
                    opacity: 0.4,
                    transform: isExpanded ? 'rotate(90deg)' : undefined,
                    transition: 'transform 0.15s ease',
                  }}
                >
                  ▶
                </span>
                <span style={{flex: 1, fontSize: '0.92rem', fontWeight: 600}}>{group.name}</span>
                <span
                  style={{
                    fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                    fontSize: '0.72rem',
                    opacity: 0.35,
                  }}
                >
                  {group.ops.length}
                </span>
              </button>

              {isExpanded &&
                group.ops.map((op) => {
                  const isActive = selectedOpId === op.id;
                  return (
                    <button
                      key={op.id}
                      style={{
                        alignItems: 'center',
                        background: isActive
                          ? 'color-mix(in srgb, var(--ifm-color-primary) 10%, transparent)'
                          : 'transparent',
                        border: 'none',
                        borderBottom: '1px solid var(--ifm-color-emphasis-100)',
                        borderLeft: isActive ? '3px solid var(--ifm-color-primary)' : '3px solid transparent',
                        color: 'var(--ifm-font-color-base)',
                        cursor: 'pointer',
                        display: 'flex',
                        gap: 10,
                        padding: '9px 14px 9px 22px',
                        textAlign: 'left',
                        width: '100%',
                      }}
                      onClick={() => onSelectOp(op)}
                    >
                      <MethodBadge method={op.method} />
                      <span
                        style={{
                          fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                          fontSize: '0.78rem',
                          minWidth: 0,
                          opacity: isActive ? 1 : 0.7,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {op.path}
                      </span>
                    </button>
                  );
                })}
            </div>
          );
        })}

        {/* Models section — always shown below endpoint groups */}
        {filteredModels.length > 0 && (
          <div>
            <button
              style={{
                alignItems: 'center',
                background: 'transparent',
                border: 'none',
                borderBottom: '1px solid var(--ifm-color-emphasis-200)',
                color: 'var(--ifm-font-color-base)',
                cursor: 'pointer',
                display: 'flex',
                gap: 10,
                padding: '12px 14px',
                textAlign: 'left',
                width: '100%',
              }}
              onClick={onToggleModels}
            >
              <span
                style={{
                  display: 'inline-block',
                  flexShrink: 0,
                  fontSize: '0.6rem',
                  opacity: 0.4,
                  transform: expandedModels ? 'rotate(90deg)' : undefined,
                  transition: 'transform 0.15s ease',
                }}
              >
                ▶
              </span>
              <span style={{flex: 1, fontSize: '0.92rem', fontWeight: 600}}>Models</span>
              <span
                style={{
                  fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                  fontSize: '0.72rem',
                  opacity: 0.35,
                }}
              >
                {filteredModels.length}
              </span>
            </button>

            {expandedModels &&
              filteredModels.map((model) => (
                <button
                  key={model.name}
                  style={{
                    alignItems: 'center',
                    background: 'transparent',
                    border: 'none',
                    borderBottom: '1px solid var(--ifm-color-emphasis-100)',
                    color: 'var(--ifm-font-color-base)',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 10,
                    padding: '9px 14px 9px 22px',
                    textAlign: 'left',
                    width: '100%',
                  }}
                  onClick={() => onSelectModel(model)}
                >
                  <span
                    style={{
                      background: '#7b61ff',
                      borderRadius: 3,
                      color: '#fff',
                      flexShrink: 0,
                      fontSize: '0.67rem',
                      fontWeight: 700,
                      letterSpacing: '0.03em',
                      minWidth: 52,
                      padding: '2px 5px',
                      textAlign: 'center',
                    }}
                  >
                    MODEL
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                      fontSize: '0.78rem',
                      minWidth: 0,
                      opacity: 0.7,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {model.name}
                  </span>
                </button>
              ))}
          </div>
        )}

        {filteredGroups.length === 0 && filteredModels.length === 0 && search && (
          <p
            style={{
              fontSize: '0.88rem',
              margin: 0,
              opacity: 0.45,
              padding: '20px 14px',
              textAlign: 'center',
            }}
          >
            No results match &ldquo;{search}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Detail view ──────────────────────────────────────────────────────────────

interface DetailViewProps {
  op: FlatOp;
  tagName: string;
  onBack: () => void;
}

function SectionLabel({children}: {children: React.ReactNode}) {
  return (
    <p
      style={{
        fontSize: '0.67rem',
        fontWeight: 700,
        letterSpacing: '0.07em',
        margin: '0 0 8px',
        opacity: 0.45,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </p>
  );
}

function DetailView({op, tagName, onBack}: DetailViewProps) {
  const paramGroups = useMemo(() => {
    const groups: Record<string, Param[]> = {};
    for (const p of op.parameters) {
      (groups[p.in] ??= []).push(p);
    }
    return Object.entries(groups);
  }, [op.parameters]);

  const responses = useMemo(() => Object.entries(op.responses ?? {}), [op.responses]);

  const contentTypes = useMemo(
    () => (op.requestBody?.content ? Object.keys(op.requestBody.content) : []),
    [op.requestBody],
  );

  return (
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden'}}>
      {/* Back bar — the only chrome added here; ThunderID navbar is above. */}
      <button
        style={{
          alignItems: 'center',
          background: 'var(--oxygen-palette-background-paper)',
          border: 'none',
          borderBottom: '1px solid var(--ifm-color-emphasis-200)',
          color: 'var(--ifm-color-primary)',
          cursor: 'pointer',
          display: 'flex',
          flexShrink: 0,
          fontSize: '0.88rem',
          fontWeight: 600,
          gap: 6,
          padding: '12px 14px',
          textAlign: 'left',
          width: '100%',
        }}
        onClick={onBack}
      >
        <span style={{fontSize: '1rem', lineHeight: 1}}>←</span>
        {tagName}
      </button>

      {/* Endpoint content — full remaining height, scrollable */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          padding: '20px 16px 48px',
        }}
      >
        <div
          style={{
            alignItems: 'center',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginBottom: 6,
          }}
        >
          <MethodBadge method={op.method} />
          <code style={{fontSize: '0.85rem', opacity: 0.85, wordBreak: 'break-all'}}>{op.path}</code>
        </div>

        <h2 style={{fontSize: '1.05rem', fontWeight: 700, margin: '0 0 10px'}}>{op.summary}</h2>

        {op.description && (
          <p style={{fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 20, opacity: 0.72}}>{op.description}</p>
        )}

        {/* Parameters */}
        {paramGroups.map(([location, params]) => (
          <div key={location} style={{marginBottom: 20}}>
            <SectionLabel>{location} parameters</SectionLabel>
            <div
              style={{
                border: '1px solid var(--ifm-color-emphasis-200)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {params.map((p, i) => (
                <div
                  key={p.name}
                  style={{
                    borderTop: i > 0 ? '1px solid var(--ifm-color-emphasis-200)' : undefined,
                    padding: '9px 12px',
                  }}
                >
                  <div
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '3px 8px',
                      marginBottom: p.description ? 3 : 0,
                    }}
                  >
                    <code style={{fontSize: '0.82rem', fontWeight: 600}}>{p.name}</code>
                    {p.required && (
                      <span
                        style={{
                          background: 'rgba(249,62,62,0.1)',
                          borderRadius: 3,
                          color: '#f93e3e',
                          fontSize: '0.67rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                        }}
                      >
                        required
                      </span>
                    )}
                    {p.schema?.type && (
                      <span
                        style={{
                          fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                          fontSize: '0.72rem',
                          opacity: 0.5,
                        }}
                      >
                        {p.schema.type}
                        {p.schema.format ? ` (${p.schema.format})` : ''}
                      </span>
                    )}
                  </div>
                  {p.description && (
                    <p style={{fontSize: '0.82rem', lineHeight: 1.4, margin: 0, opacity: 0.62}}>{p.description}</p>
                  )}
                  {p.schema?.enum && (
                    <p
                      style={{
                        fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                        fontSize: '0.72rem',
                        margin: '3px 0 0',
                        opacity: 0.5,
                      }}
                    >
                      Enum: {p.schema.enum.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Request body */}
        {op.requestBody && (
          <div style={{marginBottom: 20}}>
            <SectionLabel>request body{op.requestBody.required ? ' (required)' : ' (optional)'}</SectionLabel>
            <div
              style={{
                border: '1px solid var(--ifm-color-emphasis-200)',
                borderRadius: 6,
                overflow: 'hidden',
                padding: '9px 12px',
              }}
            >
              {contentTypes.length > 0 && (
                <p
                  style={{
                    fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                    fontSize: '0.78rem',
                    margin: 0,
                    opacity: 0.55,
                  }}
                >
                  {contentTypes.join(', ')}
                </p>
              )}
              {op.requestBody.description && (
                <p
                  style={{
                    fontSize: '0.85rem',
                    margin: contentTypes.length ? '4px 0 0' : 0,
                    opacity: 0.7,
                  }}
                >
                  {op.requestBody.description}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Responses */}
        {responses.length > 0 && (
          <div style={{marginBottom: 20}}>
            <SectionLabel>responses</SectionLabel>
            <div
              style={{
                border: '1px solid var(--ifm-color-emphasis-200)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {responses.map(([code, resp], i) => (
                <div
                  key={code}
                  style={{
                    alignItems: 'flex-start',
                    borderTop: i > 0 ? '1px solid var(--ifm-color-emphasis-200)' : undefined,
                    display: 'flex',
                    gap: 12,
                    padding: '10px 12px',
                  }}
                >
                  <span
                    style={{
                      color: STATUS_COLOR[code[0]] ?? 'inherit',
                      flexShrink: 0,
                      fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                      fontSize: '0.82rem',
                      fontWeight: 700,
                      minWidth: 36,
                    }}
                  >
                    {code}
                  </span>
                  <span style={{fontSize: '0.85rem', lineHeight: 1.4, opacity: 0.72}}>{resp.description ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Model detail view ────────────────────────────────────────────────────────

function ModelDetailView({model, onBack}: {model: ModelSchema; onBack: () => void}) {
  const properties = useMemo(() => {
    const propsList: {name: string; schema: PropertySchema; required: boolean}[] = [];
    if (model.properties) {
      for (const [name, schema] of Object.entries(model.properties)) {
        propsList.push({name, required: model.required?.includes(name) ?? false, schema});
      }
    }
    // Collect additional properties contributed by allOf members.
    if (model.allOf) {
      for (const sub of model.allOf) {
        if (sub.properties) {
          for (const [name, schema] of Object.entries(sub.properties)) {
            if (!propsList.find((p) => p.name === name)) {
              propsList.push({name, required: false, schema: schema});
            }
          }
        }
      }
    }
    return propsList;
  }, [model]);

  return (
    <div style={{display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, overflow: 'hidden'}}>
      <button
        style={{
          alignItems: 'center',
          background: 'var(--oxygen-palette-background-paper)',
          border: 'none',
          borderBottom: '1px solid var(--ifm-color-emphasis-200)',
          color: 'var(--ifm-color-primary)',
          cursor: 'pointer',
          display: 'flex',
          flexShrink: 0,
          fontSize: '0.88rem',
          fontWeight: 600,
          gap: 6,
          padding: '12px 14px',
          textAlign: 'left',
          width: '100%',
        }}
        onClick={onBack}
      >
        <span style={{fontSize: '1rem', lineHeight: 1}}>←</span>
        Models
      </button>

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          padding: '20px 16px 48px',
        }}
      >
        <div style={{alignItems: 'center', display: 'flex', gap: 8, marginBottom: 6}}>
          <span
            style={{
              background: '#7b61ff',
              borderRadius: 3,
              color: '#fff',
              fontSize: '0.67rem',
              fontWeight: 700,
              letterSpacing: '0.03em',
              padding: '2px 5px',
            }}
          >
            MODEL
          </span>
          <code style={{fontSize: '0.85rem', opacity: 0.85}}>{model.name}</code>
        </div>

        <h2 style={{fontSize: '1.05rem', fontWeight: 700, margin: '0 0 10px'}}>{model.name}</h2>

        {model.description && (
          <p style={{fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 20, opacity: 0.72}}>{model.description}</p>
        )}

        {properties.length > 0 && (
          <div style={{marginBottom: 20}}>
            <SectionLabel>properties</SectionLabel>
            <div
              style={{
                border: '1px solid var(--ifm-color-emphasis-200)',
                borderRadius: 6,
                overflow: 'hidden',
              }}
            >
              {properties.map((p, i) => (
                <div
                  key={p.name}
                  style={{
                    borderTop: i > 0 ? '1px solid var(--ifm-color-emphasis-200)' : undefined,
                    padding: '9px 12px',
                  }}
                >
                  <div
                    style={{
                      alignItems: 'center',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '3px 8px',
                      marginBottom: p.schema.description ? 3 : 0,
                    }}
                  >
                    <code style={{fontSize: '0.82rem', fontWeight: 600}}>{p.name}</code>
                    {p.required && (
                      <span
                        style={{
                          background: 'rgba(249,62,62,0.1)',
                          borderRadius: 3,
                          color: '#f93e3e',
                          fontSize: '0.67rem',
                          fontWeight: 700,
                          padding: '1px 5px',
                        }}
                      >
                        required
                      </span>
                    )}
                    <span
                      style={{
                        fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                        fontSize: '0.72rem',
                        opacity: 0.5,
                      }}
                    >
                      {resolveTypeLabel(p.schema)}
                    </span>
                  </div>
                  {p.schema.description && (
                    <p style={{fontSize: '0.82rem', lineHeight: 1.4, margin: 0, opacity: 0.62}}>
                      {p.schema.description}
                    </p>
                  )}
                  {p.schema.enum && (
                    <p
                      style={{
                        fontFamily: 'var(--ifm-font-family-monospace, monospace)',
                        fontSize: '0.72rem',
                        margin: '3px 0 0',
                        opacity: 0.5,
                      }}
                    >
                      Enum: {p.schema.enum.join(', ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {(model.oneOf != null || model.allOf != null) && properties.length === 0 && (
          <div style={{marginBottom: 20}}>
            <SectionLabel>{model.oneOf ? 'one of' : 'composed of'}</SectionLabel>
            <p style={{fontSize: '0.82rem', margin: 0, opacity: 0.6}}>
              {(model.oneOf ?? model.allOf ?? []).map((s) => resolveTypeLabel(s)).join(' | ')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface MobileApiReferenceProps {
  specUrl: string;
  collectionUrl: string;
  downloadFileName: string;
}

export default function MobileApiReference({specUrl, collectionUrl, downloadFileName}: MobileApiReferenceProps) {
  const [tagGroups, setTagGroups] = useState<TagGroup[]>([]);
  const [models, setModels] = useState<ModelSchema[]>([]);
  const [fetchResult, setFetchResult] = useState<{specUrl: string; error: string | null} | null>(null);

  const loading = fetchResult?.specUrl !== specUrl;
  const loadError = fetchResult?.specUrl === specUrl ? fetchResult.error : null;

  // Measure the navbar's actual bottom edge so our fixed overlay starts exactly
  // below it. --docusaurus-announcement-bar-height resolves to 'auto' when no
  // bar is present, which breaks calc(), so we avoid that variable entirely.
  const [topOffset, setTopOffset] = useState(60);
  useEffect(() => {
    const navbar = document.querySelector<HTMLElement>('.navbar');
    if (!navbar) return;
    const update = () => setTopOffset(navbar.getBoundingClientRect().bottom);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(navbar);
    return () => ro.disconnect();
  }, []);

  // List view state
  const [search, setSearch] = useState('');
  const [expandedTags, setExpandedTags] = useState<Set<string>>(new Set());
  const [expandedModels, setExpandedModels] = useState(false);

  // null = list view; set = detail view (stack navigation)
  const [selectedOp, setSelectedOp] = useState<FlatOp | null>(null);
  const [selectedModel, setSelectedModel] = useState<ModelSchema | null>(null);

  useEffect(() => {
    let cancelled = false;

    fetch(specUrl)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((text) => {
        if (cancelled) return;
        const spec = parse(text) as Record<string, unknown>;
        const groups = buildTagGroups(spec);
        setTagGroups(groups);
        setModels(buildModels(spec));
        // Land on the first endpoint immediately so the view is never empty.
        if (groups.length > 0 && groups[0].ops.length > 0) {
          setSelectedOp(groups[0].ops[0]);
          setExpandedTags(new Set([groups[0].name]));
        }
        setFetchResult({error: null, specUrl});
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetchResult({error: String(err), specUrl});
        }
      });

    return () => {
      cancelled = true;
    };
  }, [specUrl]);

  const q = search.toLowerCase().trim();

  const filteredGroups = useMemo<TagGroup[]>(() => {
    if (!q) return tagGroups;
    return tagGroups
      .map((g) => ({
        ...g,
        ops: g.ops.filter(
          (op) =>
            op.summary.toLowerCase().includes(q) ||
            op.path.toLowerCase().includes(q) ||
            g.name.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.ops.length > 0);
  }, [tagGroups, q]);

  const filteredModels = useMemo<ModelSchema[]>(() => {
    if (!q) return models;
    return models.filter((m) => m.name.toLowerCase().includes(q) || 'models'.includes(q));
  }, [models, q]);

  const toggleTag = useCallback((name: string) => {
    setExpandedTags((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const toggleModels = useCallback(() => setExpandedModels((prev) => !prev), []);

  const handleSelectOp = useCallback((op: FlatOp) => {
    setSelectedModel(null);
    setSelectedOp(op);
  }, []);

  const handleSelectModel = useCallback((model: ModelSchema) => {
    setSelectedOp(null);
    setSelectedModel(model);
  }, []);

  const handleBack = useCallback(() => {
    setSelectedOp(null);
    setSelectedModel(null);
  }, []);

  const selectedTagName = useMemo(() => {
    if (!selectedOp) return '';
    return tagGroups.find((g) => g.ops.some((o) => o.id === selectedOp.id))?.name ?? '';
  }, [selectedOp, tagGroups]);

  // Rendered via a portal into document.body so that Docusaurus's mobile sidebar
  // transform (which creates a new stacking context) cannot break position: fixed.
  const rootStyle: React.CSSProperties = {
    background: 'var(--oxygen-palette-background-default)',
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    left: 0,
    overflow: 'hidden',
    position: 'fixed',
    right: 0,
    top: topOffset,
    zIndex: 100,
  };

  if (loading) {
    return (
      <div
        className="apis-page"
        style={{
          ...rootStyle,
          alignItems: 'center',
          display: 'flex',
          fontSize: '0.88rem',
          justifyContent: 'center',
          opacity: 0.45,
        }}
      >
        Loading API reference…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="apis-page" style={{...rootStyle, color: '#f93e3e', fontSize: '0.88rem', padding: 20}}>
        Failed to load API reference: {loadError}
      </div>
    );
  }

  return (
    <div className="apis-page" style={rootStyle}>
      {selectedOp ? (
        <DetailView onBack={handleBack} op={selectedOp} tagName={selectedTagName} />
      ) : selectedModel ? (
        <ModelDetailView model={selectedModel} onBack={handleBack} />
      ) : (
        <ListView
          collectionUrl={collectionUrl}
          downloadFileName={downloadFileName}
          expandedModels={expandedModels}
          expandedTags={expandedTags}
          filteredGroups={filteredGroups}
          filteredModels={filteredModels}
          search={search}
          selectedOpId={null}
          onSearch={setSearch}
          onSelectModel={handleSelectModel}
          onSelectOp={handleSelectOp}
          onToggleModels={toggleModels}
          onToggleTag={toggleTag}
        />
      )}
    </div>
  );
}
