// Deterministic helpers for the security fix workflow. Nothing here talks to the AI model.
//
//   targets  which requested advisories the audit still reports and which already have an open PR
//   prompt   renders the agent prompt
//   decide   combines the agent result, guard verdict and checks into the next action
//   notify   posts the outcome to Google Chat
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const UPSTREAM = "thunder-id/thunderid";
export const GHSA = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;

const STATUS_TEXT = {
  pr_open: "Opened a draft pull request. Review it, then mark it ready and add the trigger-pr-builder label.",
  needs_review: "Prepared a change that needs a maintainer decision. It was pushed as a branch, not opened as a pull request.",
  waiting_for_release: "No usable fixed release yet: none is published, or it is too new for pnpm's release-age rule. Nothing was changed.",
  not_reported: "Upstream main no longer reports this advisory. Nothing to fix.",
  pr_exists: "An open upstream pull request already mentions this advisory. Nothing was changed.",
  failed: "The fix did not pass the checks. Inspect the workflow run.",
};

export function parseAdvisories(text) {
  const ids = String(text ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of ids) if (!GHSA.test(id)) throw new Error(`Invalid advisory ID: ${id}`);
  return [...new Set(ids)];
}

export function reportedAdvisories(audit) {
  return new Set(
    Object.values(audit.advisories ?? {})
      .filter((advisory) => ["high", "critical"].includes(advisory.severity))
      .map((advisory) => String(advisory.github_advisory_id ?? "").toLowerCase().replace(/^ghsa/, "GHSA")),
  );
}

/**
 * The fix passes the audit when the targeted advisories are gone and it adds none. Advisories that were
 * already reported and are handled elsewhere (for example by another open PR) may remain.
 */
export function auditCheck(before, after, targets) {
  const was = reportedAdvisories(before);
  const now = reportedAdvisories(after);
  const remaining = targets.filter((id) => now.has(id));
  const introduced = [...now].filter((id) => !was.has(id)).sort();
  const unrelated = [...now].filter((id) => was.has(id) && !targets.includes(id)).sort();
  return { pass: !remaining.length && !introduced.length, fixed: targets.filter((id) => !now.has(id)), remaining, introduced, unrelated };
}

export function cleanTitle(title, ids) {
  const text = String(title ?? "")
    .split("\n")[0]
    .replace(/^\s*(fix|chore|feat|deps|build|security)(\([^)]*\))?!?:\s*/i, "")
    .replace(/[–—]/g, "-")
    .trim();
  if (text && text.length <= 72) return text;
  return ids.length === 1 ? `Fix the ${ids[0]} audit advisory` : `Fix ${ids.length} pnpm audit advisories`;
}

export function renderBody({ result, guard, runUrl, audit, lint }) {
  const changes = guard.changes.length ? guard.changes.map((change) => `  - ${change}`).join("\n") : "  - None";
  const unrelated = audit?.unrelated?.length
    ? `\n\n${audit.unrelated.join(", ")} ${audit.unrelated.length === 1 ? "is" : "are"} still reported on the base commit and handled separately, so the PR Builder audit keeps failing until ${audit.unrelated.length === 1 ? "it is" : "they are"} fixed.`
    : "";
  return `### Purpose
${result.purpose.trim()}

### Approach
${result.approach.trim()}

### Validation
${result.validation.trim()}

Checked again in a separate job that has no access to the AI model:
- \`pnpm audit --ignore-registry-errors --audit-level=high\` no longer reports ${audit?.fixed?.join(", ") || "the targeted advisories"}, and the change adds no new high or critical advisory.
- \`pnpm install --lockfile-only\` leaves \`pnpm-lock.yaml\` unchanged.
${lint?.touched?.length ? "- Every touched override is range-qualified or parent-scoped and has a complete justification with verified advisory IDs.\n" : ""}- No comment in \`pnpm-workspace.yaml\` still names a replaced version.
- Only dependency files changed, and every change raises an existing version within its major version:
${changes}${unrelated}
${result.notes.trim() ? `\n### Notes for reviewers\n${result.notes.trim()}\n` : ""}
### Related Issues
- N/A

### Related PRs
- N/A

### Checklist
- [ ] Followed the contribution guidelines.
- [ ] Manual test round performed and verified.
- [ ] Documentation provided. (Add links if there are any)
    - [ ] Ran Vale and fixed all errors and warnings
- [ ] Tests provided. (Add links if there are any)
    - [ ] Unit Tests
    - [ ] Integration Tests
- [ ] Breaking changes. (Fill if applicable)
    - [ ] Breaking changes section filled.
    - [ ] \`breaking change\` label added.

### Security checks
- [ ] Followed secure coding standards in [WSO2 Secure Coding Guidelines](https://security.docs.wso2.com/en/latest/security-guidelines/secure-engineering-guidelines/secure-coding-guidlines/introduction/)
- [ ] Confirmed that this PR doesn't commit any keys, passwords, tokens, usernames, or other secrets.

Opened as a draft by the ThunderID security fix agent ([workflow run](${runUrl})). A maintainer must review it before it is marked ready.
`;
}

