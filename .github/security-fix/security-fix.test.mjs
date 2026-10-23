import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classify, floor } from "./guard.mjs";
import { lintWorkspace, overrideTarget } from "./lint-overrides.mjs";
import {
  agentRanFrom,
  applyLimits,
  auditCheck,
  changesDependencies,
  cleanTitle,
  decide,
  detailLines,
  parseAdvisories,
  renderBody,
  reportedAdvisories,
  titleAdvisories,
  tokenUsage,
} from "./publish.mjs";

const pkg = (deps, extra = {}) => JSON.stringify({ name: "x", ...extra, dependencies: deps }, null, 2);
const reader = (files) => (path, side) => files[path]?.[side] ?? null;

test("raising a direct dependency within its major version is automatic", () => {
  const files = { "frontend/packages/create/package.json": { before: pkg({ handlebars: "^4.7.9" }), after: pkg({ handlebars: "^4.7.10" }) } };
  const result = classify([...Object.keys(files), "pnpm-lock.yaml"], reader(files));
  assert.equal(result.verdict, "auto");
  assert.match(result.changes[0], /raises handlebars from \^4\.7\.9 to \^4\.7\.10/);
});

test("catalog and existing override raises are automatic", () => {
  const files = {
    "pnpm-workspace.yaml": {
      before: "catalog:\n  next: 16.3.6\noverrides:\n  shell-quote: '>=1.8.5'\n",
      after: "catalog:\n  next: 16.3.8\noverrides:\n  shell-quote: '>=1.11.0'\n",
    },
  };
  const result = classify(["pnpm-workspace.yaml", "pnpm-lock.yaml"], reader(files));
  assert.equal(result.verdict, "auto");
  assert.equal(result.changes.length, 2);
});

test("new overrides, audit ignores and release-age exceptions need review", () => {
  const files = {
    "pnpm-workspace.yaml": {
      before: "overrides:\n  vue: 3.5.34\nauditConfig:\n  ignoreGhsas: []\n",
      after:
        "overrides:\n  vue: 3.5.42\n  '@docusaurus/core>tinypool': 2.1.2\nauditConfig:\n  ignoreGhsas:\n    - GHSA-ch52-4w7c-c8xp\nminimumReleaseAgeExclude:\n  - source-map-js@1.2.2\n",
    },
  };
  const result = classify(["pnpm-workspace.yaml"], reader(files));
  assert.equal(result.verdict, "review");
  assert.equal(result.reasons.length, 3);
  assert.deepEqual(result.changes, ["pnpm-workspace.yaml overrides: raises vue from 3.5.34 to 3.5.42"]);
});

test("major bumps, 0.x minor bumps, lowered and added dependencies need review", () => {
  const files = {
    "a/package.json": {
      before: pkg({ next: "^15.5.0", sharp: "^0.34.1", joi: "^18.2.9" }),
      after: pkg({ next: "^16.3.8", sharp: "^0.35.5", joi: "^18.2.6", added: "^1.0.0" }),
    },
  };
  const result = classify(["a/package.json"], reader(files));
  assert.equal(result.verdict, "review");
  assert.equal(result.reasons.length, 4);
});

test("non-dependency package.json changes need review but key order does not matter", () => {
  const before = JSON.stringify({ name: "x", version: "1.0.0", dependencies: { a: "^1.0.0" } });
  const reordered = JSON.stringify({ dependencies: { a: "^1.0.0" }, version: "1.0.0", name: "x" });
  assert.equal(classify(["p/package.json"], reader({ "p/package.json": { before, after: reordered } })).verdict, "auto");
  const scripts = JSON.stringify({ name: "x", version: "1.0.0", dependencies: { a: "^1.0.0" }, scripts: { postinstall: "curl evil" } });
  assert.equal(classify(["p/package.json"], reader({ "p/package.json": { before, after: scripts } })).verdict, "review");
});

