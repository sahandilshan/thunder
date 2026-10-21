/**
 * ThunderID upstream security monitor, Apps Script edition.
 *
 * Port of .github/security-monitor/monitor.mjs (branch codex/upstream-security-monitor).
 * Every 30 minutes it:
 *   1. Audits upstream main the way `pnpm audit --audit-level=high` does in pnpm 11:
 *      every package in pnpm-lock.yaml is sent to npm's bulk advisory endpoint and
 *      upstream's configured GHSA ignores are applied.
 *   2. Inspects failed PR Builder runs from the last seven days for failed `pnpm audit` steps.
 *   3. Posts new findings to Google Chat and keeps deduplication state in this spreadsheet.
 *   4. Optionally starts the security fix agent workflow in the fork for new findings on main.
 *
 * Script properties (Project Settings > Script Properties):
 *   GITHUB_TOKEN                  Read-only token. GitHub refuses job logs without one.
 *   GOOGLE_CHAT_SECURITY_WEBHOOK  Incoming webhook URL of the Chat space.
 *   FIX_MODE                      off (default), dry-run or live: whether new findings on main start the
 *                                 security fix agent workflow, and whether that run may push and open a PR.
 *   FIX_DISPATCH_TOKEN            Fine-grained token for the fork with Actions read and write access.
 *
 * Run checkSetup() and dryRun() first, then startSchedule(). stopSchedule() removes the trigger.
 * testFixDispatch() starts a fix agent dry run on a past commit to prove FIX_DISPATCH_TOKEN can start it.
 *
 * @OnlyCurrentDoc
 */

const UPSTREAM = 'thunder-id/thunderid';
const SEED_STATE_REPO = 'sahandilshan/thunder';
const SEED_STATE_BRANCH = 'security-monitor-state';
const NPM_BULK_AUDIT_URL = 'https://registry.npmjs.org/-/npm/v1/security/advisories/bulk';
const DAY = 86400000;
const STATE_SHEET = '_monitor_state';
const RUNS_SHEET = 'Monitor runs';
const STATE_CHUNK = 45000;
const MAX_RUN_ROWS = 2000;
const RUN_BUDGET_MS = 4 * 60 * 1000;
const KNOWN_SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical'];
const FIX_REPO = 'sahandilshan/thunder';
const FIX_WORKFLOW = 'security-fix-agent.yml';
const FIX_MODES = ['off', 'dry-run', 'live'];
const FIX_RETRY_MS = DAY;
// An advisory that upstream main still reports is announced again after this long.
const MAIN_REMINDER_MS = 12 * 60 * 60 * 1000;

function runMonitor() {
  requireScopes_();
  execute_({ dryRun: false });
}

function dryRun() {
  requireScopes_();
  execute_({ dryRun: true });
}

