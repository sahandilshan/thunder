import test from "node:test";
import assert from "node:assert/strict";
import {
  advisoryIds,
  auditFailures,
  github,
  parseAudit,
  planNotifications,
  sendChat,
} from "./monitor.mjs";

const finding = {
  id: "GHSA-aaaa-bbbb-cccc",
  package: "example",
  severity: "high",
  title: "Example vulnerability",
  patched: ">=2.0.1",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
};
const report = (overrides) => ({
  scannedAt: "2026-10-07T06:00:00Z",
  sha: "abc",
  main: [],
  failures: [],
  errors: [],
  ...overrides,
});

test("parses high and critical advisories, excluding ignored and lower severity findings", () => {
  const advisory = {
    module_name: "example",
    severity: "high",
    title: finding.title,
    patched_versions: ">=2.0.1",
    url: finding.url,
  };
  assert.deepEqual(
    parseAudit(
      {
        advisories: {
          1: advisory,
          2: { ...advisory, severity: "moderate" },
          3: { ...advisory, ignored: true },
        },
        metadata: {},
      },
      1,
    ),
    [finding],
  );
  assert.equal(
    parseAudit(
      {
        advisories: {
          1: { ...advisory, severity: "critical", patched_versions: null },
        },
        metadata: {},
      },
      1,
    )[0].patched,
    null,
  );
});

test("registry errors, malformed schemas, process failures never count as clean", () => {
  for (const [data, status] of [
    [{ error: { code: "ERR_REGISTRY" } }, 1],
    [{}, 0],
    [{ advisories: {}, metadata: {} }, null],
    [{ advisories: {}, metadata: {} }, 1],
    [{ advisories: { 1: { severity: "high" } }, metadata: {} }, 1],
  ]) {
    assert.throws(() => parseAudit(data, status));
  }
  // pnpm 11 includes ignored findings in metadata even when advisories is empty.
  assert.deepEqual(
    parseAudit(
      { advisories: {}, metadata: { vulnerabilities: { high: 5 } } },
      0,
    ),
    [],
  );
});

test("only a failed audit step identifies an audit failure", () => {
  const jobs = [
    { id: 1, steps: [{ name: "🔍 Run pnpm audit", conclusion: "failure" }] },
    {
      id: 2,
      steps: [
        { name: "🔍 Run pnpm audit", conclusion: "success" },
        { name: "Build", conclusion: "failure" },
      ],
    },
    { id: 3, steps: [{ name: "Run pnpm audit", conclusion: "skipped" }] },
  ];
  assert.deepEqual(
    auditFailures(jobs).map((j) => j.id),
    [1],
  );
  assert.deepEqual(
    advisoryIds(`${finding.url}\n${finding.url}\nignore this text`),
    [finding.id],
  );
});

test("unchanged findings and multiple failed PRs do not produce repeated alerts", () => {
  const first = report({
    main: [finding],
    failures: [{ jobId: 1, ids: [finding.id] }],
  });
  const result = planNotifications(first);
  assert.equal(result.messages.length, 1);
  const second = planNotifications(
    { ...first, failures: [{ jobId: 2, ids: [finding.id] }] },
    result.state,
  );
  assert.equal(second.messages.length, 0);
  assert.equal(
    planNotifications(
      report({ main: [{ ...finding, patched: ">=2.0.2" }] }),
      result.state,
    ).messages.length,
    1,
  );
});

test("CI-only finding is notified once, missing logs retain a job link", () => {
  const input = report({
    failures: [
      { jobId: 1, ids: [finding.id], url: "https://github.com/example/job/1" },
      { jobId: 2, ids: [finding.id] },
      { jobId: 3, ids: [], url: "https://github.com/example/job/3" },
    ],
  });
  const first = planNotifications(input);
  assert.equal(first.messages.length, 2);
  assert.match(first.messages[1], /job\/3/);
  assert.equal(planNotifications(input, first.state).messages.length, 0);
});

test("failed scans preserve findings; recovery and disappearing findings are explicit", () => {
  const initial = planNotifications(report({ main: [finding] })).state;
  const failed = planNotifications(
    report({ main: null, errors: ["registry down"] }),
    initial,
  );
  assert.deepEqual(failed.state.main, initial.main);
  assert.match(failed.messages[0], /not a clean scan/);
  assert.equal(
    planNotifications(
      report({ main: null, errors: ["registry down"] }),
      failed.state,
    ).messages.length,
    0,
  );
  const recovered = planNotifications(report(), failed.state);
  assert.equal(recovered.messages.length, 2);
  assert.match(recovered.messages[0], /upstream ignore change/);
  assert.match(recovered.messages[1], /recovered/);
});

test("expired historical alert keys are pruned without changing the input state", () => {
  const original = { seen: { old: "2026-01-01T00:00:00Z" } };
  const result = planNotifications(report(), original);
  assert.deepEqual(result.state.seen, {});
  assert.ok(original.seen.old);
});