test("any other file is rejected", () => {
  const files = { "backend/go.mod": { before: "module x", after: "module y" } };
  assert.equal(classify(["backend/go.mod", "pnpm-lock.yaml"], reader(files)).verdict, "reject");
  assert.equal(classify([".github/workflows/x.yml"], reader({})).verdict, "reject");
  assert.equal(classify([], reader({})).verdict, "none");
});

test("floor reads the lowest version a range names", () => {
  assert.deepEqual(floor(">=1.11.0"), [1, 11, 0]);
  assert.deepEqual(floor("^4.7"), [4, 7, 0]);
  assert.equal(floor("catalog:"), null);
});

test("advisory input is validated and the audit report is matched", () => {
  assert.deepEqual(parseAdvisories("GHSA-8r5x-fm3f-whwj, GHSA-8r5x-fm3f-whwj"), ["GHSA-8r5x-fm3f-whwj"]);
  assert.throws(() => parseAdvisories("GHSA-8r5x-fm3f-whwj;rm -rf /"), /Invalid advisory ID/);
  const audit = {
    advisories: {
      1: { github_advisory_id: "GHSA-8r5x-fm3f-whwj", severity: "critical" },
      2: { github_advisory_id: "GHSA-aaaa-bbbb-cccc", severity: "moderate" },
    },
  };
  assert.deepEqual([...reportedAdvisories(audit)], ["GHSA-8r5x-fm3f-whwj"]);
});

test("titles lose conventional prefixes and fall back when unusable", () => {
  assert.equal(cleanTitle("fix(deps): Raise handlebars to 4.7.10", ["GHSA-8r5x-fm3f-whwj"]), "Raise handlebars to 4.7.10");
  assert.equal(cleanTitle("x".repeat(80), ["GHSA-8r5x-fm3f-whwj"]), "Fix the GHSA-8r5x-fm3f-whwj audit advisory");
  assert.equal(cleanTitle("", ["GHSA-8r5x-fm3f-whwj", "GHSA-p8wg-vrv2-v86f"]), "Fix 2 pnpm audit advisories");
});

const fixed = { status: "fixed", title: "t", purpose: "p", approach: "a", validation: "v", notes: "", advisories: [] };
const summary = { requested: ["GHSA-8r5x-fm3f-whwj"], targets: ["GHSA-8r5x-fm3f-whwj"], missing: [], existing: [] };
const passing = { apply: "ok", lockfile: "consistent", audit: "pass", lint: "pass" };

test("only a clean automatic fix opens a pull request", () => {
  const auto = { verdict: "auto", changes: ["raise"], reasons: [] };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: auto, checks: passing, patchSize: 10 }).action, "pr");
  const review = { verdict: "review", changes: [], reasons: ["new override"] };
  assert.deepEqual(
    decide({ summary, agentOutcome: "success", result: fixed, guard: review, checks: passing, patchSize: 10 }),
    { action: "branch", status: "needs_review", reasons: ["new override"] },
  );
  const failingAudit = { ...passing, audit: "fail" };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: auto, checks: failingAudit, patchSize: 10 }).status, "needs_review");
  const inconsistent = { ...passing, lockfile: "changed_by_pnpm_install" };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: auto, checks: inconsistent, patchSize: 10 }).status, "failed");
  const rejected = { verdict: "reject", changes: [], reasons: ["Dockerfile"] };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: rejected, checks: passing, patchSize: 10 }).action, "none");
});

test("runs without a usable change never push", () => {
  const none = { verdict: "none", changes: [], reasons: [] };
  const waiting = { ...fixed, status: "waiting_for_release", notes: "No release yet" };
  assert.deepEqual(decide({ summary, agentOutcome: "success", result: waiting, guard: none, checks: {}, patchSize: 0 }), {
    action: "none",
    status: "waiting_for_release",
    reasons: ["No release yet"],
  });
  assert.equal(decide({ summary, agentOutcome: "failure", result: null, guard: none, checks: {}, patchSize: 0 }).status, "failed");
  const gone = { ...summary, targets: [], missing: ["GHSA-8r5x-fm3f-whwj"] };
  assert.equal(decide({ summary: gone, agentOutcome: "skipped", result: null, guard: none, checks: {}, patchSize: 0 }).status, "not_reported");
  const open = { ...summary, targets: [], existing: [{ id: "GHSA-8r5x-fm3f-whwj", urls: ["u"] }] };
  assert.equal(decide({ summary: open, agentOutcome: "skipped", result: null, guard: none, checks: {}, patchSize: 0 }).status, "pr_exists");
});

