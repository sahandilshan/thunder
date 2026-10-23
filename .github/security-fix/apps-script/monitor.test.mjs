// Offline tests for Code.gs: Apps Script services are replaced with small fakes.
// Run with: node --test monitor.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const CODE = fs.readFileSync(fileURLToPath(new URL("./Code.gs", import.meta.url)), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

function load(route = () => ({ code: 404, body: "" }), properties = {}) {
  const requests = [];
  const sheets = {};
  const makeSheet = () => {
    const rows = [];
    const sheet = {
      rows,
      getLastRow: () => rows.length,
      getRange: (row, col, numRows = 1, numCols = 1) => {
        const range = {
          setValues: (values) => {
            values.forEach((value, i) => (rows[row - 1 + i] = value));
            return range;
          },
          getValues: () => rows.slice(row - 1, row - 1 + numRows).map((r) => r.slice(col - 1, col - 1 + numCols)),
          setFontWeight: () => range,
          setNumberFormat: () => range,
        };
        return range;
      },
      clearContents: () => (rows.length = 0, sheet),
      hideSheet: () => sheet,
      setFrozenRows: () => sheet,
      appendRow: (row) => (rows.push(row), sheet),
      deleteRows: () => sheet,
    };
    return sheet;
  };
  const ctx = vm.createContext({
    console: { log: () => {}, warn: () => {} },
    Utilities: {
      sleep: () => {},
      unzip: (blob) => blob.files,
      DigestAlgorithm: { SHA_256: "sha256" },
      Charset: { UTF_8: "utf8" },
      computeDigest: () => Array.from({ length: 32 }, (_, i) => i),
    },
    UrlFetchApp: {
      fetch: (url, options = {}) => {
        requests.push({ url, options });
        const { code = 200, body = "", headers = {}, blob = null } = route(url, options);
        return {
          getResponseCode: () => code,
          getContentText: () => (typeof body === "string" ? body : JSON.stringify(body)),
          getAllHeaders: () => headers,
          getBlob: () => blob,
        };
      },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (key) => properties[key] ?? null }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: {
      flush: () => {},
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => sheets[name] || null,
        insertSheet: (name) => (sheets[name] = makeSheet()),
      }),
    },
  });
  vm.runInContext(CODE, ctx);
  return { ctx, requests, sheets };
}

const A = "GHSA-aaaa-aaaa-aaaa";
const B = "GHSA-bbbb-bbbb-bbbb";
const NOW = "2026-10-23T12:00:00.000Z";
const hoursAgo = (hours) => new Date(Date.parse(NOW) - hours * 3600 * 1000).toISOString();
const report = (ids, extra = {}) => ({ scannedAt: NOW, main: ids.map((id) => ({ id })), failures: [], errors: [], ...extra });
const dispatchOk = (url) => (url.endsWith("/dispatches") ? { code: 204 } : { code: 404 });

test("a start is counted per advisory, and older timestamp-only state counts as one attempt", () => {
  const { ctx, requests } = load(dispatchOk);
  const out = ctx.startFixes_(report([A, B]), { fixes: { A: "unused", [A]: hoursAgo(30) } }, { mode: "live", token: "t", preview: false });
  assert.equal(requests.length, 1);
  assert.equal(JSON.parse(requests[0].options.payload).inputs.advisories, `${A},${B}`);
  assert.deepEqual(plain(out.fixes), { [A]: { lastStartedAt: NOW, attempts: 2, mode: "live" }, [B]: { lastStartedAt: NOW, attempts: 1, mode: "live" } });
  assert.equal(out.summary, `started for ${A}, ${B} (live)`);
});

test("after the last attempt the agent is not started again and one message says so", () => {
  const { ctx, requests } = load(dispatchOk);
  const previous = { fixes: { [A]: { lastStartedAt: hoursAgo(25), attempts: 3 } } };
  const first = ctx.startFixes_(report([A]), previous, { mode: "live", token: "t", preview: false });
  assert.equal(requests.length, 0);
  assert.equal(first.messages.length, 1);
  assert.match(first.messages[0], new RegExp(`^Security fix agent stopped for ${A}: it worked on it 3 times`));
  assert.equal(first.summary, `stopped for ${A}`);
  const second = ctx.startFixes_(report([A]), { fixes: plain(first.fixes) }, { mode: "live", token: "t", preview: false });
  assert.equal(second.messages.length, 0);
  assert.equal(second.summary, "nothing new");
});

