import assert from "node:assert/strict";
import test from "node:test";

import { classify, floor } from "./guard.mjs";
import { lintWorkspace, overrideTarget } from "./lint-overrides.mjs";
import { auditCheck, changesDependencies, cleanTitle, decide, parseAdvisories, renderBody, reportedAdvisories } from "./publish.mjs";

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