test("the PR body follows the repository template", () => {
  const body = renderBody({ result: fixed, guard: { changes: ["raises a"], reasons: [] }, runUrl: "https://run" });
  for (const heading of ["### Purpose", "### Approach", "### Validation", "### Related Issues", "### Checklist", "### Security checks"]) {
    assert.ok(body.includes(heading), heading);
  }
  assert.ok(!/—/.test(body));
});

test("narrowing an existing override while raising it is automatic", () => {
  const files = {
    "pnpm-workspace.yaml": {
      before: "overrides:\n  follow-redirects: 1.16.0\n  launch-editor: '>=2.14.1'\n",
      after: "overrides:\n  follow-redirects@<1.16.1: '>=1.16.1'\n  launch-editor@<2.14.2: '>=2.14.2'\n",
    },
  };
  const result = classify(["pnpm-workspace.yaml"], reader(files));
  assert.equal(result.verdict, "auto");
  assert.equal(result.changes.length, 2);
  const lowered = { "pnpm-workspace.yaml": { before: "overrides:\n  a: 2.0.0\n", after: "overrides:\n  a@<1.9.0: '>=1.9.0'\n" } };
  assert.equal(classify(["pnpm-workspace.yaml"], reader(lowered)).verdict, "review");
  const scoped = { "pnpm-workspace.yaml": { before: "overrides:\n  vue: 3.5.34\n", after: "overrides:\n  vue: 3.5.34\n  '@docusaurus/core>tinypool': 2.1.2\n" } };
  assert.equal(classify(["pnpm-workspace.yaml"], reader(scoped)).verdict, "review");
});

test("override keys resolve to their package and parent path", () => {
  assert.deepEqual(overrideTarget("vite@>=8.0.0 <=8.0.15"), { name: "vite", range: ">=8.0.0 <=8.0.15", scoped: false, identity: "vite" });
  assert.deepEqual(overrideTarget("@docusaurus/core>tinypool"), { name: "tinypool", range: "", scoped: true, identity: "@docusaurus/core>tinypool" });
  assert.equal(overrideTarget("@scope/pkg@<1.2.3").identity, "@scope/pkg");
});

const advisories = { "GHSA-v6wh-96g9-6wx3": ["launch-editor", "vite"], "GHSA-9cwx-2883-4wfx": ["vite"] };
const lookup = async (id) => {
  if (!advisories[id]) throw new Error("HTTP 404");
  return advisories[id];
};
const workspace = (catalogVite, peerComment, overrides) =>
  `catalog:\n  vite: ${catalogVite}\noverrides:\n${overrides}peerDependencyRules:\n  allowedVersions:\n    # ${peerComment}\n    '@codecov/vite-plugin>vite': '8'\n`;
const base = workspace("8.0.16", "this workspace pins vite to 8.0.16.", "  # JUSTIFICATION: Fixes GHSA-9cwx-2883-4wfx, launch-editor NTLMv2 disclosure.\n  launch-editor: '>=2.14.1'\n");

