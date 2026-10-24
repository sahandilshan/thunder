import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { classify, floor } from "./guard.mjs";
import { lintWorkspace, overrideTarget } from "./lint-overrides.mjs";
import {
  addUsage,
  agentPullRequest,
  applyLimits,
  auditCheck,
  budgetFreesAt,
  budgetMessage,
  chatText,
  changesDependencies,
  cleanTitle,
  decide,
  detailLines,
  compareUrl,
  jobFacts,
  lockedPullRequest,
  markerAdvisories,
  openPrNote,
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

test("new overrides need review; audit ignores and release-age exceptions are rejected", () => {
  const files = {
    "pnpm-workspace.yaml": {
      before: "overrides:\n  vue: 3.5.34\nauditConfig:\n  ignoreGhsas: []\n",
      after: "overrides:\n  vue: 3.5.42\n  '@docusaurus/core>tinypool': 2.1.2\nauditConfig:\n  ignoreGhsas: []\n",
    },
  };
  const result = classify(["pnpm-workspace.yaml"], reader(files));
  assert.equal(result.verdict, "review");
  assert.equal(result.reasons.length, 1);
  assert.deepEqual(result.changes, ["pnpm-workspace.yaml overrides: raises vue from 3.5.34 to 3.5.42"]);
  for (const after of ["auditConfig:\n  ignoreGhsas:\n    - GHSA-ch52-4w7c-c8xp\n", "auditConfig:\n  ignoreGhsas: []\nminimumReleaseAgeExclude:\n  - source-map-js@1.2.2\n"]) {
    const rejected = classify(["pnpm-workspace.yaml"], reader({ "pnpm-workspace.yaml": { before: "auditConfig:\n  ignoreGhsas: []\n", after } }));
    assert.equal(rejected.verdict, "reject", after);
    assert.ok(rejected.reasons.some((reason) => /are left to a maintainer/.test(reason)), after);
  }
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
    { action: "branch", status: "needs_review", reasons: ["Review the branch. If it adds an override, create the tracking issue the fix-npm-vulnerability skill asks for and add it as a `# Tracking:` line. Then open the pull request from the link.", "new override"] },
  );
  const failingAudit = { ...passing, audit: "fail" };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: auto, checks: failingAudit, patchSize: 10 }).status, "needs_review");
  const inconsistent = { ...passing, lockfile: "changed_by_pnpm_install" };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: auto, checks: inconsistent, patchSize: 10 }).status, "failed");
  const rejected = { verdict: "reject", changes: [], reasons: ["Dockerfile"] };
  assert.equal(decide({ summary, agentOutcome: "success", result: fixed, guard: rejected, checks: passing, patchSize: 10 }).action, "none");
});

