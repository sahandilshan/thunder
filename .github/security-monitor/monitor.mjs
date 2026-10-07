import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const UPSTREAM = "thunder-id/thunderid";
const STATE_BRANCH = "security-monitor-state";
const DAY = 86400000;

export async function github(
  path,
  { token, method = "GET", body, raw = false, allow404 = false } = {},
) {
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      response = await fetch(`https://api.github.com/${path}`, {
        method,
        headers: {
          Accept: raw
            ? "application/vnd.github.raw+json"
            : "application/vnd.github+json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          "X-GitHub-Api-Version": "2022-11-28",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(30000),
      });
    } catch (error) {
      if (method !== "GET" || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
      continue;
    }
    if (
      method !== "GET" ||
      response.ok ||
      response.status < 500 ||
      attempt === 2
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
  }
  if (allow404 && response.status === 404) return null;
  if (!response.ok)
    throw new Error(
      `GitHub ${method} ${path.split("?")[0]}: HTTP ${response.status}`,
    );
  return raw ? response.text() : response.json();
}

export function parseAudit(report, status) {
  if (
    report.error ||
    !report.advisories ||
    !report.metadata ||
    ![0, 1].includes(status)
  ) {
    throw new Error(
      `Audit did not produce a valid report (exit ${status}, ${report.error?.code ?? "unknown schema"})`,
    );
  }
  const findings = Object.values(report.advisories)
    .filter((a) => ["high", "critical"].includes(a.severity) && !a.ignored)
    .map((a) => {
      const id = a.url?.match(/GHSA-[a-z0-9-]+/i)?.[0];
      if (!id || !a.module_name)
        throw new Error("Audit advisory missing GHSA or package");
      return {
        id,
        package: a.module_name,
        severity: a.severity,
        title: a.title,
        patched: a.patched_versions ?? null,
        url: a.url,
      };
    });
  if (status === 1 && !findings.length)
    throw new Error("Audit failed without actionable advisory details");
  return findings;
}

export function auditFailures(jobs) {
  return jobs.filter((job) =>
    job.steps?.some(
      (step) =>
        step.conclusion === "failure" && /\bpnpm audit\b/i.test(step.name),
    ),
  );
}

export function advisoryIds(log) {
  return [
    ...new Set(log.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) ?? []),
  ].sort();
}