/** Google's consent screen lets each permission be unticked; this re-prompts in the editor for any that are missing. */
function requireScopes_() {
  if (ScriptApp.requireAllScopes) ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

/** Tests each external connection separately and logs what fails, without printing secrets. */
function checkSetup() {
  requireScopes_();
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty('GITHUB_TOKEN') || '';
  const token = raw.trim();
  const webhook = (props.getProperty('GOOGLE_CHAT_SECURITY_WEBHOOK') || '').trim();
  console.log(
    `GITHUB_TOKEN: ${token ? `set, ${token.length} characters, ${/^(github_pat_|gh[pousr]_)/.test(token) ? 'GitHub token format' : 'unexpected format'}` : 'MISSING'}` +
      `${raw !== token ? ', had surrounding whitespace (trimmed)' : ''}${/\s/.test(token) ? ', CONTAINS WHITESPACE' : ''}`,
  );
  console.log(
    `GOOGLE_CHAT_SECURITY_WEBHOOK: ${webhook ? (/^https:\/\/chat\.googleapis\.com\/v1\/spaces\//.test(webhook) ? 'set, valid Chat webhook format' : 'set, NOT a Chat webhook URL') : 'missing (only needed for live runs)'}`,
  );
  const probe = (label, url, options) => {
    try {
      const response = UrlFetchApp.fetch(url, Object.assign({ muteHttpExceptions: true }, options));
      const headers = response.getAllHeaders();
      const remaining = headers['x-ratelimit-remaining'] || headers['X-RateLimit-Remaining'];
      console.log(`${label}: HTTP ${response.getResponseCode()}${remaining ? `, rate limit remaining ${remaining}` : ''}`);
    } catch (error) {
      console.log(`${label}: FAILED before a response: ${redact_(error.message)}`);
    }
  };
  probe('GitHub without token', 'https://api.github.com/rate_limit', {});
  if (token) {
    probe('GitHub with token', 'https://api.github.com/rate_limit', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
  }
  probe('npm advisory endpoint', NPM_BULK_AUDIT_URL, { method: 'post', contentType: 'application/json', payload: '{}' });
  const fixMode = (props.getProperty('FIX_MODE') || 'off').trim();
  const fixToken = (props.getProperty('FIX_DISPATCH_TOKEN') || '').trim();
  console.log(`FIX_MODE: ${fixMode}${FIX_MODES.indexOf(fixMode) < 0 ? ' (INVALID: use off, dry-run or live)' : ''}`);
  console.log(`FIX_DISPATCH_TOKEN: ${fixToken ? 'set' : fixMode === 'off' ? 'not set (not needed while FIX_MODE is off)' : 'MISSING'}`);
  if (fixToken) {
    probe('Fix workflow with FIX_DISPATCH_TOKEN', `https://api.github.com/repos/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}`, {
      headers: { Authorization: `Bearer ${fixToken}`, Accept: 'application/vnd.github+json' },
    });
  }
}

function startSchedule() {
  requireScopes_();
  stopSchedule();
  ScriptApp.newTrigger('runMonitor').timeBased().everyMinutes(30).create();
  console.log('Scheduled runMonitor every 30 minutes');
}

function stopSchedule() {
  for (const trigger of ScriptApp.getProjectTriggers()) {
    if (trigger.getHandlerFunction() === 'runMonitor') ScriptApp.deleteTrigger(trigger);
  }
}

function execute_({ dryRun }) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('Another monitor run is in progress; skipping');
    return;
  }
  const started = Date.now();
  try {
    const props = PropertiesService.getScriptProperties();
    // Pasted values often carry a trailing newline, which UrlFetchApp rejects in a header.
    const token = (props.getProperty('GITHUB_TOKEN') || '').trim();
    const webhook = (props.getProperty('GOOGLE_CHAT_SECURITY_WEBHOOK') || '').trim();
    if (!token) throw new Error('Missing GITHUB_TOKEN script property');
    if (!dryRun && !webhook) throw new Error('Missing GOOGLE_CHAT_SECURITY_WEBHOOK script property');

    const previous = loadState_(token);
    const report = scan_({ token, previous, started });
    // Runs before planning so a failed start is reported with the other errors.
    const fix = startFixes_(report, previous, {
      mode: (props.getProperty('FIX_MODE') || 'off').trim(),
      token: (props.getProperty('FIX_DISPATCH_TOKEN') || '').trim(),
      preview: dryRun,
    });
    const { messages, state } = planNotifications_(report, previous);
    state.fixes = fix.fixes;
    console.log(
      `Main findings: ${report.main ? report.main.length : 'unknown'}; failed audit jobs: ${report.failures.length}; ` +
        `scan errors: ${report.errors.length}; deferred runs: ${report.deferred}; fix agent: ${fix.summary}`,
    );

    if (dryRun) {
      console.log(JSON.stringify({ dryRun: true, messages }, null, 2));
    } else {
      for (const message of messages) {
        // Stable ID helps correlate the rare duplicate after delivery succeeds but saving state fails.
        sendChat_(webhook, `ThunderID security monitor [${messageId_(message)}]\n\n${message}`);
        Utilities.sleep(1100);
      }
      saveState_(state);
    }
    logRun_(report, dryRun, messages.length, Date.now() - started, fix.summary);
    if (report.errors.length) console.warn(report.errors.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Starts the security fix agent workflow in the fork for advisories upstream main reports that it was not
 * started for in the last day. The workflow itself skips advisories that already have an open upstream PR.
 */
function startFixes_(report, previous, { mode, token, preview }) {
  const fixes = Object.assign({}, previous.fixes || {});
  if (report.main === null) return { fixes, summary: 'skipped, main scan failed' };
  const current = report.main.map((finding) => finding.id).filter((id, index, ids) => ids.indexOf(id) === index);
  // Forget advisories main no longer reports, so a regression starts the agent again.
  for (const id of Object.keys(fixes)) if (current.indexOf(id) < 0) delete fixes[id];
  if (FIX_MODES.indexOf(mode) < 0) {
    report.errors.push(`Fix agent: FIX_MODE must be off, dry-run or live, not "${mode}"`);
    return { fixes, summary: 'invalid FIX_MODE' };
  }
  const now = Date.parse(report.scannedAt);
  const due = current.filter((id) => !(fixes[id] && now - Date.parse(fixes[id]) < FIX_RETRY_MS));
  if (mode === 'off') return { fixes, summary: 'off' };
  if (!due.length) return { fixes, summary: 'nothing new' };
  if (preview) return { fixes, summary: `would start for ${due.join(', ')} (${mode})` };
  if (!token) {
    report.errors.push('Fix agent: missing FIX_DISPATCH_TOKEN script property');
    return { fixes, summary: 'missing token' };
  }
  const status = dispatchFix_(token, { advisories: due.join(','), ref: 'main', dryRun: mode === 'dry-run' });
  if (status !== 204) {
    report.errors.push(`Fix agent: starting the workflow failed with HTTP ${status}`);
    return { fixes, summary: 'start failed' };
  }
  for (const id of due) fixes[id] = report.scannedAt;
  return { fixes, summary: `started for ${due.join(', ')} (${mode})` };
}

/** Starts the fix agent workflow on the fork's main and returns the HTTP status; GitHub answers 204 on success. */
function dispatchFix_(token, { advisories, ref, dryRun }) {
  return fetchWithRetry_(`https://api.github.com/repos/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}/dispatches`, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main', inputs: { advisories, ref, base_branch: 'main', dry_run: String(dryRun) } }),
  }).getResponseCode();
}

/** Upstream main just before #5711, which still had two critical handlebars advisories. */
function testFixDispatch() {
  requireScopes_();
  const token = (PropertiesService.getScriptProperties().getProperty('FIX_DISPATCH_TOKEN') || '').trim();
  if (!token) throw new Error('Missing FIX_DISPATCH_TOKEN script property');
  const status = dispatchFix_(token, {
    advisories: 'GHSA-8r5x-fm3f-whwj,GHSA-p8wg-vrv2-v86f',
    ref: 'f00b0ef6e1b2e7182f75e276352a8f2115ed1510',
    dryRun: true,
  });
  console.log(
    status === 204
      ? `Started a fix agent dry run. Follow it at https://github.com/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}`
      : `Starting the fix agent failed with HTTP ${status}. Check that FIX_DISPATCH_TOKEN has Actions read and write on ${FIX_REPO}.`,
  );
}

function scan_({ token, previous, started }) {
  const report = {
    scannedAt: new Date().toISOString(),
    upstream: UPSTREAM,
    main: null,
    failures: [],
    errors: [],
    deferred: 0,
  };
  try {
    const commit = github_(`repos/${UPSTREAM}/commits/main`, { token });
    report.sha = commit.sha;
    // Only data files are downloaded. Nothing from upstream is executed.
    const lockfile = github_(`repos/${UPSTREAM}/contents/pnpm-lock.yaml?ref=${commit.sha}`, { token, raw: true });
    const workspace = github_(`repos/${UPSTREAM}/contents/pnpm-workspace.yaml?ref=${commit.sha}`, {
      token,
      raw: true,
    });
    const packages = lockfilePackages(lockfile);
    if (!Object.keys(packages).length) throw new Error('No packages found in pnpm-lock.yaml');
    const bulk = npmBulkAudit_(packages);
    report.main = groupFindings_(auditFindings(bulk, auditIgnores(workspace)));
  } catch (error) {
    report.errors.push(`Main scan: ${error.message}`);
  }

  try {
    // Include older PR runs that were rerun recently. GitHub has no updated_at run filter.
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const cache = previous.runCache || {};
    report.runCache = {};
    const runs = pages_(
      `repos/${UPSTREAM}/actions/workflows/pr-builder.yml/runs?status=failure&created=${encodeURIComponent(`>=${since}`)}`,
      'workflow_runs',
      token,
    );
    for (const run of runs) {
      const cacheKey = `${run.id}:${run.run_attempt}:${run.updated_at}`;
      if (cache[cacheKey]) {
        report.failures.push(...cache[cacheKey]);
        report.runCache[cacheKey] = cache[cacheKey];
        continue;
      }
      // Uninspected runs are picked up by the next execution instead of hitting the six-minute limit.
      if (Date.now() - started > RUN_BUDGET_MS) {
        report.deferred++;
        continue;
      }
      try {
        let logsFailed = false;
        const failures = [];
        const jobs = pages_(`repos/${UPSTREAM}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`, 'jobs', token);
        for (const job of auditFailures(jobs)) {
          const failure = {
            runId: run.id,
            attempt: run.run_attempt,
            jobId: job.id,
            url: job.html_url,
            branch: run.head_branch,
            sha: run.head_sha,
            ids: [],
          };
          try {
            failure.ids = advisoryIds(jobLog_(job.id, token));
          } catch (error) {
            // Keep the confirmed failure visible even when logs are expired or inaccessible.
            logsFailed = true;
            report.errors.push(`Job ${job.id} logs: ${error.message}`);
          }
          report.failures.push(failure);
          failures.push(failure);
        }
        if (!logsFailed) report.runCache[cacheKey] = failures;
      } catch (error) {
        report.errors.push(`Run ${run.id}: ${error.message}`);
      }
    }
    report.failures.sort((a, b) => b.runId - a.runId || a.jobId - b.jobId);
  } catch (error) {
    report.errors.push(`Failed-job scan: ${error.message}`);
  }
  return report;
}

/** Collects every name@version from the `packages:` sections of a pnpm v9 lockfile, env document included. */
function lockfilePackages(text) {
  const versions = text.match(/^lockfileVersion: .*$/gm) || [];
  if (!versions.length || versions.some((line) => !/^lockfileVersion: '?9\.0'?$/.test(line))) {
    throw new Error(`Unsupported ${versions[0] || 'missing lockfileVersion'}; update the monitor's lockfile parser`);
  }
  const request = {};
  let inPackages = false;
  let pendingName = null;
  const add = (name, version) => {
    if (!request[name]) request[name] = [];
    if (request[name].indexOf(version) < 0) request[name].push(version);
  };
  for (const line of text.split(/\r?\n/)) {
    if (line === '---' || /^\S/.test(line)) {
      inPackages = line === 'packages:';
      pendingName = null;
      continue;
    }
    if (!inPackages) continue;
    const key = line.match(/^ {2}(?:'([^']+)'|"([^"]+)"|([^\s'"#][^:]*)):\s*$/);
    if (key) {
      const spec = key[1] || key[2] || key[3];
      const at = spec.lastIndexOf('@');
      if (at <= 0) continue;
      const name = spec.slice(0, at);
      const ref = spec.slice(at + 1);
      pendingName = null;
      if (/^\d+\.\d+\.\d+/.test(ref)) add(name, ref);
      else pendingName = name;
      continue;
    }
    // Non-registry packages (tarballs, git) carry their version in the entry body.
    const version = pendingName && line.match(/^ {4}version:\s*'?([^'\s]+)'?\s*$/);
    if (version) {
      add(pendingName, version[1]);
      pendingName = null;
    }
  }
  return request;
}

/** Reads GHSA ignores from pnpm-workspace.yaml. `audit.ignore` overrides `auditConfig.ignoreGhsas`, as in pnpm 11. */
function auditIgnores(text) {
  const list = (section, field) => {
    const lines = text.split(/\r?\n/);
    const start = lines.indexOf(`${section}:`);
    if (start < 0) return null;
    for (let i = start + 1; i < lines.length && !/^\S/.test(lines[i]); i++) {
      const head = lines[i].match(new RegExp(`^ {2}${field}:\\s*(.*)$`));
      if (!head) continue;
      const inline = head[1].replace(/#.*$/, '').trim();
      if (inline.startsWith('[')) {
        return inline
          .slice(1, -1)
          .split(',')
          .map((value) => value.trim().replace(/^['"]|['"]$/g, ''))
          .filter(Boolean);
      }
      const values = [];
      for (let j = i + 1; j < lines.length; j++) {
        const line = lines[j];
        if (!line.trim() || /^\s*#/.test(line)) continue;
        const item = line.match(/^\s{2,}-\s*['"]?([^'"#\s]+)/);
        if (!item) break;
        values.push(item[1]);
      }
      return values;
    }
    return null;
  };
  return (list('audit', 'ignore') || list('auditConfig', 'ignoreGhsas') || []).map(normalizeGhsaId);
}

/** Mirrors pnpm 11's bulk response handling, ignore filter and --audit-level=high, then the monitor's parseAudit. */
function auditFindings(bulk, ignores) {
  if (!bulk || typeof bulk !== 'object' || Array.isArray(bulk)) {
    throw new Error('npm bulk audit returned an unexpected body');
  }
  const ignored = {};
  for (const id of ignores) ignored[id] = true;
  const findings = {};
  for (const name of Object.keys(bulk)) {
    for (const adv of bulk[name]) {
      if (typeof adv.id !== 'number' || KNOWN_SEVERITIES.indexOf(adv.severity) < 0) continue;
      const match = (adv.url || '').match(/\/(GHSA-[\w-]+)/i);
      const id = match ? normalizeGhsaId(match[1]) : '';
      if (id && ignored[id]) continue;
      if (adv.severity !== 'high' && adv.severity !== 'critical') continue;
      if (!id) throw new Error('Audit advisory missing GHSA or package');
      findings[adv.id] = {
        id,
        package: name,
        severity: adv.severity,
        title: adv.title || '',
        patched: inferPatchedVersions(adv.vulnerable_versions) || null,
        url: adv.url,
      };
    }
  }
  return Object.keys(findings).map((key) => findings[key]);
}

/**
 * npm returns one advisory entry per affected package and range, so a single GHSA can appear several times
 * (GHSA-587h-7wmj-h5pm covers both vite and launch-editor). Alerts are per GHSA.
 */
function groupFindings_(findings) {
  const byId = {};
  for (const finding of findings) {
    const group = byId[finding.id] || (byId[finding.id] = { id: finding.id, severity: finding.severity, title: finding.title, url: finding.url, packages: [], patched: [] });
    if (group.packages.indexOf(finding.package) < 0) group.packages.push(finding.package);
    const range = `${finding.package} ${finding.patched || 'none reported'}`;
    if (group.patched.indexOf(range) < 0) group.patched.push(range);
    if (finding.severity === 'critical') group.severity = 'critical';
  }
  return Object.keys(byId)
    .sort()
    .map((id) => Object.assign(byId[id], { packages: byId[id].packages.sort(), patched: byId[id].patched.sort() }));
}

function mainMessage_(finding, sha) {
  return (
    `Upstream main: ${finding.severity.toUpperCase()} ${finding.packages.join(', ')}\n${finding.title}\n${finding.url}\n` +
    `Advisory patch range: ${finding.patched.join(', ')} (publication and compatibility not verified)\n` +
    `Commit: https://github.com/${UPSTREAM}/commit/${sha}`
  );
}

function formatTime_(iso) {
  return `${String(iso).slice(0, 16).replace('T', ' ')} UTC`;
}

function inferPatchedVersions(range) {
  const trimmed = String(range || '').trim();
  const lt = trimmed.match(/(?:^|\s)<\s*(\d+\.\d+\.\d[\w\-.+]*)\s*$/);
  if (lt) return `>=${lt[1]}`;
  const lte = trimmed.match(/(?:^|\s)<=\s*(\d+\.\d+\.\d[\w\-.+]*)\s*$/);
  if (lte) {
    const version = lte[1].match(/^(\d+)\.(\d+)\.(\d+)(-[^+]+)?/);
    if (version) return version[4] ? `>=${version[1]}.${version[2]}.${version[3]}` : `>=${version[1]}.${version[2]}.${Number(version[3]) + 1}`;
  }
  return undefined;
}

function normalizeGhsaId(id) {
  const trimmed = String(id).trim();
  const dash = trimmed.indexOf('-');
  if (dash < 0) return trimmed.toUpperCase();
  return trimmed.slice(0, dash).toUpperCase() + trimmed.slice(dash).toLowerCase();
}

function auditFailures(jobs) {
  return jobs.filter(
    (job) => job.steps && job.steps.some((step) => step.conclusion === 'failure' && /\bpnpm audit\b/i.test(step.name)),
  );
}

function advisoryIds(log) {
  const ids = {};
  for (const id of log.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) || []) ids[id] = true;
  return Object.keys(ids).sort();
}

function planNotifications_(report, previous) {
  const state = JSON.parse(JSON.stringify(previous || {}));
  state.version = 1;
  state.seen = state.seen || {};
  state.main = state.main || {};
  const now = Date.parse(report.scannedAt);
  for (const key of Object.keys(state.seen)) {
    if (now - Date.parse(state.seen[key]) > 30 * DAY) delete state.seen[key];
  }
  const messages = [];
  if (report.main !== null) {
    const current = {};
    for (const finding of report.main) {
      const fingerprint = JSON.stringify([finding.severity, finding.patched]);
      const saved = state.main[finding.id];
      // Older state kept only a fingerprint string. Those advisories were already announced, so adopt them quietly.
      const known =
        typeof saved === 'string'
          ? { fingerprint, firstReportedAt: state.lastScan || report.scannedAt, notifiedAt: state.lastScan || report.scannedAt }
          : saved;
      const entry = known ? Object.assign({}, known) : { firstReportedAt: report.scannedAt };
      if (!known) {
        messages.push(mainMessage_(finding, report.sha));
        entry.notifiedAt = report.scannedAt;
      } else if (known.fingerprint !== fingerprint) {
        messages.push(`Advisory details changed since the last alert.\n\n${mainMessage_(finding, report.sha)}`);
        entry.notifiedAt = report.scannedAt;
      } else if (now - Date.parse(known.notifiedAt) >= MAIN_REMINDER_MS) {
        messages.push(
          `Reminder: still not fixed on upstream main. First reported ${formatTime_(known.firstReportedAt)}.\n\n${mainMessage_(finding, report.sha)}`,
        );
        entry.notifiedAt = report.scannedAt;
      }
      entry.fingerprint = fingerprint;
      current[finding.id] = entry;
      state.seen[`advisory:${finding.id}`] = report.scannedAt;
    }
    const resolved = Object.keys(state.main).filter((id) => !(id in current));
    if (resolved.length) {
      messages.push(
        `No longer reported by upstream main's configured audit: ${resolved.join(', ')}. This can reflect a fix or an upstream ignore change.`,
      );
    }
    state.main = current;
  }
  for (const failure of report.failures) {
    const keys = failure.ids.length ? failure.ids.map((id) => `advisory:${id}`) : [`job:${failure.jobId}`];
    if (keys.some((key) => !state.seen[key])) {
      messages.push(
        `Upstream CI: pnpm audit failed\nAdvisories: ${failure.ids.join(', ') || 'not available; inspect job logs'}\n` +
          `Branch: ${failure.branch}\n${failure.url}\nThis run may use dependencies that differ from current main.`,
      );
    }
    for (const key of keys) state.seen[key] = report.scannedAt;
  }
  const errors = report.errors.slice().sort();
  if (errors.length && JSON.stringify(errors) !== JSON.stringify(state.errors || [])) {
    messages.push(`Security monitor could not complete all checks:\n${errors.join('\n')}\nThis is not a clean scan.`);
  } else if (!errors.length && state.errors && state.errors.length) {
    messages.push('Security monitor recovered: both main and failed-job checks completed.');
  }
  state.errors = errors;
  state.lastScan = report.scannedAt;
  if (report.runCache) state.runCache = report.runCache;
  return { messages, state };
}

function github_(path, { token, raw = false, allow404 = false } = {}) {
  const options = {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  };
  const response = fetchWithRetry_(`https://api.github.com/${path}`, options);
  const status = response.getResponseCode();
  if (allow404 && status === 404) return null;
  if (status < 200 || status >= 300) throw new Error(`GitHub GET ${path.split('?')[0]}: HTTP ${status}`);
  return raw ? response.getContentText() : JSON.parse(response.getContentText());
}

/** GitHub answers with a redirect to signed blob storage, which must not receive the GitHub token. */
function jobLog_(jobId, token) {
  const path = `repos/${UPSTREAM}/actions/jobs/${jobId}/logs`;
  const redirect = fetchWithRetry_(`https://api.github.com/${path}`, {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: false,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const status = redirect.getResponseCode();
  if (status === 200) return redirect.getContentText();
  const headers = redirect.getAllHeaders();
  const location = headers.Location || headers.location;
  if (status !== 302 || !location) throw new Error(`GitHub GET ${path}: HTTP ${status}`);
  const log = fetchWithRetry_(location, { method: 'get', muteHttpExceptions: true });
  if (log.getResponseCode() !== 200) throw new Error(`Job log download: HTTP ${log.getResponseCode()}`);
  return log.getContentText();
}

function pages_(path, field, token) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const data = github_(`${path}${path.indexOf('?') >= 0 ? '&' : '?'}per_page=100&page=${page}`, { token });
    if (!Array.isArray(data[field])) throw new Error(`Missing GitHub response field: ${field}`);
    items.push(...data[field]);
    if (data[field].length < 100) return items;
  }
  throw new Error(`Pagination limit reached for ${field}; narrow the scan interval`);
}

function npmBulkAudit_(request) {
  const response = fetchWithRetry_(NPM_BULK_AUDIT_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(request),
    muteHttpExceptions: true,
  });
  if (response.getResponseCode() !== 200) throw new Error(`npm bulk audit: HTTP ${response.getResponseCode()}`);
  return JSON.parse(response.getContentText());
}

/** Retries network failures and 5xx responses up to three attempts. */
function fetchWithRetry_(url, options) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = UrlFetchApp.fetch(url, options);
    } catch (error) {
      if (attempt === 2) {
        throw new Error(`Request to ${url.split('?')[0].split('/').slice(0, 3).join('/')} failed: ${redact_(error.message)}`);
      }
      Utilities.sleep(1000 * (attempt + 1));
      continue;
    }
    if (response.getResponseCode() < 500 || attempt === 2) return response;
    Utilities.sleep(1000 * (attempt + 1));
  }
  return response;
}

/** Strips GitHub tokens and Chat webhook keys from error text before it is logged or posted. */
function redact_(text) {
  return String(text)
    .replace(/github_pat_\w+|gh[pousr]_\w+/g, '[token]')
    .replace(/https:\/\/chat\.googleapis\.com\/\S+/g, '[chat webhook]');
}

function sendChat_(webhook, text) {
  if (!/^https:\/\/chat\.googleapis\.com\/v1\/spaces\//.test(webhook)) {
    throw new Error('Expected a Google Chat incoming webhook URL');
  }
  const response = UrlFetchApp.fetch(webhook, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ text }),
    muteHttpExceptions: true,
  });
  // Never include the webhook URL in errors: it contains the Chat credential.
  if (response.getResponseCode() !== 200) throw new Error(`Google Chat delivery failed: HTTP ${response.getResponseCode()}`);
}