test("the attempt count resets when upstream main stops reporting the advisory", () => {
  const { ctx } = load(dispatchOk);
  const previous = { fixes: { [A]: { lastStartedAt: hoursAgo(25), attempts: 3, stoppedAt: hoursAgo(1) } } };
  const gone = ctx.startFixes_(report([]), previous, { mode: "live", token: "t", preview: false });
  assert.deepEqual(plain(gone.fixes), {});
  const back = ctx.startFixes_(report([A]), { fixes: plain(gone.fixes) }, { mode: "live", token: "t", preview: false });
  assert.equal(plain(back.fixes)[A].attempts, 1);
});

test("within a day of the last start nothing happens; off mode is silent; previews only describe what would happen", () => {
  const { ctx, requests } = load(dispatchOk);
  const recent = { fixes: { [A]: { lastStartedAt: hoursAgo(5), attempts: 3 } } };
  assert.deepEqual(plain(ctx.startFixes_(report([A]), recent, { mode: "live", token: "t", preview: false }).messages), []);
  const used = { fixes: { [A]: { lastStartedAt: hoursAgo(30), attempts: 3 } } };
  assert.equal(ctx.startFixes_(report([A]), used, { mode: "off", token: "t", preview: false }).messages.length, 0);
  const preview = ctx.startFixes_(report([A, B]), used, { mode: "live", token: "t", preview: true });
  assert.equal(preview.summary, `would start for ${B} (live); stopped for ${A}`);
  assert.equal(preview.messages.length, 1, "a preview shows the stop message it would send");
  assert.equal(requests.length, 0);
});

test("attempts count per mode, and a failed start leaves the count alone", () => {
  const { ctx, requests } = load(dispatchOk);
  const dryRunUsed = { fixes: { [A]: { lastStartedAt: hoursAgo(30), attempts: 3, mode: "dry-run", stoppedAt: hoursAgo(1) } } };
  const live = ctx.startFixes_(report([A]), dryRunUsed, { mode: "live", token: "t", preview: false });
  assert.deepEqual(plain(live.fixes)[A], { lastStartedAt: NOW, attempts: 1, mode: "live" });
  assert.equal(requests.length, 1);
  const { ctx: failing } = load((url) => (url.endsWith("/dispatches") ? { code: 422 } : { code: 404 }));
  const r = report([A]);
  const kept = { fixes: { [A]: { lastStartedAt: hoursAgo(30), attempts: 1, mode: "live" } } };
  const out = failing.startFixes_(r, kept, { mode: "live", token: "t", preview: false });
  assert.deepEqual(plain(out.fixes), plain(kept.fixes));
  assert.deepEqual(plain(r.errors), ["Fix agent: starting the workflow failed with HTTP 422"]);
});

function fixRunsRoute(summaries) {
  return (url, options) => {
    if (url.includes("/actions/workflows/security-fix-agent.yml/runs")) {
      return {
        body: {
          workflow_runs: [
            { id: 202, run_started_at: hoursAgo(1), display_title: `Security fix: ${B} (dry run)`, conclusion: "success", html_url: "https://run/202" },
            { id: 201, run_started_at: hoursAgo(2), display_title: `Security fix: ${A}`, conclusion: "failure", html_url: "https://run/201" },
          ],
        },
      };
    }
    if (url.includes("/runs/201/artifacts")) return { body: { artifacts: [] } };
    if (url.includes("/runs/202/artifacts")) return { body: { artifacts: [{ id: 9, name: "security-fix-summary", expired: false }] } };
    if (url.endsWith("/actions/artifacts/9/zip")) {
      assert.equal(options.followRedirects, false);
      return { code: 302, headers: { Location: "https://blob.example/9" } };
    }
    if (url === "https://blob.example/9") {
      assert.equal(options.headers, undefined, "the signed download URL must not receive the GitHub token");
      return { blob: { files: [{ getName: () => "summary.json", getDataAsString: () => JSON.stringify(summaries[202]) }] } };
    }
    return { code: 404 };
  };
}

const summary202 = {
  version: 1,
  runId: 202,
  dryRun: true,
  requested: [B],
  targets: [B],
  status: "pr_open",
  action: "pr",
  title: "Raise b",
  url: "",
  tokens: { total: 81196, input: 78986, cachedInput: 0, output: 2210 },
  agentSeconds: 218,
  reasons: [],
};