async function pages(path, field, token) {
  const items = [];
  for (let page = 1; page <= 10; page++) {
    const data = await github(
      `${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      { token },
    );
    if (!Array.isArray(data[field]))
      throw new Error(`Missing GitHub response field: ${field}`);
    items.push(...data[field]);
    if (data[field].length < 100) return items;
  }
  throw new Error(
    `Pagination limit reached for ${field}; narrow the scan interval`,
  );
}

export async function scan({
  token = process.env.UPSTREAM_READ_TOKEN || process.env.GITHUB_TOKEN,
  run = spawnSync,
} = {}) {
  const report = {
    scannedAt: new Date().toISOString(),
    upstream: UPSTREAM,
    main: null,
    failures: [],
    errors: [],
  };
  const directory = await mkdtemp(join(tmpdir(), "thunderid-audit-"));
  try {
    const commit = await github(`repos/${UPSTREAM}/commits/main`, { token });
    report.sha = commit.sha;
    // Only data files are downloaded. No upstream hooks, source or install scripts execute.
    for (const name of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]) {
      const contents = await github(
        `repos/${UPSTREAM}/contents/${name}?ref=${commit.sha}`,
        { token, raw: true },
      );
      await writeFile(join(directory, name), contents);
    }
    const manifest = JSON.parse(
      await readFile(join(directory, "package.json"), "utf8"),
    );
    const required = manifest.devEngines?.packageManager?.version;
    const installed = run("pnpm", ["--version"], {
      encoding: "utf8",
      timeout: 30000,
    });
    if (installed.status !== 0 || installed.stdout.trim() !== required) {
      throw new Error(
        `Scanner pnpm version must match upstream ${required}; update the workflow pin`,
      );
    }
    const env = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/TOKEN|SECRET|WEBHOOK/i.test(key),
      ),
    );
    const result = run("pnpm", ["audit", "--json", "--audit-level=high"], {
      cwd: directory,
      encoding: "utf8",
      env,
      timeout: 180000,
      maxBuffer: 20 * 1024 * 1024,
    });
    if (result.error)
      throw new Error(`Audit process failed: ${result.error.code}`);
    report.main = parseAudit(JSON.parse(result.stdout), result.status);
  } catch (error) {
    report.errors.push(`Main scan: ${error.message}`);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
  try {
    // Include older PR runs that were rerun recently. GitHub has no updated_at run filter.
    const since = new Date(Date.now() - 7 * DAY).toISOString();
    const previous = process.env.GITHUB_REPOSITORY
      ? ((
          await loadState(
            process.env.GITHUB_REPOSITORY,
            process.env.GITHUB_TOKEN,
          )
        ).state.runCache ?? {})
      : {};
    report.runCache = {};
    const runs = await pages(
      `repos/${UPSTREAM}/actions/workflows/pr-builder.yml/runs?status=failure&created=${encodeURIComponent(`>=${since}`)}`,
      "workflow_runs",
      token,
    );
    const inspect = async (run) => {
      try {
        const cacheKey = `${run.id}:${run.run_attempt}:${run.updated_at}`;
        if (previous[cacheKey]) {
          report.failures.push(...previous[cacheKey]);
          report.runCache[cacheKey] = previous[cacheKey];
          return;
        }
        let logsFailed = false;
        const failures = [];
        const jobs = await pages(
          `repos/${UPSTREAM}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs`,
          "jobs",
          token,
        );
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
            failure.ids = advisoryIds(
              await github(`repos/${UPSTREAM}/actions/jobs/${job.id}/logs`, {
                token,
                raw: true,
              }),
            );
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
    };
    for (let index = 0; index < runs.length; index += 4) {
      await Promise.all(runs.slice(index, index + 4).map(inspect));
    }
    report.failures.sort((a, b) => b.runId - a.runId || a.jobId - b.jobId);
  } catch (error) {
    report.errors.push(`Failed-job scan: ${error.message}`);
  }
  return report;
}

export function planNotifications(report, previous = {}) {
  const state = structuredClone(previous);
  state.version = 1;
  state.seen ??= {};
  state.main ??= {};
  const now = Date.parse(report.scannedAt);
  for (const [key, value] of Object.entries(state.seen)) {
    if (now - Date.parse(value) > 30 * DAY) delete state.seen[key];
  }
  const messages = [];
  if (report.main !== null) {
    const current = {};
    for (const finding of report.main) {
      const fingerprint = JSON.stringify([finding.severity, finding.patched]);
      current[finding.id] = fingerprint;
      if (state.main[finding.id] !== fingerprint) {
        messages.push(
          `Upstream main: ${finding.severity.toUpperCase()} ${finding.package}\n${finding.title}\n${finding.url}\nAdvisory patch range: ${finding.patched ?? "none reported"} (publication and compatibility not verified)\nCommit: https://github.com/${UPSTREAM}/commit/${report.sha}`,
        );
      }
      state.seen[`advisory:${finding.id}`] = report.scannedAt;
    }
    const resolved = Object.keys(state.main).filter((id) => !(id in current));
    if (resolved.length)
      messages.push(
        `No longer reported by upstream main's configured audit: ${resolved.join(", ")}. This can reflect a fix or an upstream ignore change.`,
      );
    state.main = current;
  }
  for (const failure of report.failures) {
    const keys = failure.ids.length
      ? failure.ids.map((id) => `advisory:${id}`)
      : [`job:${failure.jobId}`];
    if (keys.some((key) => !state.seen[key])) {
      messages.push(
        `Upstream CI: pnpm audit failed\nAdvisories: ${failure.ids.join(", ") || "not available; inspect job logs"}\nBranch: ${failure.branch}\n${failure.url}\nThis run may use dependencies that differ from current main.`,
      );
    }
    for (const key of keys) state.seen[key] = report.scannedAt;
  }
  const errors = [...report.errors].sort();
  if (
    errors.length &&
    JSON.stringify(errors) !== JSON.stringify(state.errors ?? [])
  ) {
    messages.push(
      `Security monitor could not complete all checks:\n${errors.join("\n")}\nThis is not a clean scan.`,
    );
  } else if (!errors.length && state.errors?.length) {
    messages.push(
      "Security monitor recovered: both main and failed-job checks completed.",
    );
  }
  state.errors = errors;
  state.lastScan = report.scannedAt;
  if (report.runCache) state.runCache = report.runCache;
  return { messages, state };
}