test("the conventions check reports every finding from the first review of #5942", async () => {
  const head = workspace(
    "8.1.6",
    "this workspace pins vite to 8.0.16.",
    "  # JUSTIFICATION: Fixes GHSA-9cwx-2883-4wfx, launch-editor NTLMv2 disclosure.\n  # Also fixes GHSA-587h-7wmj-h5pm.\n  launch-editor: '>=2.14.2'\n",
  );
  const { problems } = await lintWorkspace(base, head, lookup);
  assert.equal(problems.length, 5);
  assert.match(problems[0], /pins every version of launch-editor/);
  assert.match(problems[1], /lacks an "Added YYYY-MM-DD" date, a "Remove once" condition/);
  assert.match(problems[2], /GHSA-9cwx-2883-4wfx, but that advisory covers vite, not launch-editor/);
  assert.match(problems[3], /GHSA-587h-7wmj-h5pm, which could not be verified: HTTP 404/);
  assert.match(problems[4], /unchanged comment still names vite 8\.0\.16/);
});

test("a narrowed, fully justified override with verified IDs passes", async () => {
  const head = workspace(
    "8.1.6",
    "this workspace pins vite to 8.1.6.",
    "  # JUSTIFICATION: Fixes GHSA-v6wh-96g9-6wx3, NTLMv2 disclosure. Enters through webpack-dev-server@5.2.6, which accepts ^2.14.1.\n  # Added 2026-06-16, narrowed and raised 2026-10-21. Remove once webpack-dev-server requires launch-editor >=2.14.2.\n  launch-editor@<2.14.2: '>=2.14.2'\n",
  );
  assert.deepEqual([...(await lintWorkspace(base, head, lookup)).problems], []);
  assert.deepEqual([...(await lintWorkspace(base, base, lookup)).problems], []);
});

test("a failing conventions check turns a clean fix into a review branch", () => {
  const auto = { verdict: "auto", changes: ["raise"], reasons: [] };
  const decision = decide({
    summary,
    agentOutcome: "success",
    result: fixed,
    guard: auto,
    checks: { ...passing, lint: "fail" },
    patchSize: 10,
    lint: { problems: ["overrides \"a\" pins every version of a."] },
  });
  assert.equal(decision.action, "branch");
  assert.deepEqual(decision.reasons, ['overrides "a" pins every version of a.']);
});

const auditOf = (...ids) => ({ advisories: Object.fromEntries(ids.map((id, i) => [i, { github_advisory_id: id, severity: "high" }])) });
const HB1 = "GHSA-8r5x-fm3f-whwj", HB2 = "GHSA-p8wg-vrv2-v86f", VITE = "GHSA-587h-7wmj-h5pm", NEW = "GHSA-aaaa-bbbb-cccc";

test("the audit passes when the targets are gone, even if advisories handled elsewhere remain", () => {
  const result = auditCheck(auditOf(HB1, HB2, VITE), auditOf(VITE), [HB1, HB2]);
  assert.equal(result.pass, true);
  assert.deepEqual([...result.fixed], [HB1, HB2]);
  assert.deepEqual([...result.unrelated], [VITE]);
});

test("the audit fails when a target remains or the change adds an advisory", () => {
  const remaining = auditCheck(auditOf(HB1, HB2), auditOf(HB2), [HB1, HB2]);
  assert.equal(remaining.pass, false);
  assert.deepEqual([...remaining.remaining], [HB2]);
  const added = auditCheck(auditOf(HB1), auditOf(NEW), [HB1]);
  assert.equal(added.pass, false);
  assert.deepEqual([...added.introduced], [NEW]);
  const reasons = decide({
    summary: { requested: [HB1], targets: [HB1], missing: [], existing: [] },
    agentOutcome: "success",
    result: fixed,
    guard: { verdict: "auto", changes: ["raise"], reasons: [] },
    checks: { ...passing, audit: "fail" },
    patchSize: 10,
    lint: { problems: [] },
    audit: added,
  }).reasons;
  assert.deepEqual(reasons, [`The change adds ${NEW}.`]);
});

test("only PRs that change dependency files count as existing fixes", () => {
  assert.equal(changesDependencies(["tools/k8s-operator/main.go", "docs/content/deployment/operator.mdx"]), false);
  assert.equal(changesDependencies(["pnpm-workspace.yaml", "pnpm-lock.yaml"]), true);
  assert.equal(changesDependencies(["frontend/packages/create/package.json"]), true);
});