function messageId_(message) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, message, Utilities.Charset.UTF_8)
    .map((byte) => ((byte + 256) % 256).toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
}

/** State lives in a hidden sheet. On first use it is seeded from the GitHub monitor's state branch to avoid a backlog. */
function loadState_(token) {
  const sheet = stateSheet_();
  const rows = sheet.getLastRow();
  if (rows > 0) {
    const json = sheet
      .getRange(1, 1, rows, 1)
      .getValues()
      .map((row) => String(row[0]).slice(1))
      .join('');
    if (json) {
      const state = JSON.parse(json);
      if (state.version !== 1) throw new Error('Unsupported notification state version');
      return state;
    }
  }
  try {
    const file = github_(`repos/${SEED_STATE_REPO}/contents/state.json?ref=${SEED_STATE_BRANCH}`, { token, allow404: true });
    if (file) {
      const state = JSON.parse(Utilities.newBlob(Utilities.base64Decode(file.content)).getDataAsString());
      if (state.version === 1) return state;
    }
  } catch (error) {
    console.warn(`Could not seed state from ${SEED_STATE_REPO}: ${error.message}`);
  }
  return {};
}

function saveState_(state) {
  const json = JSON.stringify(state);
  const chunks = [];
  // The leading letter stops Sheets from reading a chunk as a formula or number.
  for (let i = 0; i < json.length; i += STATE_CHUNK) chunks.push([`s${json.slice(i, i + STATE_CHUNK)}`]);
  const sheet = stateSheet_();
  sheet.clearContents();
  if (chunks.length) sheet.getRange(1, 1, chunks.length, 1).setNumberFormat('@').setValues(chunks);
  SpreadsheetApp.flush();
}

function stateSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(STATE_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(STATE_SHEET);
    sheet.hideSheet();
  }
  return sheet;
}

function logRun_(report, dryRun, messageCount, durationMs, fixSummary) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(RUNS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(RUNS_SHEET, 0);
    sheet
      .getRange(1, 1, 1, 10)
      .setValues([
        ['Scanned at (UTC)', 'Mode', 'Upstream main', 'Main findings', 'Failed audit jobs', 'Deferred runs', 'Errors', 'Messages', 'Seconds', 'Fix agent'],
      ])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  } else if (!sheet.getRange(1, 10).getValue()) {
    sheet.getRange(1, 10).setValue('Fix agent').setFontWeight('bold');
  }
  sheet.appendRow([
    report.scannedAt,
    dryRun ? 'dry run' : 'live',
    report.sha ? report.sha.slice(0, 9) : '',
    report.main ? report.main.length : 'unknown',
    report.failures.length,
    report.deferred,
    report.errors.join('\n'),
    messageCount,
    Math.round(durationMs / 1000),
    fixSummary,
  ]);
  const extra = sheet.getLastRow() - 1 - MAX_RUN_ROWS;
  if (extra > 0) sheet.deleteRows(2, extra);
}