test("finished fix runs are recorded once each, oldest first, from their summary files", () => {
  const { ctx, sheets } = load(fixRunsRoute({ 202: summary202 }));
  const r = report([]);
  const out = ctx.recordFixRuns_(r, {}, "fix-token", {}, Date.now());
  assert.deepEqual(plain(r.errors), []);
  assert.equal(out.count, 2);
  assert.deepEqual(plain(out.recorded), [201, 202]);
  const rows = plain(sheets["Fix runs"].rows);
  assert.deepEqual(rows[0], ["Started (UTC)", "Mode", "Advisories", "Outcome", "PR or branch", "Tokens", "Agent minutes", "Run"]);
  assert.deepEqual(rows[1], [hoursAgo(2), "live", A, "failure (no summary)", "", "", "", "https://run/201"]);
  assert.deepEqual(rows[2], [hoursAgo(1), "dry run", B, "pr_open", "", 81196, 3.6, "https://run/202"]);
  const again = ctx.recordFixRuns_(report([]), { fixRunsRecorded: [201, 202] }, "fix-token", {}, Date.now());
  assert.equal(again.count, 0);
  assert.equal(sheets["Fix runs"].rows.length, 3);
});

test("runs skipped by the workflow's limits produce at most one message a day", () => {
  const limited = { ...summary202, status: "cooldown", tokens: null, agentSeconds: null };
  const { ctx } = load(fixRunsRoute({ 202: limited }));
  const first = ctx.recordFixRuns_(report([]), {}, "fix-token", {}, Date.now());
  assert.equal(first.messages.length, 1);
  assert.match(first.messages[0], /^Security fix agent skipped 1 run\(s\) because of its limits/);
  assert.equal(first.limitAlertAt, NOW);
  const { ctx: next } = load(fixRunsRoute({ 202: limited }));
  const quiet = next.recordFixRuns_(report([]), { fixLimitAlertAt: hoursAgo(3) }, "fix-token", {}, Date.now());
  assert.equal(quiet.messages.length, 0);
});

test("a GitHub failure while recording is reported as a scan error and records nothing", () => {
  const { ctx, sheets } = load(() => ({ code: 500 }));
  const r = report([]);
  const out = ctx.recordFixRuns_(r, { fixRunsRecorded: [1] }, "fix-token", {}, Date.now());
  assert.equal(out.recorded, null);
  assert.match(r.errors[0], /^Fix runs log: GitHub GET repos\/sahandilshan\/thunder\/actions\/workflows\/security-fix-agent.yml\/runs: HTTP 500$/);
  assert.equal(sheets["Fix runs"], undefined);
  assert.equal(ctx.recordFixRuns_(report([]), {}, "", {}, Date.now()).recorded, null, "nothing is recorded without FIX_DISPATCH_TOKEN");
});

test("job logs are still downloaded through the shared redirect helper", () => {
  const { ctx } = load((url, options) =>
    url.endsWith("/actions/jobs/7/logs") ? { code: 302, headers: { location: "https://blob.example/log" } } : url === "https://blob.example/log" && !options.headers ? { body: "GHSA-aaaa-aaaa-aaaa failed" } : { code: 404 },
  );
  assert.equal(ctx.jobLog_(7, "t"), "GHSA-aaaa-aaaa-aaaa failed");
});

test("one alert per advisory across packages, then a reminder after 12 hours", () => {
  const { ctx } = load();
  const main = ctx.groupFindings_([
    { id: A, package: "vite", severity: "high", title: "t", url: "u", patched: ">=8.1.6" },
    { id: A, package: "launch-editor", severity: "high", title: "t", url: "u", patched: ">=2.14.2" },
  ]);
  const at = (hours) => ({ scannedAt: new Date(Date.parse(NOW) + hours * 3600 * 1000).toISOString(), sha: "abc", main, failures: [], errors: [] });
  const first = ctx.planNotifications_(at(0), { version: 1 });
  assert.equal(first.messages.length, 1);
  assert.match(first.messages[0], /^Upstream main: HIGH launch-editor, vite/);
  assert.equal(ctx.planNotifications_(at(0.5), plain(first.state)).messages.length, 0);
  const reminder = ctx.planNotifications_(at(12), plain(first.state));
  assert.match(reminder.messages[0], /^Reminder: still not fixed on upstream main\./);
});

test("the limit message comes back after 24 hours", () => {
  const limited = { ...summary202, status: "daily_limit", tokens: null, agentSeconds: null };
  const { ctx } = load(fixRunsRoute({ 202: limited }));
  const out = ctx.recordFixRuns_(report([]), { fixLimitAlertAt: hoursAgo(25) }, "fix-token", {}, Date.now());
  assert.equal(out.messages.length, 1);
});

