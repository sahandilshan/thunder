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
 *   4. Optionally starts the security fix agent workflow in the fork for new findings on main, at most
 *      FIX_MAX_ATTEMPTS times per advisory, and records every finished fix run in the "Fix runs" tab.
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
// Automatic fix agent starts per advisory while upstream main keeps reporting it, a day apart.
const FIX_MAX_ATTEMPTS = 3;
const FIX_RUNS_SHEET = 'Fix runs';
// Tokens is what Codex reports as "tokens used": everything except cached input, which costs less.
const FIX_RUNS_COLUMNS = ['Started (UTC)', 'Mode', 'Advisories', 'Outcome', 'PR or branch', 'Tokens', 'Cached input tokens', 'Output tokens', 'Agent minutes', 'Run'];
const FIX_SUMMARY_ARTIFACT = 'security-fix-summary';
// Run outcomes the workflow uses to stop repeated runs; reported here at most once a day.
const FIX_LIMIT_STATUSES = ['cooldown', 'daily_limit'];
// Recording fix runs stops starting new downloads after this, leaving the rest for the next run.
const FIX_RUNS_BUDGET_MS = RUN_BUDGET_MS + 60 * 1000;
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
    const fixToken = (props.getProperty('FIX_DISPATCH_TOKEN') || '').trim();
    // Both run before planning so their failures are reported with the other errors.
    const fix = startFixes_(report, previous, { mode: (props.getProperty('FIX_MODE') || 'off').trim(), token: fixToken, preview: dryRun });
    // A dry run saves no state, so recording there would add the same rows again on the next run.
    const fixRuns = dryRun ? null : recordFixRuns_(report, previous, fixToken, fix.fixes, started);
    if (!dryRun) {
      // Saved before any Chat delivery: a failed send must not restart the agent or repeat Fix runs rows.
      const fixState = { version: 1, fixes: fix.fixes };
      if (fixRuns && fixRuns.recorded) fixState.fixRunsRecorded = fixRuns.recorded;
      saveState_(Object.assign({}, previous, fixState));
    }
    const planned = planNotifications_(report, previous);
    const state = planned.state;
    state.fixes = fix.fixes;
    if (fixRuns && fixRuns.recorded) {
      state.fixRunsRecorded = fixRuns.recorded;
      state.fixLimitAlertAt = fixRuns.limitAlertAt;
    }
    const messages = planned.messages.concat(fix.messages, fixRuns ? fixRuns.messages : []);
    const fixSummary = `${fix.summary}${fixRuns && fixRuns.count ? `; recorded ${fixRuns.count} fix run(s)` : ''}`;
    console.log(
      `Main findings: ${report.main ? report.main.length : 'unknown'}; failed audit jobs: ${report.failures.length}; ` +
        `scan errors: ${report.errors.length}; deferred runs: ${report.deferred}; fix agent: ${fixSummary}`,
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
    logRun_(report, dryRun, messages.length, Date.now() - started, fixSummary);
    if (report.errors.length) console.warn(report.errors.join('\n'));
  } finally {
    lock.releaseLock();
  }
}

/**
 * Starts the security fix agent workflow in the fork for advisories upstream main reports. Each advisory gets at
 * most FIX_MAX_ATTEMPTS automatic starts, a day apart, and one message once they are used up. The workflow also
 * skips advisories that have an open upstream PR or that it worked on in the last 20 hours.
 */
