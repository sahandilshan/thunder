import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classify, floor } from "./guard.mjs";
import { lintWorkspace, overrideTarget } from "./lint-overrides.mjs";
import {
  addUsage,
  applyLimits,
  auditCheck,
  budgetFreesAt,
  budgetMessage,
  changesDependencies,
  cleanTitle,
  decide,
  detailLines,
  jobFacts,
  parseAdvisories,
  parseLimit,
  ranFrom,
  renderBody,
  reportedAdvisories,
  runTokens,
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
// Runs record 60,000 tokens, about what a real fix uses, unless a test says otherwise.
const run = (id, hours, title, agentRan = true) => ({ id, startedAt: hoursAgo(hours), title, url: `https://run/${id}`, agentRan, codexStarted: agentRan, tokens: 60_000 });
const limits = (ids, runs, extra = {}) =>
  applyLimits(ids, runs, { now: NOW, currentRunId: 99, dryRun: false, dailyLimit: 6, tokenBudget: 1_000_000, force: false, ...extra });

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
  assert.deepEqual([limited.allowed, limited.limited, limited.agentRuns], [[], true, 6]);
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

test("only a job or step that was skipped or never created did not run", () => {
  for (const value of ["success", "failure", "cancelled", "in_progress", "queued"]) assert.equal(ranFrom(value), true, value);
  for (const value of ["", "skipped"]) assert.equal(ranFrom(value), false, JSON.stringify(value));
});

test("the cooldown ends at 20 hours and the daily limit counts the last 24 hours", () => {
  const title = `Security fix: ${HB1}`;
  assert.deepEqual(limits([HB1], [run(1, 19.99, title)]).allowed, []);
  assert.deepEqual(limits([HB1], [run(1, 20, title)]).allowed, [HB1]);
  const day = Array.from({ length: 6 }, (_, i) => run(i + 1, 23.99, `Security fix: ${NEW}`));
  assert.equal(limits([HB1], day).limited, true);
  assert.equal(limits([HB1], day.map((r) => ({ ...r, startedAt: hoursAgo(24) }))).limited, false);
});

test("token counts are always numbers", () => {
  const line = JSON.stringify({ payload: { type: "token_count", info: { total_token_usage: { total_tokens: "=1+1", output_tokens: "12", input_tokens: -5 } } } });
  assert.deepEqual(tokenUsage(line), { total: 0, uncached: 0, input: 0, cachedInput: 0, output: 12 });
});

const here = fileURLToPath(new URL(".", import.meta.url));
const cli = (args, env = {}) => execFileSync("node", [join(here, "publish.mjs"), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const outputs = (file) => Object.fromEntries([...readFileSync(file, "utf8").matchAll(/^(\w+)<<(EOF_\w+)\n([\s\S]*?)\n\2$/gm)].map((m) => [m[1], m[3]]));

test("the usage command adds up every Codex session log and reports the agent's time", () => {
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
  assert.deepEqual(JSON.parse(out.tokens), { total: 81201, uncached: 81201, input: 0, cachedInput: 0, output: 14 });
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
    { runId: written.runId, dryRun: written.dryRun, requested: written.requested, targets: written.targets, status: written.status, tokens: written.tokens, budgetNotified: written.budgetNotified },
    { runId: 42, dryRun: true, requested: [HB1], targets: [], status: "cooldown", tokens: null, budgetNotified: false },
  );
  cli(["summary", "--decision", join(dir, "decision.json"), "--run-id", "42", "--budget-notified", "true", "--force", "true", "--out", join(dir, "summary.json")]);
  const marked = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  assert.deepEqual([marked.budgetNotified, marked.force, written.force], [true, true, false]);
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
  assert.equal(workflow.jobs.publish.name, undefined, "the publish job must keep the display name 'publish'");
  assert.equal(workflow.jobs.agent["timeout-minutes"], 15);
  assert.equal(workflow.jobs.check.permissions.actions, "read");
  // YAML 1.1 reads the "on" key as the boolean true.
  const on = workflow.on ?? workflow.true;
  assert.equal(on.workflow_dispatch.inputs.force.default, false);
  const step = (job, name) => workflow.jobs[job].steps.find((s) => s.name === name || s.with?.name === name);
  assert.equal(step("agent", "Run Codex").id, "codex", "earlier runs are read by this step name");
  assert.equal(workflow.jobs.publish.permissions.actions, "read", "the budget step reads this run's jobs");
  assert.equal(step("publish", "Check the daily token budget").if, "always() && steps.decide.outcome == 'success'");
  const budgetNotify = step("publish", "Tell Google Chat the daily token budget is used up");
  assert.equal(budgetNotify.id, "budget_notify");
  assert.doesNotMatch(budgetNotify.if, /dry_run/, "dry runs post the budget message too");
  assert.equal(step("publish", "Save the run summary").env.BUDGET_NOTIFIED, "${{ steps.budget_notify.outcome == 'success' }}");
  for (const [job, name] of [
    ["agent", "Measure the agent's token usage"],
    ["publish", "Save the run summary"],
    ["publish", "security-fix-summary"],
    ["publish", "Check the daily token budget"],
    ["publish", "Tell Google Chat the daily token budget is used up"],
  ]) {
    assert.equal(step(job, name)["continue-on-error"], true, name);
  }
});

test("a run's token count comes from its summary, like Codex counts it", () => {
  assert.equal(runTokens({ tokens: { total: 524241, uncached: 59776, cachedInput: 464465 } }), 59776);
  assert.equal(runTokens({ tokens: { total: 524241, cachedInput: 464465 } }), 59776, "summaries written before uncached existed");
  assert.equal(runTokens({ tokens: null }), null);
  assert.equal(runTokens({ tokens: { uncached: "=1+1" } }), null);
});

test("the agent stops once the last 24 hours reach the token budget, counting unknown usage as 450,000", () => {
  const runs = [
    { ...run(1, 10, `Security fix: ${NEW}`), tokens: 400_000 },
    { ...run(2, 5, `Security fix: ${VITE}`), tokens: null },
    { ...run(3, 3, `Security fix: ${HB2}`, false), tokens: null },
    { ...run(4, 2, `Security fix: ${VITE}`), tokens: null, codexStarted: false },
  ];
  const under = limits([HB1], runs);
  assert.deepEqual([under.allowed, under.overBudget, under.tokensUsed], [[HB1], false, 850_000], "a run whose Codex never started counts 0");
  const over = limits([HB1], runs, { tokenBudget: 850_000 });
  assert.deepEqual([over.allowed, over.overBudget, over.notifyBudget, over.budgetFreesAt], [[], true, true, hoursAgo(10 - 24)]);
  const forced = limits([HB1], runs, { tokenBudget: 850_000, force: true });
  assert.deepEqual([forced.allowed, forced.tokensUsed, forced.notifyBudget], [[HB1], 850_000, false]);
  const both = limits([HB1], Array.from({ length: 6 }, (_, i) => ({ ...run(i + 1, 1, `Security fix: ${NEW}`), tokens: 900_000 })));
  assert.deepEqual([both.limited, both.overBudget], [true, false], "the run limit is reported first");
});

test("a run held back by the budget reports it only when no run since the newest agent run did", () => {
  const runs = [{ ...run(1, 10, `Security fix: ${NEW}`), tokens: 1_200_000 }, { ...run(2, 1, `Security fix: ${VITE}`, false), budgetNotified: true }];
  assert.equal(limits([HB1], runs).notifyBudget, false, "an earlier run reported it, even one whose agent did not run");
  assert.equal(limits([HB1], [{ ...runs[0], budgetNotified: true }]).notifyBudget, false, "the run that used it up reported it");
  assert.equal(limits([HB1], [runs[0], { ...runs[1], startedAt: hoursAgo(24) }]).notifyBudget, true, "that report is more than 24 hours old");
  assert.equal(limits([HB1], [runs[0], { ...runs[1], startedAt: hoursAgo(11) }]).notifyBudget, true, "that report belongs to an earlier stretch over the budget");
  const forcedLater = { ...run(3, 0.5, `Security fix: ${VITE}`), forced: true };
  assert.equal(limits([HB1], [...runs, forcedLater]).notifyBudget, false, "a forced run while over the budget starts no new stretch");
  assert.equal(limits([HB1], [runs[0]]).notifyBudget, true);
});

test("an advisory in its cooldown is reported as a cooldown skip even when the budget is used up", () => {
  const runs = [{ ...run(1, 2, `Security fix: ${HB1}`), tokens: 1_200_000 }];
  const cooling = limits([HB1], runs);
  assert.deepEqual([cooling.allowed, cooling.overBudget, cooling.cooldown], [[], false, [{ id: HB1, url: "https://run/1" }]]);
  const mixed = limits([HB1, HB2], runs);
  assert.deepEqual([mixed.allowed, mixed.overBudget, mixed.cooldown.length], [[], true, 1]);
});

test("the budget frees up when enough of the oldest runs have left the 24-hour window", () => {
  const ran = [
    { startedAt: hoursAgo(20), tokens: 300_000 },
    { startedAt: hoursAgo(10), tokens: 500_000 },
    { startedAt: hoursAgo(2), tokens: 400_000 },
  ];
  assert.equal(budgetFreesAt(ran, 1_000_000), hoursAgo(20 - 24));
  assert.equal(budgetFreesAt(ran, 500_000), hoursAgo(10 - 24));
  assert.equal(budgetFreesAt([], 1), null);
});

test("repository limit variables are whole numbers, with separators allowed", () => {
  assert.equal(parseLimit("", "LIMIT", 6), 6);
  assert.equal(parseLimit(undefined, "LIMIT", 6), 6);
  assert.equal(parseLimit("1,000,000", "LIMIT", 6), 1_000_000);
  assert.equal(parseLimit(" 1_500_000 ", "LIMIT", 6), 1_500_000);
  for (const value of ["abc", "0", "1.5", "-1", "1e6", "10,00", "1 0", "1,,0", "1,000_000", "0,000", "9".repeat(400)]) assert.throws(() => parseLimit(value, "LIMIT", 6), /LIMIT must be a positive whole number/, value);
});

test("usage from several Codex sessions is added up", () => {
  assert.deepEqual(addUsage([{ total: 10, uncached: 4 }, null, { total: 5, uncached: 5 }]), { total: 15, uncached: 9 });
  assert.equal(addUsage([null]), null);
});

test("the run that uses up the budget reports it, with usage counted again at that time", () => {
  const summary = { tokenBudget: 1_000_000, tokensUsed: 900_000, startedAt: hoursAgo(0.25), usage: [{ startedAt: hoursAgo(3), tokens: 900_000 }] };
  const message = (extra) => budgetMessage({ summary, tokens: null, agentRan: true, codexStarted: true, now: NOW, ...extra });
  assert.equal(
    message({ tokens: { uncached: 150_000 } }),
    `Used 1,050,000 of 1,000,000 tokens in the last 24 hours (this run: 150,000; cached input not counted). The agent can start again around ${hoursAgo(3 - 24).slice(0, 16).replace("T", " ")} UTC.`,
  );
  assert.match(message({ tokens: { uncached: 100_000 } }), /^Used 1,000,000 of 1,000,000/, "reaching the budget exactly uses it up");
  assert.equal(message({ tokens: { uncached: 50_000 } }), null, "still under");
  const alone = message({ summary: { ...summary, usage: [{ startedAt: hoursAgo(3), tokens: 500_000 }] }, tokens: { uncached: 1_200_000 } });
  assert.match(alone, new RegExp(`start again around ${hoursAgo(0.25 - 24).slice(0, 16).replace("T", " ")} UTC\\.$`), "this run alone is over: it frees 24 hours after it started");
  assert.equal(message({ summary: { ...summary, usage: [{ startedAt: hoursAgo(3), tokens: 1_000_000 }] }, tokens: { uncached: 1 } }), null, "already used up before");
  assert.equal(message({ agentRan: false }), null, "the agent did not run");
  assert.match(message({}), /\(this run: 450,000;/, "unknown usage counts as 450,000");
  assert.equal(message({ codexStarted: false }), null, "Codex never started");
  assert.equal(message({ summary: { usage: [] }, tokens: { uncached: 5 } }), null, "no limits were applied");
  // The check job counted 900,000, but by the time the run ends the oldest run has left the window.
  const later = { ...summary, usage: [{ startedAt: hoursAgo(23.9), tokens: 500_000 }, { startedAt: hoursAgo(3), tokens: 400_000 }] };
  assert.equal(message({ summary: later, tokens: { uncached: 150_000 }, now: NOW + 0.2 * 3600 * 1000 }), null);
  const crossed = message({ summary: later, tokens: { uncached: 650_000 }, now: NOW + 0.2 * 3600 * 1000 });
  assert.equal(crossed, `Used 1,050,000 of 1,000,000 tokens in the last 24 hours (this run: 650,000; cached input not counted). The agent can start again around ${hoursAgo(3 - 24).slice(0, 16).replace("T", " ")} UTC.`);
});

/** A stand-in for gh, first on PATH, that answers from data.json and applies --jq with the real jq, as gh does. */
function fakeGh(data) {
  const dir = mkdtempSync(join(tmpdir(), "gh-"));
  const setData = (value) => writeFileSync(join(dir, "data.json"), JSON.stringify(value));
  setData(data);
  writeFileSync(
    join(dir, "gh"),
    `#!/usr/bin/env node
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const data = JSON.parse(fs.readFileSync(${JSON.stringify(join(dir, "data.json"))}, "utf8"));
const args = process.argv.slice(2);
if (args[0] === "run" && args[1] === "download") {
  const summary = data.summaries[args[2]];
  if (!summary) process.exit(1);
  fs.writeFileSync(args[args.indexOf("-D") + 1] + "/summary.json", JSON.stringify(summary));
  process.exit(0);
}
const path = args.find((arg) => arg.startsWith("repos/"));
const jobs = path.match(/actions\\/runs\\/(\\d+)\\/jobs/);
const body = path.includes("/pulls?") ? [] : jobs ? data.jobs[jobs[1]] : path.includes("/workflows/") ? data.runs : null;
const jq = args[args.indexOf("--jq") + 1];
process.stdout.write(execFileSync("jq", ["-cr", jq], { input: JSON.stringify(body), encoding: "utf8" }));
`,
  );
  chmodSync(join(dir, "gh"), 0o755);
  const githubOutput = join(dir, "output");
  const env = { GITHUB_OUTPUT: githubOutput, PATH: `${dir}:${process.env.PATH}`, RUNNER_TEMP: dir };
  const run = (args) => {
    writeFileSync(githubOutput, "");
    const log = cli(args, env);
    return { log, out: outputs(githubOutput) };
  };
  return { dir, setData, run };
}

/** A jobs API listing. codex is the "Run Codex" conclusion; null means the agent job has no steps. */
const jobsOf = (agent, codex, publish = "success") => ({
  jobs: [
    { name: "check", conclusion: "success", steps: [] },
    { name: "agent", conclusion: agent, steps: codex ? [{ name: "Prepare the Codex configuration and prompt", conclusion: "success" }, { name: "Run Codex", conclusion: codex }, { name: "Post Run Codex", conclusion: "success" }] : [] },
    { name: "publish", conclusion: publish, steps: [] },
  ],
});

test("an agent job without a started Codex step counts no tokens", () => {
  const facts = (listing) => jobFacts(listing.jobs.map((job) => ({ name: job.name, result: job.conclusion, codex: job.steps.find((step) => step.name === "Run Codex")?.conclusion ?? "" })));
  assert.deepEqual(facts(jobsOf("cancelled", null)), { agentRan: true, codexStarted: false, publishRan: true }, "cancelled before it got a runner");
  assert.deepEqual(facts(jobsOf("failure", "skipped")), { agentRan: true, codexStarted: false, publishRan: true });
  assert.deepEqual(facts(jobsOf("cancelled", "cancelled")), { agentRan: true, codexStarted: true, publishRan: true }, "stopped by the time limit");
  assert.deepEqual(jobFacts([]), { agentRan: false, codexStarted: false, publishRan: false });
});

test("a run held back by the budget is silent but posts the budget message when no earlier run did", () => {
  const usage = [{ startedAt: new Date(Date.now() - 4 * 3600 * 1000).toISOString(), tokens: 1_200_000 }];
  const summary = { requested: [HB1], targets: [], missing: [], existing: [], cooldown: [], limited: false, overBudget: true, notifyBudget: true, agentRuns: 4, tokensUsed: 1_200_000, tokenBudget: 1_000_000, budgetFreesAt: "2026-10-24T04:29:17.000Z", usage };
  const gh = fakeGh({ jobs: {} });
  const decided = gh.run(["decide", "--summary", JSON.stringify(summary), "--agent-outcome", "skipped", "--run-url", "https://run/2", "--tokens", "", "--seconds", "",
    "--decision-out", join(gh.dir, "decision.json"), "--body-out", join(gh.dir, "body.md"), "--commit-out", join(gh.dir, "commit.txt")]).out;
  assert.deepEqual([decided.status, decided.notify], ["token_budget", "false"]);
  assert.equal(decided.detail, "1,200,000 of 1,000,000 tokens used in the last 24 hours; the agent can start again around 2026-10-24 04:29 UTC.");
  const budget = (extra) => gh.run(["budget", "--summary", JSON.stringify({ ...summary, ...extra }), "--repo", "sahandilshan/thunder", "--run-id", "99", "--tokens", ""]).out;
  const held = budget({});
  assert.equal(held.report, "true");
  assert.match(held.detail, /^Used 1,200,000 of 1,000,000 tokens in the last 24 hours \(cached input not counted\)\. The agent can start again around /);
  assert.equal(budget({ notifyBudget: false }).report, "false", "an earlier run already reported it");
  const running = { overBudget: false, notifyBudget: false, usage: [{ ...usage[0], tokens: 950_000 }] };
  gh.setData({ jobs: { 99: jobsOf("cancelled", "cancelled") } });
  assert.equal(budget(running).report, "true", "a run stopped by the time limit still counts");
  gh.setData({ jobs: { 99: jobsOf("cancelled", null) } });
  assert.equal(budget(running).report, "false", "Codex never started");
});

test("the targets command reads earlier runs, their jobs and their summaries through gh", () => {
  const ago = (hours) => new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const data = {
    runs: {
      workflow_runs: [
        { id: 99, created_at: ago(0.01), run_started_at: ago(0.01), display_title: `Security fix: ${HB1}`, html_url: "https://run/99" },
        { id: 1, created_at: ago(2), display_title: `Security fix: ${NEW}`, html_url: "https://run/1" },
        { id: 2, created_at: ago(3), display_title: `Security fix: ${VITE}`, html_url: "https://run/2" },
        { id: 3, created_at: ago(4), display_title: `Security fix: ${HB2}`, html_url: "https://run/3" },
        { id: 4, created_at: ago(1), display_title: `Security fix: ${HB2}`, html_url: "https://run/4" },
        // Created 30 hours ago and re-run by hand 1.5 hours ago.
        { id: 5, created_at: ago(30), run_started_at: ago(1.5), display_title: `Security fix: ${VITE}`, html_url: "https://run/5" },
        { id: 6, created_at: ago(6), display_title: `Security fix: ${VITE}`, html_url: "https://run/6" },
        { id: 7, created_at: ago(30), run_started_at: ago(30), display_title: `Security fix: ${VITE}`, html_url: "https://run/7" },
      ],
    },
    jobs: {
      1: jobsOf("success", "success"),
      2: jobsOf("cancelled", "cancelled"),
      3: jobsOf("failure", "skipped"),
      4: jobsOf("skipped", null),
      5: jobsOf("success", "success"),
      6: jobsOf("cancelled", null),
    },
    summaries: {
      1: { tokens: { total: 524_241, uncached: 59_776, cachedInput: 464_465 } },
      4: { status: "token_budget", budgetNotified: true },
      5: { tokens: { total: 100_000, uncached: 100_000, cachedInput: 0 } },
    },
  };
  const gh = fakeGh(data);
  writeFileSync(join(gh.dir, "audit.json"), JSON.stringify({ advisories: { 1: { severity: "high", github_advisory_id: HB1 } } }));
  const targets = (budget) =>
    gh.run(["targets", "--audit", join(gh.dir, "audit.json"), "--advisories", HB1, "--repo", "sahandilshan/thunder", "--run-id", "99", "--dry-run", "false",
      "--force", "false", "--daily-limit", "", "--token-budget", budget]);
  const { log, out } = targets("1,000,000");
  const summary = JSON.parse(out.summary);
  // 59,776 recorded by run 1, 450,000 for run 2 (Codex started, no usage recorded) and 100,000 recorded by run 5, which
  // was re-run within the window. Runs 3 and 6 never started Codex, run 4 skipped the agent, and run 7 is too old.
  assert.deepEqual([summary.targets, summary.agentRuns, summary.tokensUsed, summary.startedAt], [[HB1], 5, 609_776, data.runs.workflow_runs[0].run_started_at]);
  for (const id of [2, 3, 6]) assert.match(log, new RegExp(`::warning::Could not read the summary of run ${id}\\.`));
  assert.doesNotMatch(log, /summary of run (1|4|5|7)\./);
  const over = JSON.parse(targets("500000").out.summary);
  assert.deepEqual([over.targets, over.overBudget, over.notifyBudget], [[], true, false], "run 4 posted the budget message after the newest agent run");
  const earlier = data.runs.workflow_runs.filter((run) => run.id !== 5).map((run) => (run.id === 4 ? { ...run, created_at: ago(2.5) } : run));
  gh.setData({ ...data, runs: { workflow_runs: earlier } });
  const stale = JSON.parse(targets("400000").out.summary);
  assert.deepEqual([stale.overBudget, stale.notifyBudget], [true, true], "run 4's message came before run 1, the newest agent run");
  gh.setData({ ...data, runs: { workflow_runs: earlier }, summaries: { ...data.summaries, 1: { ...data.summaries[1], force: true } } });
  const forced = JSON.parse(targets("400000").out.summary);
  assert.equal(forced.notifyBudget, false, "run 1 was forced, so run 4's message still covers this stretch");
  assert.throws(() => targets("lots"), /SECURITY_FIX_DAILY_TOKEN_BUDGET must be a positive whole number/);
});
