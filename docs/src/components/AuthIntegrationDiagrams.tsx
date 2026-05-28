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


/* ── Types ──────────────────────────────────────────────────────────────── */

interface MessageRow {
  from: number;
  to: number;
  label: string | string[];
  sublabel?: string;
}

interface NoteRow {
  note: string;
  between?: [number, number];
}

type Row = MessageRow | NoteRow;

function isNote(row: Row): row is NoteRow {
  return 'note' in row;
}

/* ── Layout constants ───────────────────────────────────────────────────── */

const ACTOR_Y = 16;
const ACTOR_H = 34;
const ACTOR_W = 120;
const FIRST_MSG_Y = ACTOR_Y + ACTOR_H + 36;
const MSG_ROW_H = 64;
const MSG_WITH_SUB_ROW_H = 76;
const LABEL_LINE_H = 16;
const NOTE_ROW_H = 56;
const ACTOR_PAD = 30;

/* ── Generic N-actor sequence diagram ───────────────────────────────────── */

interface SequenceDiagramProps {
  actors: string[];
  gaps?: number[];
  rows: Row[];
  ariaLabel: string;
}

function SequenceDiagram({ actors, gaps = undefined, rows, ariaLabel }: SequenceDiagramProps) {
  const actorCount = actors.length;
  const defaultGap = actorCount <= 2 ? 400 : actorCount === 3 ? 260 : 210;
  const firstActorX = ACTOR_PAD + ACTOR_W / 2;
  const actorXPositions: number[] = [firstActorX];
  for (let i = 1; i < actorCount; i++) {
    actorXPositions.push(actorXPositions[i - 1] + (gaps?.[i - 1] ?? defaultGap));
  }
  const svgW = actorXPositions[actorCount - 1] + ACTOR_W / 2 + ACTOR_PAD;

  // Helpers for multi-line labels.
  function labelLines(label: string | string[]): string[] {
    return Array.isArray(label) ? label : [label];
  }
  function extraLines(label: string | string[]): number {
    return Math.max(0, labelLines(label).length - 1);
  }

  // Compute Y positions.
  let y = FIRST_MSG_Y;
  const positions: number[] = [];
  for (const row of rows) {
    positions.push(y);
    if (isNote(row)) {
      y += NOTE_ROW_H;
    } else {
      const extra = extraLines(row.label) * LABEL_LINE_H;
      y += (row.sublabel ? MSG_WITH_SUB_ROW_H : MSG_ROW_H) + extra;
    }
  }
  const totalH = y + 16;

  return (
    <figure className="seq-diagram" role="img" aria-label={ariaLabel}>
      <svg
        viewBox={`0 0 ${svgW} ${totalH}`}
        style={{ width: '100%', overflow: 'visible', display: 'block', fontFamily: 'inherit' }}
        aria-hidden="true"
      >
        <defs>
          <marker id="seq-arrow" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto-start-reverse">
            <polygon points="0 0, 8 3, 0 6" className="seq-arrowhead" />
          </marker>
        </defs>

        {/* Actors */}
        {actors.map((name, i) => {
          const cx = actorXPositions[i];
          return (
            <g key={name}>
              <rect x={cx - ACTOR_W / 2} y={ACTOR_Y} width={ACTOR_W} height={ACTOR_H} rx="6" className="seq-actor" />
              <text x={cx} y={ACTOR_Y + ACTOR_H / 2} textAnchor="middle" dominantBaseline="central" className="seq-actor-label">
                {name}
              </text>
              <line x1={cx} y1={ACTOR_Y + ACTOR_H} x2={cx} y2={totalH} className="seq-lifeline" />
            </g>
          );
        })}

        {/* Rows */}
        {rows.map((row, i) => {
          const rowY = positions[i];

          if (isNote(row)) {
            const [a, b] = row.between ?? [0, actorCount - 1];
            const noteLeft = actorXPositions[a];
            const noteRight = actorXPositions[b];
            const noteMid = (noteLeft + noteRight) / 2;
            const noteW = Math.max(320, noteRight - noteLeft - 40);

            return (
              <g key={row.note}>
                <rect x={noteMid - noteW / 2} y={rowY - 14} width={noteW} height="24" rx="4" className="seq-note-bg" />
                <text x={noteMid} y={rowY} textAnchor="middle" dominantBaseline="central" className="seq-note">
                  {row.note}
                </text>
              </g>
            );
          }

          const fromX = actorXPositions[row.from];
          const toX = actorXPositions[row.to];
          const goingRight = toX > fromX;
          const x1 = goingRight ? fromX + 1 : fromX - 1;
          const x2 = goingRight ? toX - 1 : toX + 1;
          const midX = (fromX + toX) / 2;

          const lines = labelLines(row.label);
          const lineCount = lines.length;
          const totalLabelH = lineCount * LABEL_LINE_H;
          const sublabelH = row.sublabel ? LABEL_LINE_H : 0;
          const blockH = totalLabelH + sublabelH;
          const blockTopY = rowY - blockH - 4;

          return (
            <g key={`${row.from}-${row.to}-${String(row.label)}`}>
              <line x1={x1} y1={rowY} x2={x2} y2={rowY} className="seq-message" markerEnd="url(#seq-arrow)" />
              {lines.length > 0 && lines[0] && (
                <text x={midX} y={blockTopY + LABEL_LINE_H * 0.75} textAnchor="middle" className="seq-message-label">
                  {lines.map((line, li) => (
                    <tspan key={line} x={midX} dy={li === 0 ? 0 : LABEL_LINE_H}>
                      {line}
                    </tspan>
                  ))}
                </text>
              )}
              {row.sublabel && (
                <text x={midX} y={blockTopY + totalLabelH + LABEL_LINE_H * 0.75} textAnchor="middle" className="seq-message-sublabel">
                  {row.sublabel}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* ── Exported diagrams ──────────────────────────────────────────────────── */

export function RedirectBasedDiagram() {
  // Actors: 0 = User, 1 = User Agent, 2 = Application, 3 = ThunderID
  return (
    <SequenceDiagram
      actors={['User', 'User Agent', 'Application', 'ThunderID']}
      gaps={[145, 235, 245]}
      ariaLabel="Redirect-based OAuth 2.0 flow: User initiates login, application redirects user agent to ThunderID for authentication, user submits credentials, ThunderID redirects back with an authorization code, and the application exchanges it for tokens."
      rows={[
        { from: 0, to: 2, label: 'Initiate login' },
        { from: 2, to: 1, label: ['Redirect to', '/oauth2/authorize'] },
        { from: 1, to: 3, label: 'GET /oauth2/authorize', sublabel: 'response_type=code&client_id=...' },
        { from: 3, to: 1, label: 'Render sign-in page' },
        { from: 0, to: 1, label: 'Submit credentials' },
        { from: 1, to: 3, label: 'POST credentials' },
        { from: 3, to: 1, label: ['Redirect: ?code=...&state=...'] },
        { from: 1, to: 2, label: ['Callback with', 'authorization code'] },
        { from: 2, to: 3, label: 'POST /oauth2/token', sublabel: '(authorization code)' },
        { from: 3, to: 2, label: ['Access token, ID token,', 'refresh token'] },
      ]}
    />
  );
}

export function AppNativeDiagram() {
  // Actors: 0 = User, 1 = Application, 2 = ThunderID
  return (
    <SequenceDiagram
      actors={['User', 'Application', 'ThunderID']}
      gaps={[380, 245]}
      ariaLabel="App-native flow: User interacts with the application, which calls the Flow Execution API to advance authentication steps, rendering each step locally."
      rows={[
        { from: 0, to: 1, label: 'Initiate login' },
        { from: 1, to: 2, label: 'POST /flow/execute (start)' },
        { from: 2, to: 1, label: ['Step 1: Collect', 'username/password'] },
        { from: 1, to: 0, label: 'Render login form' },
        { from: 0, to: 1, label: 'Submit credentials' },
        { from: 1, to: 2, label: ['POST /flow/execute', '(credentials)'] },
        { from: 2, to: 1, label: 'Step 2: Collect OTP' },
        { from: 1, to: 0, label: 'Render OTP form' },
        { from: 0, to: 1, label: 'Submit OTP' },
        { from: 1, to: 2, label: 'POST /flow/execute (OTP)' },
        { from: 2, to: 1, label: ['Flow complete:', 'assertion token'] },
      ]}
    />
  );
}

export function DirectAPIDiagram() {
  // Actors: 0 = User, 1 = Application, 2 = ThunderID
  return (
    <SequenceDiagram
      actors={['User', 'Application', 'ThunderID']}
      gaps={[380, 245]}
      ariaLabel="Direct API flow: User submits credentials to the application, which calls individual authentication endpoints on ThunderID, chaining assertion tokens for step-up authentication."
      rows={[
        { from: 0, to: 1, label: 'Initiate login' },
        { from: 1, to: 0, label: 'Render credentials form' },
        { from: 0, to: 1, label: 'Submit credentials' },
        { from: 1, to: 2, label: ['POST /auth/credentials', '/authenticate'] },
        { from: 2, to: 1, label: ['User details +', 'assertion token'] },
        { from: 1, to: 2, label: 'POST /auth/otp/sms/send' },
        { from: 2, to: 1, label: 'Session token' },
        { from: 1, to: 0, label: 'Prompt for OTP' },
        { from: 0, to: 1, label: 'Submit OTP' },
        { from: 1, to: 2, label: 'POST /auth/otp/sms/verify', sublabel: '(with previous assertion token)' },
        { from: 2, to: 1, label: 'Enriched assertion token' },
      ]}
    />
  );
}