function startFixes_(report, previous, { mode, token, preview }) {
  const fixes = {};
  for (const id of Object.keys(previous.fixes || {})) {
    const entry = previous.fixes[id];
    // Older state kept only the time of the last start.
    const fix = typeof entry === 'string' ? { lastStartedAt: entry, attempts: 1 } : Object.assign({}, entry);
    // Attempts count per mode, so dry-run starts never use up the live ones.
    if (fix.mode && (mode === 'dry-run' || mode === 'live') && fix.mode !== mode) continue;
    fixes[id] = fix;
  }
  const messages = [];
  if (report.main === null) return { fixes, messages, summary: 'skipped, main scan failed' };
  const current = report.main.map((finding) => finding.id).filter((id, index, ids) => ids.indexOf(id) === index);
  // Forget advisories main no longer reports, so a regression starts the agent again.
  for (const id of Object.keys(fixes)) if (current.indexOf(id) < 0) delete fixes[id];
  if (FIX_MODES.indexOf(mode) < 0) {
    report.errors.push(`Fix agent: FIX_MODE must be off, dry-run or live, not "${mode}"`);
    return { fixes, messages, summary: 'invalid FIX_MODE' };
  }
  if (mode === 'off') return { fixes, messages, summary: 'off' };
  const now = Date.parse(report.scannedAt);
  const waited = (id) => !fixes[id] || now - Date.parse(fixes[id].lastStartedAt) >= FIX_RETRY_MS;
  const due = current.filter((id) => waited(id) && (!fixes[id] || fixes[id].attempts < FIX_MAX_ATTEMPTS));
  const exhausted = current.filter((id) => fixes[id] && fixes[id].attempts >= FIX_MAX_ATTEMPTS && waited(id) && !fixes[id].stoppedAt);
  for (const id of exhausted) {
    messages.push(
      `Security fix agent stopped for ${id}: it worked on it ${FIX_MAX_ATTEMPTS} times and upstream main still reports it. ` +
        `A fixed release may not exist yet, or a pull request may be waiting for review; otherwise fix it by hand. ` +
        `Earlier runs: https://github.com/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}`,
    );
    fixes[id].stoppedAt = report.scannedAt;
  }
  const stopped = exhausted.length ? `stopped for ${exhausted.join(', ')}` : '';
  if (!due.length) return { fixes, messages, summary: stopped || 'nothing new' };
  if (preview) return { fixes, messages, summary: [`would start for ${due.join(', ')} (${mode})`, stopped].filter(Boolean).join('; ') };
  if (!token) {
    report.errors.push('Fix agent: missing FIX_DISPATCH_TOKEN script property');
    return { fixes, messages, summary: 'missing token' };
  }
  const status = dispatchFix_(token, { advisories: due.join(','), ref: 'main', dryRun: mode === 'dry-run', force: false });
  if (status !== 204) {
    report.errors.push(`Fix agent: starting the workflow failed with HTTP ${status}`);
    return { fixes, messages, summary: 'start failed' };
  }
  for (const id of due) fixes[id] = { lastStartedAt: report.scannedAt, attempts: (fixes[id] ? fixes[id].attempts : 0) + 1, mode };
  return { fixes, messages, summary: [`started for ${due.join(', ')} (${mode})`, stopped].filter(Boolean).join('; ') };
}

/**
 * Adds a "Fix runs" row for each finished fix agent run not recorded yet, from the summary file each run uploads.
 * An advisory the workflow skipped without running the agent (open PR, cooldown, daily limit, no longer reported)
 * gets its attempt back in fixes. Runs skipped by the workflow's limits get at most one message a day: something
 * starts the agent too often.
 */
function recordFixRuns_(report, previous, token, fixes, started) {
  const result = { recorded: null, limitAlertAt: previous.fixLimitAlertAt || null, messages: [], count: 0 };
  if (!token) return result;
  try {
    const known = (previous.fixRunsRecorded || []).slice();
    const runs = github_(`repos/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}/runs?status=completed&per_page=30`, { token }).workflow_runs;
    const rows = [];
    let limited = 0;
    for (const run of runs.filter((item) => known.indexOf(item.id) < 0).reverse()) {
      if (Date.now() - started > FIX_RUNS_BUDGET_MS) break;
      let summary = null;
      let unreadable = false;
      try {
        summary = fixRunSummary_(run.id, token);
      } catch (error) {
        unreadable = true;
        console.warn(`Fix run ${run.id} summary: ${error.message}`);
      }
      if (summary && FIX_LIMIT_STATUSES.indexOf(summary.status) >= 0) limited++;
      if (summary) refundSkipped_(fixes, summary);
      const seconds = summary && Number(summary.agentSeconds);
      const usage = (summary && summary.tokens) || {};
      // Older summaries have no "uncached" field; it is the total without cached input, as Codex reports it.
      const tokens = 'uncached' in usage ? Number(usage.uncached) : Number(usage.total) - Number(usage.cachedInput);
      const cell = (value) => (value >= 0 ? value : '');
      rows.push([
        run.run_started_at || run.created_at,
        (summary ? summary.dryRun : /\(dry run\)/.test(run.display_title)) ? 'dry run' : 'live',
        summary ? summary.requested.join(', ') : (run.display_title.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) || []).join(', '),
        summary ? summary.status : `${run.conclusion} (${unreadable ? 'summary unreadable' : 'no summary'})`,
        (summary && summary.url) || '',
        cell(tokens),
        cell(Number(usage.cachedInput)),
        cell(Number(usage.output)),
        seconds > 0 ? Math.round(seconds / 6) / 10 : '',
        run.html_url,
      ]);
      known.push(run.id);
    }
    if (rows.length) appendFixRuns_(rows);
    result.recorded = known.slice(-300);
    result.count = rows.length;
    if (limited && (!result.limitAlertAt || Date.parse(report.scannedAt) - Date.parse(result.limitAlertAt) >= DAY)) {
      result.messages.push(
        `Security fix agent skipped ${limited} run(s) because of its limits (20-hour cooldown or daily run limit). ` +
          `Something may be starting it more than once a day: https://github.com/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}`,
      );
      result.limitAlertAt = report.scannedAt;
    }
  } catch (error) {
    report.errors.push(`Fix runs log: ${error.message}`);
  }
  return result;
}