export async function loadState(repo, token) {
  const ref = await github(`repos/${repo}/git/ref/heads/${STATE_BRANCH}`, {
    token,
    allow404: true,
  });
  if (!ref) return { state: {}, sha: null };
  const file = await github(
    `repos/${repo}/contents/state.json?ref=${STATE_BRANCH}`,
    { token },
  );
  const state = JSON.parse(Buffer.from(file.content, "base64").toString());
  if (state.version !== 1)
    throw new Error("Unsupported notification state version");
  return { state, sha: file.sha };
}

export async function saveState(repo, token, state, sha) {
  const content = `${JSON.stringify(state, null, 2)}\n`;
  if (sha) {
    await github(`repos/${repo}/contents/state.json`, {
      token,
      method: "PUT",
      body: {
        message:
          "Update security monitor notification state\n\nSigned-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>",
        branch: STATE_BRANCH,
        sha,
        content: Buffer.from(content).toString("base64"),
      },
    });
    return;
  }
  const tree = await github(`repos/${repo}/git/trees`, {
    token,
    method: "POST",
    body: {
      tree: [{ path: "state.json", mode: "100644", type: "blob", content }],
    },
  });
  const commit = await github(`repos/${repo}/git/commits`, {
    token,
    method: "POST",
    body: {
      message:
        "Initialize security monitor notification state\n\nSigned-off-by: github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>",
      tree: tree.sha,
      parents: [],
    },
  });
  await github(`repos/${repo}/git/refs`, {
    token,
    method: "POST",
    body: {
      ref: `refs/heads/${STATE_BRANCH}`,
      sha: commit.sha,
    },
  });
}

export async function sendChat(webhook, text) {
  const url = new URL(webhook);
  if (
    url.origin !== "https://chat.googleapis.com" ||
    !url.pathname.startsWith("/v1/spaces/")
  ) {
    throw new Error("Expected a Google Chat incoming webhook URL");
  }
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok)
    throw new Error(`Google Chat delivery failed: HTTP ${response.status}`);
}

async function main() {
  const [command, file = "report.json"] = process.argv.slice(2);
  if (command === "scan") {
    const report = await scan();
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `Main findings: ${report.main?.length ?? "unknown"}; failed audit jobs: ${report.failures.length}; scan errors: ${report.errors.length}`,
    );
    return;
  }
  if (command !== "notify")
    throw new Error("Usage: monitor.mjs scan|notify [report.json]");
  const report = JSON.parse(await readFile(file, "utf8"));
  if (process.env.DRY_RUN === "true") {
    const { messages } = planNotifications(report);
    console.log(JSON.stringify({ dryRun: true, messages }, null, 2));
  } else {
    const repo = process.env.GITHUB_REPOSITORY;
    if (!repo || repo === UPSTREAM)
      throw new Error(
        "Notifications must run in the monitoring fork/repository",
      );
    if (!process.env.GOOGLE_CHAT_SECURITY_WEBHOOK)
      throw new Error("Missing GOOGLE_CHAT_SECURITY_WEBHOOK secret");
    const token = process.env.GITHUB_TOKEN;
    const previous = await loadState(repo, token);
    const { messages, state } = planNotifications(report, previous.state);
    for (const message of messages) {
      // Stable ID helps correlate the rare duplicate after delivery succeeds but saving state fails.
      const id = createHash("sha256")
        .update(message)
        .digest("hex")
        .slice(0, 12);
      await sendChat(
        process.env.GOOGLE_CHAT_SECURITY_WEBHOOK,
        `ThunderID security monitor [${id}]\n\n${message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
    await saveState(repo, token, state, previous.sha);
    console.log(`Delivered ${messages.length} notification(s)`);
  }
  if (report.errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    // Do not print fetch errors or URLs: they can contain webhook credentials.
    console.error(
      error instanceof TypeError
        ? "Monitor request or data validation failed"
        : error.message,
    );
    process.exitCode = 1;
  });
}