test("the PR body names the fixed advisories and those handled elsewhere", () => {
  const body = renderBody({
    result: fixed,
    guard: { changes: ["raises handlebars"], reasons: [] },
    runUrl: "https://run",
    audit: { fixed: [HB1, HB2], unrelated: [VITE], remaining: [], introduced: [] },
  });
  assert.match(body, new RegExp(`no longer reports ${HB1}, ${HB2}, and the change adds no new`));
  assert.match(body, new RegExp(`${VITE} is still reported on the base commit and handled separately`));
});

test("the PR body mentions overrides only when the fix touched one", () => {
  const plain = renderBody({ result: fixed, guard: { changes: ["raises a"], reasons: [] }, runUrl: "u", lint: { touched: [], problems: [] } });
  assert.ok(!plain.includes("Every touched override"));
  assert.ok(plain.includes("still names a replaced version"));
  const overrides = renderBody({ result: fixed, guard: { changes: ["raises a"], reasons: [] }, runUrl: "u", lint: { touched: ["a@<1.2.3"], problems: [] } });
  assert.ok(overrides.includes("Every touched override is range-qualified or parent-scoped"));
});

const NOW = Date.parse("2026-10-23T12:00:00Z");
const hoursAgo = (hours) => new Date(NOW - hours * 3600 * 1000).toISOString();
const run = (id, hours, title, agentRan = true) => ({ id, createdAt: hoursAgo(hours), title, url: `https://run/${id}`, agentRan });
const limits = (ids, runs, extra = {}) => applyLimits(ids, runs, { now: NOW, currentRunId: 99, dryRun: false, dailyLimit: 6, force: false, ...extra });

test("run titles yield their advisory IDs", () => {
  assert.deepEqual(titleAdvisories("Security fix: GHSA-8R5X-fm3f-whwj,GHSA-p8wg-vrv2-v86f (dry run)"), [HB1, HB2]);
  assert.deepEqual(titleAdvisories(undefined), []);
});

test("an advisory the agent worked on in the last 20 hours is skipped, in the same mode only", () => {
  const runs = [run(1, 3, `Security fix: ${HB1}`), run(2, 2, `Security fix: ${HB2} (dry run)`), run(3, 21, `Security fix: ${VITE}`)];
  const live = limits([HB1, HB2, VITE], runs);
  assert.deepEqual(live.allowed, [HB2, VITE]);
  assert.deepEqual(live.cooldown, [{ id: HB1, url: "https://run/1" }]);
  const dry = limits([HB1, HB2], runs, { dryRun: true });
  assert.deepEqual(dry.allowed, [HB1]);
  assert.deepEqual(dry.cooldown, [{ id: HB2, url: "https://run/2" }]);
});

test("runs where the agent never ran do not start the cooldown or count toward the daily limit", () => {
  const runs = [run(1, 1, `Security fix: ${HB1}`, false), run(99, 0, `Security fix: ${HB1}`)];
  const result = limits([HB1], runs);
  assert.deepEqual(result.allowed, [HB1]);
  assert.equal(result.agentRuns, 0);
});

test("the daily limit stops every advisory, and force skips both limits", () => {
  const runs = Array.from({ length: 6 }, (_, i) => run(i + 1, i + 1, `Security fix: GHSA-aaaa-bbbb-ccc${i}`));
  runs.push(run(7, 25, `Security fix: ${NEW}`));
  const limited = limits([HB1], runs);
  assert.deepEqual(limited, { allowed: [], cooldown: [], limited: true, agentRuns: 6 });
  assert.equal(limits([HB1], runs, { dailyLimit: 7 }).limited, false);
  const forced = limits([HB1], [...runs, run(8, 1, `Security fix: ${HB1}`)], { force: true });
  assert.deepEqual(forced.allowed, [HB1]);
  assert.equal(forced.limited, false);
});