/**
 * Chooses the outcome. action is "pr" (push a branch and open a draft PR), "branch" (push a branch
 * for a maintainer to review) or "none".
 */
export function decide({ summary, agentOutcome, result, guard, checks, patchSize, lint, audit }) {
  if (!summary.targets.length) {
    return { action: "none", status: summary.existing.length ? "pr_exists" : "not_reported", reasons: [] };
  }
  if (agentOutcome !== "success" || !result) {
    return { action: "none", status: "failed", reasons: [`The agent job ended with ${agentOutcome}.`] };
  }
  if (!patchSize) {
    const status = ["waiting_for_release", "needs_review", "not_reported"].includes(result.status) ? result.status : "failed";
    return { action: "none", status, reasons: result.notes ? [result.notes] : [] };
  }
  const reasons = [...guard.reasons];
  if (guard.verdict === "reject") return { action: "none", status: "failed", reasons };
  if (checks.apply !== "ok") return { action: "none", status: "failed", reasons: [...reasons, "The patch did not apply to a clean checkout."] };
  if (checks.lockfile !== "consistent") {
    return { action: "none", status: "failed", reasons: [...reasons, `pnpm-lock.yaml is not consistent (${checks.lockfile}).`] };
  }
  if (checks.audit !== "pass") {
    if (audit?.remaining?.length) reasons.push(`pnpm audit still reports ${audit.remaining.join(", ")}.`);
    if (audit?.introduced?.length) reasons.push(`The change adds ${audit.introduced.join(", ")}.`);
    if (!audit) reasons.push("The audit after the change could not run.");
  }
  if (checks.lint !== "pass") reasons.push(...(lint?.problems?.length ? lint.problems : ["The override conventions check did not run."]));
  if (result.status !== "fixed") reasons.push(`The agent reported ${result.status}.`);
  if (guard.verdict === "auto" && checks.audit === "pass" && checks.lint === "pass" && result.status === "fixed") {
    return { action: "pr", status: "pr_open", reasons };
  }
  return { action: "branch", status: "needs_review", reasons };
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith("--")) throw new Error(`Unexpected argument ${argv[i]}`);
    out[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

function output(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return console.log(`${name}=${value}`);
  const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function readJson(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function changesDependencies(files) {
  return files.some((file) => /(^|\/)(pnpm-lock\.yaml|pnpm-workspace\.yaml|package\.json)$/.test(file));
}

/**
 * Open upstream PRs whose title or description names the advisory and that change dependency files.
 * The pulls API is read directly because the search index can lag behind a newly opened PR.
 */
function openFixPullRequests(ids) {
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const open = gh([
    "api",
    "--paginate",
    `repos/${UPSTREAM}/pulls?state=open&per_page=100`,
    "--jq",
    '.[] | {number, html_url, text: ((.title // "") + "\\n" + (.body // ""))}',
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const files = {};
  const fixes = (pr) => {
    // A PR that only quotes the advisory, for example a feature PR blocked by the audit, is not a fix.
    files[pr.number] ??= gh(["api", "--paginate", `repos/${UPSTREAM}/pulls/${pr.number}/files?per_page=100`, "--jq", ".[].filename"]).split("\n");
    return changesDependencies(files[pr.number]);
  };
  return Object.fromEntries(
    ids.map((id) => [id, open.filter((pr) => pr.text.toLowerCase().includes(id.toLowerCase()) && fixes(pr)).map((pr) => pr.html_url)]),
  );
}

async function notify({ status, advisories, url, detail }) {
  const webhook = (process.env.GOOGLE_CHAT_SECURITY_WEBHOOK ?? "").trim();
  if (!/^https:\/\/chat\.googleapis\.com\/v1\/spaces\//.test(webhook)) {
    throw new Error("GOOGLE_CHAT_SECURITY_WEBHOOK secret is missing or not a Chat webhook");
  }
  let text = `ThunderID security fix agent: ${advisories}\n${STATUS_TEXT[status] ?? status}`;
  if (url) text += `\n${url}`;
  if (detail) text += `\n\n${detail}`;
  const response = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=UTF-8" },
    body: JSON.stringify({ text }),
    signal: AbortSignal.timeout(30000),
  });
  // Never print the webhook: it carries the Chat credential.
  if (!response.ok) throw new Error(`Google Chat delivery failed: HTTP ${response.status}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opts = args(rest);

  if (command === "targets") {
    const requested = parseAdvisories(opts.advisories);
    const audit = readJson(opts.audit);
    if (!audit) throw new Error("Audit report is missing or invalid");
    const reported = reportedAdvisories(audit);
    const summary = { requested, targets: [], missing: [], existing: [] };
    const openFixes = openFixPullRequests(requested.filter((id) => reported.has(id)));
    for (const id of requested) {
      if (!reported.has(id)) {
        summary.missing.push(id);
        continue;
      }
      const urls = openFixes[id];
      if (urls.length) summary.existing.push({ id, urls });
      else summary.targets.push(id);
    }
    console.log(JSON.stringify(summary, null, 2));
    output("proceed", String(summary.targets.length > 0));
    output("targets", summary.targets.join(","));
    output("summary", JSON.stringify(summary));
    return;
  }

  if (command === "prompt") {
    const ids = parseAdvisories(opts.advisories);
    if (!/^[0-9a-f]{40}$/.test(opts.sha)) throw new Error("Invalid commit SHA");
    const text = readFileSync(opts.template, "utf8")
      .replaceAll("{{ADVISORIES}}", ids.join(", "))
      .replaceAll("{{CONTEXT_DIR}}", opts.context)
      .replaceAll("{{TOOLS_DIR}}", opts.tools)
      .replaceAll("{{BASE_SHA}}", opts.sha);
    writeFileSync(opts.out, text);
    return;
  }

  if (command === "decide") {
    const summary = JSON.parse(opts.summary);
    const result = readJson(opts.result);
    const guard = readJson(opts.guard) ?? { verdict: "none", changes: [], reasons: [] };
    const checks = readJson(opts.checks) ?? {};
    const patchSize = opts.patch && existsSync(opts.patch) ? statSync(opts.patch).size : 0;
    const lint = readJson(opts.lint);
    const audit = readJson(opts["audit-check"]);
    const decision = decide({ summary, agentOutcome: opts["agent-outcome"], result, guard, checks, patchSize, lint, audit });
    const ids = summary.targets.length ? summary.targets : summary.requested;
    const title = cleanTitle(result?.title, ids);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
    const branch = `security-fix/${ids[0].toLowerCase()}-${stamp}`;
    if (result && decision.action !== "none") {
      writeFileSync(opts["body-out"], renderBody({ result, guard, runUrl: opts["run-url"], audit, lint }));
    }
    writeFileSync(opts["commit-out"], `${title}\n\nFix the pnpm audit advisories ${ids.join(", ")}.\n`);
    const existing = summary.existing.flatMap((entry) => entry.urls);
    const detail = [...decision.reasons, ...existing.map((url) => `Open PR: ${url}`)].slice(0, 12).join("\n");
    console.log(JSON.stringify({ ...decision, title, branch }, null, 2));
    output("action", decision.action);
    output("status", decision.status);
    output("title", title);
    output("branch", branch);
    output("advisories", ids.join(", "));
    output("detail", detail);
    return;
  }

  if (command === "audit-check") {
    const before = readJson(opts.before);
    const after = readJson(opts.after);
    if (!before || !after) throw new Error("Audit reports are missing or invalid");
    console.log(JSON.stringify(auditCheck(before, after, parseAdvisories(opts.targets)), null, 2));
    return;
  }

  if (command === "notify") {
    await notify({ status: opts.status, advisories: opts.advisories, url: opts.url, detail: opts.detail });
    return;
  }

  throw new Error("Usage: publish.mjs targets|prompt|decide|notify [--option value ...]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