test("a new fix goes into the agent's open pull request, unless it needs review or has other commits", () => {
  const auto = { verdict: "auto", changes: ["raise"], reasons: [] };
  const openPr = { number: 6034, url: "https://pr/6034", branch: "security-fix/ghsa-27r3-jxmh-p828-20261024-0308", sha: "466cbf1", advisories: [HB2], locked: false };
  const folded = { ...summary, targets: [HB2, HB1], openPr };
  assert.deepEqual(decide({ summary: folded, agentOutcome: "success", result: fixed, guard: auto, checks: passing, patchSize: 10 }), {
    action: "pr",
    status: "pr_updated",
    reasons: [`#6034 now fixes ${HB2}, ${HB1}.`],
    update: { number: 6034, branch: openPr.branch, sha: "466cbf1" },
  });
  const locked = decide({ summary: { ...folded, openPr: { ...openPr, locked: true } }, agentOutcome: "success", result: fixed, guard: auto, checks: passing, patchSize: 10 });
  assert.equal(locked.action, "branch");
  assert.equal(locked.status, "needs_review");
  assert.match(locked.reasons[0], /^#6034 has commits the agent did not make, so it was not updated\./);
  const theirs = { ...folded, openPr: { ...openPr, locked: true, lockReason: "was opened by @maintainer" } };
  assert.match(decide({ summary: theirs, agentOutcome: "success", result: fixed, guard: auto, checks: passing, patchSize: 10 }).reasons[0], /^#6034 was opened by @maintainer, so it was not updated\./);
  assert.deepEqual(decide({ summary: theirs, agentOutcome: "success", result: fixed, guard: auto, checks: passing, patchSize: 10, addsChange: false }),
    { action: "none", status: "marker_update", reasons: [`#6034 already fixes ${HB1}.`] }, "a branch would only repeat the locked pull request");
  const review = decide({ summary: folded, agentOutcome: "success", result: fixed, guard: { verdict: "review", changes: [], reasons: ["new override"] }, checks: passing, patchSize: 10 });
  assert.deepEqual([review.action, review.status, review.reasons[0], review.reasons.at(-1)], ["branch", "needs_review", "This branch contains the change from #6034, which was not updated. Push it to the branch of #6034, or close #6034 when you open it, so only one fix stays open.", "new override"]);
  assert.match(review.reasons[1], /^If it adds an override, create the tracking issue/);
  const many = decide({ summary: folded, agentOutcome: "success", result: fixed, guard: { verdict: "review", changes: [], reasons: Array.from({ length: 12 }, (_, i) => `change ${i}`) }, checks: passing, patchSize: 10 });
  assert.match(detailLines({ reasons: many.reasons, existing: [], tokens: null, seconds: 0 }), /^This branch contains the change from #6034/, "the steps survive when Chat cuts the reasons");
  const waiting = { ...fixed, status: "waiting_for_release", notes: "" };
  assert.deepEqual(decide({ summary: folded, agentOutcome: "success", result: waiting, guard: auto, checks: passing, patchSize: 10, addsChange: false }),
    { action: "none", status: "waiting_for_release", reasons: [] }, "a run that adds nothing to the open pull request changes nothing");
  assert.equal(decide({ summary: folded, agentOutcome: "success", result: fixed, guard: auto, checks: passing, patchSize: 10, addsChange: false }).status,
    "pr_updated", "the open pull request already fixes the new advisory: its description is updated to list it");
  assert.deepEqual(decide({ summary: folded, agentOutcome: "success", result: fixed, guard: auto, checks: { ...passing, audit: "fail" }, patchSize: 10, addsChange: false, audit: { remaining: [HB1], introduced: [] } }),
    { action: "none", status: "failed", reasons: [`pnpm audit still reports ${HB1}.`, "The agent changed nothing on top of #6034."] }, "a wrong fixed with no change pushes nothing");
});

test("the agent's own pull request is found by fork, branch, base and marker", () => {
  const pr = (number, extra = {}) => ({ number, marker: [HB1], user: "sahandilshan", headRepo: "sahandilshan/thunder", head: `security-fix/x-${number}`, base: "main", ...extra });
  const options = { repo: "sahandilshan/thunder", baseBranch: "main" };
  assert.equal(agentPullRequest([pr(1), pr(3), pr(2)], options).number, 3, "the newest one");
  assert.equal(agentPullRequest([pr(1, { user: "maintainer", association: "MEMBER" })], options).number, 1, "opened from a needs-review link by a maintainer");
  for (const other of [{ marker: null }, { user: "someone", association: "CONTRIBUTOR" }, { headRepo: "someone/thunderid" }, { head: "fix-zod" }, { base: "1.0.x" }]) {
    assert.equal(agentPullRequest([pr(1, other)], options), null, JSON.stringify(other));
  }
  assert.equal(markerAdvisories("no marker here"), null);
  assert.deepEqual(markerAdvisories("<!-- security-fix-agent: -->"), []);
  assert.equal(openPrNote({ number: "", advisories: "", applied: "" }), "");
  const me = "sahandilshan222@gmail.com";
  assert.equal(lockedPullRequest([[me, me]], "SahanDilshan222@gmail.com"), false);
  assert.equal(lockedPullRequest([[me, me], [me, me]], me), true, "two commits, even by the agent's identity");
  assert.equal(lockedPullRequest([[me, "maintainer@example.com"]], me), true, "amended by someone else");
  assert.equal(lockedPullRequest([], me), true);
});

test("the agent is told how much of the open pull request's change applied", () => {
  const note = (applied) => openPrNote({ number: "6034", advisories: `${HB1},${HB2}`, applied });
  assert.match(note("all"), new RegExp(`^The working tree already contains the change from open pull request #6034 \\(it fixes ${HB1}, ${HB2}\\)\\. Keep that change`));
  assert.match(note("without-lockfile"), /Its `pnpm-lock\.yaml` part did not apply to this commit, so run `pnpm install --lockfile-only` first\./);
  assert.match(note("none"), /^Applying the change from open pull request #6034 .* failed, so the working tree is clean\. Fix every advisory above\./);
  for (const applied of ["all", "without-lockfile", "none"]) assert.match(note(applied), /Your change replaces that pull request's change/);
});

test("a branch for review links to a pull request on upstream that carries the marker", () => {
  const url = new URL(compareUrl({ repo: "sahandilshan/thunder", branch: "security-fix/x", baseBranch: "main", title: "Raise zod", runUrl: "https://run/1", targets: [HB1, HB2] }));
  assert.equal(url.origin + url.pathname, "https://github.com/thunder-id/thunderid/compare/main...sahandilshan:security-fix/x");
  assert.equal(url.searchParams.get("title"), "Raise zod");
  assert.deepEqual(markerAdvisories(url.searchParams.get("body")), [HB1, HB2]);
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
  const body = renderBody({ result: fixed, guard: { changes: ["raises a"], reasons: [] }, runUrl: "https://run", targets: [HB1] });
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
  assert.deepEqual(decision.reasons.slice(1), ['overrides "a" pins every version of a.']);
  assert.match(decision.reasons[0], /^Review the branch\. If it adds an override/);
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
  assert.deepEqual(reasons.slice(1), [`The change adds ${NEW}.`]);
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
    targets: [HB1, HB2],
  });
  assert.match(body, new RegExp(`no longer reports ${HB1}, ${HB2}, and the change adds no new`));
  assert.match(body, new RegExp(`${VITE} is still reported on the base commit and not fixed by this pull request`));
  assert.ok(body.endsWith(`<!-- security-fix-agent: ${HB1},${HB2} -->\n`));
  assert.deepEqual(markerAdvisories(body), [HB1, HB2], "the advisory handled elsewhere is named in the text but not in the marker");
});

test("the PR body mentions overrides only when the fix touched one", () => {
  const plain = renderBody({ result: fixed, guard: { changes: ["raises a"], reasons: [] }, runUrl: "u", lint: { touched: [], problems: [] }, targets: [HB1] });
  assert.ok(!plain.includes("Every touched override"));
  assert.ok(plain.includes("still names a replaced version"));
  const overrides = renderBody({ result: fixed, guard: { changes: ["raises a"], reasons: [] }, runUrl: "u", lint: { touched: ["a@<1.2.3"], problems: [] }, targets: [HB1] });
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

/** The workflow as JSON; Ruby's YAML parser stands in for the one GitHub uses. */
const workflowYaml = () =>
  JSON.parse(
    execFileSync("ruby", ["-ryaml", "-rjson", "-e", "puts JSON.generate(YAML.safe_load(File.read(ARGV[0]), aliases: false))", join(here, "..", "workflows", "security-fix-agent.yml")], {
      encoding: "utf8",
    }),
  );

test("the workflow keeps the names and titles the run limits depend on", () => {
  const workflow = workflowYaml();
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
  assert.equal(workflow.jobs.check.outputs.open_pr, "${{ steps.targets.outputs.open_pr }}");
  assert.match(step("check", "Validate inputs").run, /\[\[ "\$DRY_RUN" == true \|\| "\$REF" == "\$BASE_BRANCH" \]\]/, "live runs fix the base branch itself");
  const start = step("agent", "Start from the open pull request's change");
  assert.equal(start.if, "needs.check.outputs.open_pr != ''");
  const steps = workflow.jobs.agent.steps.map((s) => s.name);
  assert.ok(steps.indexOf("Start from the open pull request's change") < steps.indexOf("Prepare the Codex configuration and prompt"), "the prompt needs the apply result");
  const open = step("publish", "Open or update the pull request on upstream");
  assert.doesNotMatch(open.run, /--draft/, "pull requests open ready for review");
  assert.doesNotMatch(open.run, /gh pr edit/, "gh pr edit needs read:org, which the PR token does not have");
  assert.match(open.run, /gh api -X PATCH "repos\/\$UPSTREAM\/pulls\/\$PR_NUMBER" --input -/);
  assert.match(step("publish", "Commit and push the branch").run, /--force-with-lease="refs\/heads\/\$BRANCH:\$LEASE"/);
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
const pull = path.match(/pulls\\/(\\d+)\\/(files|commits)/);
const body = path.includes("/pulls?") ? data.pulls ?? [] : pull ? data[pull[2]][pull[1]] : jobs ? data.jobs[jobs[1]] : path.includes("/workflows/") ? data.runs : null;
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

test("the prompt says which open pull request the working tree starts from", () => {
  const dir = mkdtempSync(join(tmpdir(), "prompt-"));
  writeFileSync(join(dir, "prompt.md"), "Fix: {{ADVISORIES}}\n\n{{OPEN_PR}}\nEnd");
  const sha = "7879bc593".padEnd(40, "0");
  const render = (extra) => {
    cli(["prompt", "--template", join(dir, "prompt.md"), "--out", join(dir, "out.md"), "--advisories", `${HB1},${HB2}`, "--context", "/c", "--tools", "/t", "--sha", sha, ...extra]);
    return readFileSync(join(dir, "out.md"), "utf8");
  };
  assert.equal(render([]), `Fix: ${HB1}, ${HB2}\n\n\nEnd`);
  assert.match(render(["--open-pr", "6034", "--open-pr-advisories", HB1, "--open-pr-applied", "all"]), new RegExp(`already contains the change from open pull request #6034 \\(it fixes ${HB1}\\)\\.`));
  // The real template has the placeholder.
  assert.match(readFileSync(join(here, "prompt.md"), "utf8"), /^\{\{OPEN_PR\}\}$/m);
});

test("the targets command adds a new fix to the agent's open pull request", () => {
  const A = "GHSA-27r3-jxmh-p828", B = "GHSA-xjj6-f33q-929c", C = "GHSA-mrhx-c7xc-m3w5", D = "GHSA-dddd-dddd-dddd", E = "GHSA-eeee-eeee-eeee";
  const agentPr = {
    number: 6034,
    html_url: "https://github.com/thunder-id/thunderid/pull/6034",
    title: "Refresh body-parser and undici for two audit advisories",
    // The description names C as handled elsewhere; only the marker says what the pull request fixes.
    body: `${C} (zod) is still reported on main.\n\n<!-- security-fix-agent: ${A},${B} -->\n`,
    user: { login: "sahandilshan" },
    head: { ref: "security-fix/ghsa-27r3-jxmh-p828-20261024-0308", sha: "466cbf1fa76a08afd764cf12446400be189dfc1a", repo: { full_name: "sahandilshan/thunder" } },
    base: { ref: "main" },
  };
  const humanPr = { number: 7000, html_url: "https://github.com/thunder-id/thunderid/pull/7000", title: `Fix ${D}`, body: "", user: { login: "someone" }, head: { ref: "fix-d", sha: "1", repo: { full_name: "someone/thunderid" } }, base: { ref: "main" } };
  const data = {
    runs: { workflow_runs: [{ id: 99, created_at: new Date().toISOString(), display_title: `Security fix: ${C},${D},${E}`, html_url: "https://run/99" }] },
    jobs: {},
    summaries: {},
    pulls: [agentPr, humanPr],
    files: { 6034: [{ filename: "pnpm-lock.yaml" }], 7000: [{ filename: "pnpm-workspace.yaml" }] },
    commits: { 6034: [{ commit: { author: { email: "sahandilshan222@gmail.com" }, committer: { email: "sahandilshan222@gmail.com" } } }] },
  };
  const gh = fakeGh(data);
  const reported = [A, B, C, D, E].map((id, i) => [i, { severity: "high", github_advisory_id: id }]);
  writeFileSync(join(gh.dir, "audit.json"), JSON.stringify({ advisories: Object.fromEntries(reported) }));
  const targets = (ref = "main") =>
    gh.run(["targets", "--audit", join(gh.dir, "audit.json"), "--advisories", `${C},${D},${E}`, "--repo", "sahandilshan/thunder", "--run-id", "99",
      "--dry-run", "false", "--force", "false", "--daily-limit", "", "--token-budget", "", "--ref", ref, "--base-branch", "main", "--git-email", "SahanDilshan222@gmail.com"]).out;
  const out = targets();
  const summary = JSON.parse(out.summary);
  assert.deepEqual(summary.targets, [A, B, C, E], "the open pull request's advisories, then the new ones");
  assert.deepEqual(summary.existing, [{ id: D, urls: [humanPr.html_url] }]);
  assert.deepEqual(summary.openPr, { number: 6034, url: agentPr.html_url, branch: agentPr.head.ref, sha: agentPr.head.sha, advisories: [A, B], locked: false, lockReason: null });
  assert.deepEqual([out.open_pr, out.open_pr_advisories, out.open_pr_sha, out.proceed], ["6034", `${A},${B}`, agentPr.head.sha, "true"]);
  const old = targets("f00b0ef6e1b2e7182f75e276352a8f2115ed1510");
  assert.deepEqual([JSON.parse(old.summary).targets, old.open_pr], [[C, E], ""], "a run of an older commit leaves the open pull request alone");
  gh.setData({ ...data, commits: { 6034: [...data.commits[6034], { commit: { author: { email: "maintainer@example.com" }, committer: { email: "maintainer@example.com" } } }] } });
  assert.equal(JSON.parse(targets().summary).openPr.locked, true, "a commit by someone else locks it");
  gh.setData({ ...data, pulls: [{ ...agentPr, user: { login: "maintainer" }, author_association: "MEMBER" }, humanPr] });
  assert.deepEqual(JSON.parse(targets().summary).openPr.lockReason, "was opened by @maintainer", "a maintainer's pull request from the agent's branch is theirs to update");
  gh.setData({ ...data, pulls: [humanPr] });
  const alone = JSON.parse(targets().summary);
  assert.deepEqual([alone.targets, alone.openPr], [[C, E], undefined]);
});

test("the agent job starts from the open pull request's change, whatever main did since", () => {
  const steps = workflowYaml().jobs.agent.steps;
  const script = (name) => steps.find((step) => step.name === name).run;
  const dir = mkdtempSync(join(tmpdir(), "open-pr-step-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
  };
  const git = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", env }).trim();
  const lines = (n, change = {}) => Array.from({ length: n }, (_, i) => change[i] ?? `line ${i}`).join("\n") + "\n";
  // origin has main and refs/pull/7/head, like upstream; the step fetches both from it.
  const setup = (name, { pr, main }) => {
    const origin = join(dir, name, "origin");
    mkdirSync(origin, { recursive: true });
    git(origin, "init", "-q", "-b", "main");
    const write = (files) => {
      for (const [file, text] of Object.entries(files)) writeFileSync(join(origin, file), text);
      git(origin, "add", "-A");
      git(origin, "commit", "-q", "-m", "change");
    };
    write({ "package.json": lines(20), "pnpm-lock.yaml": lines(40), "README.md": "readme\n" });
    git(origin, "checkout", "-q", "-b", "pr");
    write(pr);
    git(origin, "update-ref", "refs/pull/7/head", "HEAD");
    git(origin, "checkout", "-q", "main");
    write(main);
    const repo = join(dir, name, "repo");
    git(join(dir, name), "clone", "-q", origin, repo);
    return { repo, prSha: git(origin, "rev-parse", "refs/pull/7/head") };
  };
  const runStep = (name, { prSha }, extra = {}) => {
    const out = join(dir, name, "out");
    writeFileSync(out, "");
    const result = spawnSync("bash", ["-e", "-c", script("Start from the open pull request's change")], {
      cwd: join(dir, name),
      encoding: "utf8",
      env: { ...env, OPEN_PR: "7", OPEN_PR_SHA: prSha, BASE_BRANCH: "main", RUNNER_TEMP: join(dir, name), GITHUB_OUTPUT: out, ...extra },
    });
    return { status: result.status, log: result.stdout + result.stderr, applied: readFileSync(out, "utf8").match(/^applied=(\S+)$/m)?.[1] };
  };

  // The pull request's branch is behind main, which changed another file since.
  const behind = setup("behind", { pr: { "pnpm-lock.yaml": lines(40, { 5: "lock fix" }), "package.json": lines(20, { 3: "dep fix" }) }, main: { "README.md": "newer readme\n" } });
  assert.equal(runStep("behind", behind).applied, "all");
  assert.equal(git(behind.repo, "diff", "--name-only"), "package.json\npnpm-lock.yaml", "only the pull request's own change, not main's README");

  const lockConflict = setup("lock", { pr: { "pnpm-lock.yaml": lines(40, { 5: "lock fix" }), "package.json": lines(20, { 3: "dep fix" }) }, main: { "pnpm-lock.yaml": lines(40, { 5: "main moved" }) } });
  assert.equal(runStep("lock", lockConflict).applied, "without-lockfile");
  assert.equal(git(lockConflict.repo, "diff", "--name-only"), "package.json");

  const lockOnly = setup("lockonly", { pr: { "pnpm-lock.yaml": lines(40, { 5: "lock fix" }) }, main: { "pnpm-lock.yaml": lines(40, { 5: "main moved" }) } });
  assert.equal(runStep("lockonly", lockOnly).applied, "none");
  assert.equal(git(lockOnly.repo, "status", "--porcelain"), "", "nothing applied, so the tree stays clean");

  const moved = setup("moved", { pr: { "package.json": lines(20, { 3: "dep fix" }) }, main: { "README.md": "newer\n" } });
  const stale = runStep("moved", { prSha: "0".repeat(40) });
  assert.notEqual(stale.status, 0);
  assert.match(stale.log, /::error::#7 changed since the check job read it/);
  assert.equal(git(moved.repo, "status", "--porcelain"), "", "it stops before applying anything");

  // The save step tells whether the agent added anything to the pull request's change.
  const save = (name) => {
    const out = join(dir, name, "out");
    writeFileSync(out, "");
    execFileSync("bash", ["-e", "-c", script("Save the agent's changes")], { cwd: join(dir, name), env: { ...env, RUNNER_TEMP: join(dir, name), GITHUB_OUTPUT: out } });
    return readFileSync(out, "utf8").match(/^changed=(\S+)$/m)?.[1];
  };
  assert.equal(save("behind"), "false");
  writeFileSync(join(behind.repo, "pnpm-workspace.yaml"), "overrides: {}\n");
  assert.equal(save("behind"), "true");
  assert.ok(readFileSync(join(dir, "behind", "security-fix.patch"), "utf8").includes("dep fix"), "the patch keeps the pull request's change");
});

test("Chat messages that need someone to act mention everyone in the space", () => {
  const mention = ["pr_open", "pr_updated", "needs_review", "marker_update", "waiting_for_release", "failed"];
  // Nothing to act on, or reported elsewhere: the monitor mentions everyone about the advisory itself.
  const quiet = ["pr_exists", "not_reported", "cooldown", "daily_limit", "token_budget", "token_budget_reached"];
  for (const status of mention) assert.match(chatText({ status, advisories: HB1 }), new RegExp(`^<users/all> ThunderID security fix agent: ${HB1}\n`), status);
  for (const status of quiet) assert.match(chatText({ status, advisories: HB1 }), /^ThunderID security fix agent:/, status);
  const statuses = readFileSync(join(here, "publish.mjs"), "utf8").match(/const STATUS_TEXT = \{([\s\S]*?)\n\};/)[1].match(/^  (\w+):/gm).map((key) => key.trim().slice(0, -1));
  assert.deepEqual([...statuses].sort(), [...mention, ...quiet].sort(), "every outcome is placed on purpose");
  assert.equal(chatText({ status: "pr_open", advisories: HB1, url: "https://pr/1", detail: "Agent: 1 tokens." }),
    `<users/all> ThunderID security fix agent: ${HB1}\nOpened a pull request. Review it before it is merged.\nhttps://pr/1\n\nAgent: 1 tokens.`);
});

test("the prompt asks for the complete fix the skill describes, even when it needs a maintainer", () => {
  const prompt = readFileSync(join(here, "prompt.md"), "utf8");
  assert.match(prompt, /Prepare the complete change the skill describes anyway/);
  assert.match(prompt, /Do not stop at a partial fix\./);
  assert.match(prompt, /is a compatibility risk to explain in `notes`, not a reason to stop/);
  assert.match(prompt, /A fix that exists only in a newer major version falls under rule 5/);
  assert.match(prompt, /only when `status` is `waiting_for_release`, or when pnpm cannot resolve the complete change/);
  assert.doesNotMatch(prompt, /`needs_review` with `notes` saying what blocks/);
  assert.match(prompt, /Never add `auditConfig\.ignoreGhsas` or `minimumReleaseAgeExclude` entries/);
});