/** Gives back the attempt of each advisory a run requested but did not run the agent for, in the run's own mode. */
function refundSkipped_(fixes, summary) {
  const mode = summary.dryRun ? 'dry-run' : 'live';
  for (const id of summary.requested || []) {
    const fix = fixes && fixes[id];
    if (!fix || (summary.targets || []).indexOf(id) >= 0 || (fix.mode && fix.mode !== mode) || !(fix.attempts > 0)) continue;
    fix.attempts -= 1;
    delete fix.stoppedAt;
  }
}

function fixRunSummary_(runId, token) {
  const artifacts = github_(`repos/${FIX_REPO}/actions/runs/${runId}/artifacts?per_page=100`, { token }).artifacts || [];
  const artifact = artifacts.filter((item) => item.name === FIX_SUMMARY_ARTIFACT && !item.expired)[0];
  if (!artifact) return null;
  const files = Utilities.unzip(githubDownload_(`repos/${FIX_REPO}/actions/artifacts/${artifact.id}/zip`, token).getBlob());
  const file = files.filter((item) => item.getName() === 'summary.json')[0];
  return file ? JSON.parse(file.getDataAsString()) : null;
}

function appendFixRuns_(rows) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(FIX_RUNS_SHEET);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(FIX_RUNS_SHEET, 1);
    sheet
      .getRange(1, 1, 1, FIX_RUNS_COLUMNS.length)
      .setValues([FIX_RUNS_COLUMNS])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // The run link is the key: a run already in the tab is never added twice.
  const last = sheet.getLastRow();
  const width = FIX_RUNS_COLUMNS.length;
  const present = last > 1 ? sheet.getRange(2, width, last - 1, 1).getValues().map((row) => row[0]) : [];
  const fresh = rows.filter((row) => present.indexOf(row[width - 1]) < 0);
  if (fresh.length) sheet.getRange(last + 1, 1, fresh.length, width).setValues(fresh);
}

/** Starts the fix agent workflow on the fork's main and returns the HTTP status; GitHub answers 204 on success. */
function dispatchFix_(token, { advisories, ref, dryRun, force }) {
  return fetchWithRetry_(`https://api.github.com/repos/${FIX_REPO}/actions/workflows/${FIX_WORKFLOW}/dispatches`, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main', inputs: { advisories, ref, base_branch: 'main', dry_run: String(dryRun), force: String(force) } }),
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
    // A manual test skips the cooldown and daily limit, so repeating it never looks like a loop.
    force: true,
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

function jobLog_(jobId, token) {
  return githubDownload_(`repos/${UPSTREAM}/actions/jobs/${jobId}/logs`, token).getContentText();
}

/** GitHub answers downloads with a redirect to signed blob storage, which must not receive the GitHub token. */
function githubDownload_(path, token) {
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
  if (status === 200) return redirect;
  const headers = redirect.getAllHeaders();
  const location = headers.Location || headers.location;
  if (status !== 302 || !location) throw new Error(`GitHub GET ${path.split('?')[0]}: HTTP ${status}`);
  const download = fetchWithRetry_(location, { method: 'get', muteHttpExceptions: true });
  if (download.getResponseCode() !== 200) throw new Error(`Download of ${path.split('?')[0]}: HTTP ${download.getResponseCode()}`);
  return download;
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