test("token usage comes from the last token_count event of the Codex session", () => {
  const event = (total, output) =>
    JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: total - output, cached_input_tokens: 10, output_tokens: output, total_tokens: total } } } });
  const log = [JSON.stringify({ type: "session_meta" }), event(1000, 100), event(81196, 2210), '{"type":"event_msg","payload":{"type":"token_cou'].join("\n");
  assert.deepEqual(tokenUsage(log), { total: 81196, uncached: 81186, input: 78986, cachedInput: 10, output: 2210 });
  assert.equal(tokenUsage('{"type":"session_meta"}'), null);
});

test("the Chat detail lists a shared open PR once and adds the agent's usage", () => {
  const detail = detailLines({
    reasons: ["reason"],
    existing: [
      { id: HB1, urls: ["https://github.com/thunder-id/thunderid/pull/6004"] },
      { id: HB2, urls: ["https://github.com/thunder-id/thunderid/pull/6004"] },
    ],
    tokens: { total: 524241, uncached: 59776, input: 520962, cachedInput: 464465, output: 3279 },
    seconds: 124,
  });
  assert.equal(
    detail,
    "reason\nOpen PR: https://github.com/thunder-id/thunderid/pull/6004\nAgent: 59,776 tokens plus 464,465 cached input tokens, 2.1 minutes.",
  );
  assert.equal(detailLines({ reasons: [], existing: [], tokens: null, seconds: 0 }), "");
});

test("limit outcomes take precedence in order: daily limit, open PR, cooldown", () => {
  const base = { requested: [HB1], targets: [], missing: [], existing: [], cooldown: [], limited: false, agentRuns: 0 };
  const none = { verdict: "none", changes: [], reasons: [] };
  const outcome = (summary) => decide({ summary: { ...base, ...summary }, agentOutcome: "skipped", result: null, guard: none, checks: {}, patchSize: 0 });
  assert.equal(outcome({ limited: true, agentRuns: 6 }).status, "daily_limit");
  assert.equal(outcome({ existing: [{ id: HB1, urls: ["u"] }], cooldown: [{ id: HB2, url: "r" }] }).status, "pr_exists");
  assert.deepEqual(outcome({ cooldown: [{ id: HB1, url: "https://run/1" }] }), {
    action: "none",
    status: "cooldown",
    reasons: [`${HB1}: https://run/1`],
  });
});

test("only an agent job that was skipped or never created means the agent did not run", () => {
  for (const value of ["success", "failure", "cancelled", "in_progress", "queued"]) assert.equal(agentRanFrom(value), true, value);
  for (const value of ["", "skipped"]) assert.equal(agentRanFrom(value), false, JSON.stringify(value));
});

test("the cooldown ends at 20 hours and the daily limit counts the last 24 hours", () => {
  const title = `Security fix: ${HB1}`;
  assert.deepEqual(limits([HB1], [run(1, 19.99, title)]).allowed, []);
  assert.deepEqual(limits([HB1], [run(1, 20, title)]).allowed, [HB1]);
  const day = Array.from({ length: 6 }, (_, i) => run(i + 1, 23.99, `Security fix: ${NEW}`));
  assert.equal(limits([HB1], day).limited, true);
  assert.equal(limits([HB1], day.map((r) => ({ ...r, createdAt: hoursAgo(24) }))).limited, false);
});

test("token counts are always numbers", () => {
  const line = JSON.stringify({ payload: { type: "token_count", info: { total_token_usage: { total_tokens: "=1+1", output_tokens: "12", input_tokens: -5 } } } });
  assert.deepEqual(tokenUsage(line), { total: 0, uncached: 0, input: 0, cachedInput: 0, output: 12 });
});