test("an advisory a run skipped without the agent gets its attempt back, in that run's mode only", () => {
  const skipped = { ...summary202, dryRun: false, requested: [A, B], targets: [B], status: "pr_open" };
  const { ctx } = load(fixRunsRoute({ 202: skipped }));
  const fixes = {
    [A]: { lastStartedAt: hoursAgo(2), attempts: 3, mode: "live", stoppedAt: hoursAgo(1) },
    [B]: { lastStartedAt: hoursAgo(2), attempts: 2, mode: "live" },
  };
  ctx.recordFixRuns_(report([]), {}, "fix-token", fixes, Date.now());
  assert.deepEqual(fixes[A], { lastStartedAt: hoursAgo(2), attempts: 2, mode: "live" });
  assert.equal(fixes[B].attempts, 2, "the agent ran for B, so its attempt stands");
  const other = { [A]: { lastStartedAt: hoursAgo(2), attempts: 3, mode: "dry-run" } };
  const { ctx: again } = load(fixRunsRoute({ 202: skipped }));
  again.recordFixRuns_(report([]), {}, "fix-token", other, Date.now());
  assert.equal(other[A].attempts, 3, "a live run does not refund a dry-run attempt");
});

test("an unreadable summary still gets a row, and a run already in the tab is not added again", () => {
  const route = fixRunsRoute({ 202: summary202 });
  const { ctx, sheets } = load((url, options) => (url === "https://blob.example/9" ? { code: 500 } : route(url, options)));
  ctx.recordFixRuns_(report([]), {}, "fix-token", {}, Date.now());
  const rows = plain(sheets["Fix runs"].rows);
  assert.equal(rows.length, 3);
  assert.equal(rows[2][3], "success (summary unreadable)");
  ctx.recordFixRuns_(report([]), {}, "fix-token", {}, Date.now());
  assert.equal(sheets["Fix runs"].rows.length, 3, "the same runs recorded again by mistake are skipped by their link");
});

test("recording stops starting downloads when the run's time budget is spent", () => {
  const { ctx } = load(fixRunsRoute({ 202: summary202 }));
  const out = ctx.recordFixRuns_(report([]), {}, "fix-token", {}, Date.now() - 6 * 60 * 1000);
  assert.equal(out.count, 0);
  assert.deepEqual(plain(out.recorded), []);
});

test("a monitor run saves the fix agent's counters before Chat, so a failed send cannot restart the agent", () => {
  const finding = { id: A, severity: "high", title: "t", url: "https://github.com/advisories/x", packages: ["vite"], patched: ["vite >=8.1.6"] };
  const properties = { GITHUB_TOKEN: "read", GOOGLE_CHAT_SECURITY_WEBHOOK: "https://chat.googleapis.com/v1/spaces/X/messages?key=k", FIX_MODE: "live", FIX_DISPATCH_TOKEN: "fix" };
  const route = (url) => {
    if (url.endsWith("/dispatches")) return { code: 204 };
    if (url.includes("/actions/workflows/security-fix-agent.yml/runs")) return { body: { workflow_runs: [] } };
    if (url.startsWith("https://chat.googleapis.com/")) return { code: 500 };
    return { code: 404 };
  };
  const { ctx, requests, sheets } = load(route, properties);
  ctx.scan_ = () => ({ scannedAt: new Date().toISOString(), sha: "abc", main: [finding], failures: [], errors: [], deferred: 0 });
  assert.throws(() => ctx.execute_({ dryRun: false }), /Google Chat delivery failed: HTTP 500/);
  const dispatches = () => requests.filter((r) => r.url.endsWith("/dispatches")).length;
  assert.equal(dispatches(), 1);
  const saved = JSON.parse(sheets._monitor_state.rows.map((row) => String(row[0]).slice(1)).join(""));
  assert.equal(saved.fixes[A].attempts, 1);
  assert.deepEqual(saved.fixRunsRecorded, []);
  assert.throws(() => ctx.execute_({ dryRun: false }), /Google Chat delivery failed/);
  assert.equal(dispatches(), 1, "the next tick does not start the agent again");
});

test("a monitor dry run neither records fix runs nor saves state", () => {
  const properties = { GITHUB_TOKEN: "read", FIX_MODE: "live", FIX_DISPATCH_TOKEN: "fix" };
  const { ctx, requests, sheets } = load(() => ({ code: 404 }), properties);
  ctx.scan_ = () => ({ scannedAt: new Date().toISOString(), sha: "abc", main: [], failures: [], errors: [], deferred: 0 });
  ctx.execute_({ dryRun: true });
  assert.equal(requests.filter((r) => r.url.includes("/actions/workflows/")).length, 0);
  assert.equal(sheets._monitor_state ? sheets._monitor_state.rows.length : 0, 0);
});