test("webhook failure is surfaced without exposing its URL", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 429 });
  try {
    await assert.rejects(
      sendChat(
        "https://chat.googleapis.com/v1/spaces/example/messages?token=secret",
        "test",
      ),
      { message: "Google Chat delivery failed: HTTP 429" },
    );
    await assert.rejects(
      sendChat("https://example.com?token=secret", "test"),
      /Expected a Google Chat/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHub permission and rate-limit errors do not become empty results", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of [403, 429, 500]) {
      globalThis.fetch = async () => ({ ok: false, status });
      await assert.rejects(
        github("repos/example/test", { allow404: true }),
        new RegExp(`HTTP ${status}`),
      );
    }
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.equal(await github("repos/example/test", { allow404: true }), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scanner downloads only pinned data, inspects audit failures, and preserves partial results", async () => {
  const { scan } = await import("./monitor.mjs");
  const originalFetch = globalThis.fetch;
  const originalRepository = process.env.GITHUB_REPOSITORY;
  delete process.env.GITHUB_REPOSITORY;
  const paths = [];
  let logFails = false;
  globalThis.fetch = async (url) => {
    const path = String(url);
    paths.push(path);
    let data;
    if (path.endsWith("/commits/main")) data = { sha: "abc" };
    else if (path.includes("/contents/package.json?ref=abc"))
      data = JSON.stringify({
        devEngines: { packageManager: { version: "11.21.0" } },
      });
    else if (path.includes("/contents/")) data = "data file";
    else if (path.includes("/workflows/"))
      data = {
        workflow_runs: [
          {
            id: 1,
            run_attempt: 2,
            head_sha: "def",
            head_branch: "feature",
            updated_at: "now",
          },
        ],
      };
    else if (path.includes("/attempts/2/jobs"))
      data = {
        jobs: [
          {
            id: 3,
            html_url: "https://github.com/job/3",
            steps: [{ name: "Run pnpm audit", conclusion: "failure" }],
          },
        ],
      };
    else if (path.endsWith("/jobs/3/logs")) {
      if (logFails) return { ok: false, status: 403 };
      data = finding.url;
    } else throw new Error(`Unexpected request: ${path}`);
    return { ok: true, json: async () => data, text: async () => data };
  };
  const run = (_command, args, options) => {
    if (args[0] === "--version") return { status: 0, stdout: "11.21.0\n" };
    assert.deepEqual(args, ["audit", "--json", "--audit-level=high"]);
    assert.ok(!("GITHUB_TOKEN" in options.env));
    return {
      status: 0,
      stdout: JSON.stringify({ advisories: {}, metadata: {} }),
    };
  };
  try {
    const result = await scan({ token: "test", run });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.main, []);
    assert.equal(result.failures[0].ids[0], finding.id);
    assert.equal(paths.filter((path) => path.includes("/contents/")).length, 3);
    logFails = true;
    const partial = await scan({ token: "test", run });
    assert.equal(partial.errors.length, 1);
    assert.equal(partial.failures.length, 1);
    assert.deepEqual(partial.runCache, {});
    const mismatch = await scan({
      token: "test",
      run: () => ({ status: 0, stdout: "12.0.0" }),
    });
    assert.equal(mismatch.main, null);
    assert.match(mismatch.errors[0], /version must match/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalRepository === undefined) delete process.env.GITHUB_REPOSITORY;
    else process.env.GITHUB_REPOSITORY = originalRepository;
  }
});

test("durable state initializes an isolated branch and updates using optimistic concurrency", async () => {
  const { loadState, saveState } = await import("./monitor.mjs");
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({
      url: String(url),
      body: options.body ? JSON.parse(options.body) : null,
    });
    return { ok: true, json: async () => ({ sha: "result" }) };
  };
  try {
    await saveState("owner/repo", "token", { version: 1 }, null);
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[1].body.parents, []);
    assert.equal(calls[2].body.ref, "refs/heads/security-monitor-state");
    calls.length = 0;
    await saveState("owner/repo", "token", { version: 1 }, "old-sha");
    assert.equal(calls[0].body.sha, "old-sha");
    assert.equal(calls[0].body.branch, "security-monitor-state");
    globalThis.fetch = async () => ({ ok: false, status: 404 });
    assert.deepEqual(await loadState("owner/repo", "token"), {
      state: {},
      sha: null,
    });
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes("/git/ref/")
          ? {}
          : {
              sha: "file-sha",
              content: Buffer.from('{"version":1}').toString("base64"),
            },
    });
    assert.deepEqual(await loadState("owner/repo", "token"), {
      state: { version: 1 },
      sha: "file-sha",
    });
    globalThis.fetch = async (url) => ({
      ok: true,
      json: async () =>
        String(url).includes("/git/ref/")
          ? {}
          : { content: Buffer.from('{"version":99}').toString("base64") },
    });
    await assert.rejects(loadState("owner/repo", "token"), /Unsupported/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