const here = fileURLToPath(new URL(".", import.meta.url));
const cli = (args, env = {}) => execFileSync("node", [join(here, "publish.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const outputs = (file) => Object.fromEntries([...readFileSync(file, "utf8").matchAll(/^(\w+)<<(EOF_\w+)\n([\s\S]*?)\n\2$/gm)].map((m) => [m[1], m[3]]));

test("the usage command reads the newest Codex session log and reports the agent's time", () => {
  const dir = mkdtempSync(join(tmpdir(), "usage-"));
  const sessions = join(dir, "sessions", "2026", "10", "23");
  mkdirSync(sessions, { recursive: true });
  const event = (total) => JSON.stringify({ payload: { type: "token_count", info: { total_token_usage: { total_tokens: total, output_tokens: 7 } } } });
  writeFileSync(join(sessions, "rollout-old.jsonl"), event(5));
  writeFileSync(join(sessions, "rollout-new.jsonl"), event(81196));
  utimesSync(join(sessions, "rollout-old.jsonl"), new Date(0), new Date(0));
  const githubOutput = join(dir, "output");
  writeFileSync(githubOutput, "");
  cli(["usage", "--codex-home", dir, "--started", String(Math.floor(Date.now() / 1000) - 218)], { GITHUB_OUTPUT: githubOutput });
  const out = outputs(githubOutput);
  assert.equal(JSON.parse(out.tokens).total, 81196);
  assert.ok(Number(out.seconds) >= 218 && Number(out.seconds) < 230);
  writeFileSync(githubOutput, "");
  cli(["usage", "--codex-home", join(dir, "missing")], { GITHUB_OUTPUT: githubOutput });
  assert.equal(outputs(githubOutput).tokens, "");
});

test("decide marks limit skips as silent and writes the decision the summary command turns into summary.json", () => {
  const dir = mkdtempSync(join(tmpdir(), "decide-"));
  const githubOutput = join(dir, "output");
  writeFileSync(githubOutput, "");
  const summary = { requested: [HB1], targets: [], missing: [], existing: [], cooldown: [{ id: HB1, url: "https://run/1" }], limited: false, agentRuns: 1 };
  cli(
    ["decide", "--summary", JSON.stringify(summary), "--agent-outcome", "skipped", "--run-url", "https://run/2", "--tokens", "", "--seconds", "",
      "--decision-out", join(dir, "decision.json"), "--body-out", join(dir, "body.md"), "--commit-out", join(dir, "commit.txt")],
    { GITHUB_OUTPUT: githubOutput },
  );
  const out = outputs(githubOutput);
  assert.equal(out.status, "cooldown");
  assert.equal(out.notify, "false");
  cli(["summary", "--decision", join(dir, "decision.json"), "--run-id", "42", "--dry-run", "true", "--status", "cooldown", "--url", "", "--out", join(dir, "summary.json")]);
  const written = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  assert.deepEqual(
    { runId: written.runId, dryRun: written.dryRun, requested: written.requested, targets: written.targets, status: written.status, tokens: written.tokens },
    { runId: 42, dryRun: true, requested: [HB1], targets: [], status: "cooldown", tokens: null },
  );
});

test("the workflow keeps the names and titles the run limits depend on", () => {
  const workflow = JSON.parse(
    execFileSync("ruby", ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), aliases: false))", join(here, "..", "workflows", "security-fix-agent.yml")], {
      encoding: "utf8",
    }),
  );
  assert.match(workflow["run-name"], /inputs\.advisories/);
  assert.match(workflow["run-name"], /' \(dry run\)'/);
  assert.equal(workflow.jobs.agent.name, undefined, "the agent job must keep the display name 'agent'");
  assert.equal(workflow.jobs.agent["timeout-minutes"], 15);
  assert.equal(workflow.jobs.check.permissions.actions, "read");
  // YAML 1.1 reads the "on" key as the boolean true.
  const on = workflow.on ?? workflow.true;
  assert.equal(on.workflow_dispatch.inputs.force.default, false);
  const step = (job, name) => workflow.jobs[job].steps.find((s) => s.name === name || s.with?.name === name);
  for (const [job, name] of [["agent", "Measure the agent's token usage"], ["publish", "Save the run summary"], ["publish", "security-fix-summary"]]) {
    assert.equal(step(job, name)["continue-on-error"], true, name);
  }
});
