// Deterministic helpers for the security fix workflow. Nothing here talks to the AI model.
//
//   targets  which requested advisories still need a fix: reported, without an open PR, within the run limits
//   prompt   renders the agent prompt
//   usage    reads the agent's token usage from its Codex session log
//   decide   combines the agent result, guard verdict and checks into the next action
//   budget   says whether this run reports that the daily token budget is used up
//   summary  writes the run summary that the Apps Script monitor records in its sheet
//   notify   posts the outcome to Google Chat
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const UPSTREAM = "thunder-id/thunderid";
export const GHSA = /^GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/;
const WORKFLOW = "security-fix-agent.yml";
const HOUR = 60 * 60 * 1000;
// An advisory requested by a run in which the agent ran is not retried within this time, in the same mode.
const COOLDOWN_MS = 20 * HOUR;
const LIMIT_WINDOW_MS = 24 * HOUR;
// Agent runs allowed in 24 hours. SECURITY_FIX_DAILY_LIMIT overrides it.
const DEFAULT_DAILY_LIMIT = 6;
// Tokens the agent may use in 24 hours, counted like Codex's "tokens used" (cached input excluded). Real fixes used
// 60,000 to 81,000; this allows six runs of twice the largest. SECURITY_FIX_DAILY_TOKEN_BUDGET overrides it.
const DEFAULT_TOKEN_BUDGET = 1_000_000;
// A run that started Codex but recorded no usage (for example, it hit the 15-minute time limit) counts as this
// much: 15 minutes at about 30,000 tokens a minute, the highest rate measured.
const UNKNOWN_RUN_TOKENS = 450_000;
// Outcomes that exist to stop repeated runs. The Apps Script monitor reports cooldown and daily-limit skips once a
// day; the budget step reports the token budget.
const SILENT_STATUSES = ["cooldown", "daily_limit", "token_budget"];

const STATUS_TEXT = {
  pr_open: "Opened a draft pull request. Review it, then mark it ready and add the trigger-pr-builder label.",
  needs_review: "Prepared a change that needs a maintainer decision. It was pushed as a branch, not opened as a pull request.",
  waiting_for_release: "No usable fixed release yet: none is published, or it is too new for pnpm's release-age rule. Nothing was changed.",
  not_reported: "Upstream main no longer reports this advisory. Nothing to fix.",
  pr_exists: "An open upstream pull request already mentions this advisory. Nothing was changed.",
  failed: "The fix did not pass the checks. Inspect the workflow run.",
  cooldown: "The agent already worked on this advisory in the last 20 hours. Nothing was changed.",
  daily_limit: "The agent reached its daily run limit. Nothing was changed.",
  token_budget: "The agent reached its daily token budget. Nothing was changed.",
  token_budget_reached: "The agent used up its daily token budget. It will not start again until its usage in the last 24 hours drops below the budget.",
};

export function parseAdvisories(text) {
  const ids = String(text ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  for (const id of ids) if (!GHSA.test(id)) throw new Error(`Invalid advisory ID: ${id}`);
  return [...new Set(ids)];
}

/** A run limit from a repository variable: empty means the default; "1,000,000" and "1_000_000" are accepted. */
export function parseLimit(value, name, fallback) {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  const number = Number(text.replace(/[,_]/g, ""));
  if (!/^(\d+|\d{1,3}(,\d{3})+|\d{1,3}(_\d{3})+)$/.test(text) || !Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive whole number, not "${value}"`);
  }
  return number;
}

/** Tokens for a run whose agent recorded no usage: none when Codex never started, otherwise UNKNOWN_RUN_TOKENS. */
const fallbackTokens = (codexStarted) => (codexStarted ? UNKNOWN_RUN_TOKENS : 0);
const sumTokens = (ran) => ran.reduce((sum, run) => sum + run.tokens, 0);

/** Advisory IDs in a run title such as "Security fix: GHSA-a,GHSA-b (dry run)". */
export function titleAdvisories(title) {
  return (String(title ?? "").match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}/gi) ?? []).map((id) => `GHSA${id.slice(4).toLowerCase()}`);
}

/**
 * Applies the run limits to the advisories that still need a fix. runs are earlier runs of this workflow:
 * {id, startedAt, title, url, agentRan, codexStarted, tokens, budgetNotified, forced}, where startedAt is the start of the
 * run's latest attempt. The cooldown holds back every advisory a run of the same mode requested when its agent ran,
 * so a dry run never holds back a live fix. The daily limit counts every run in which the agent ran, because each one
 * costs tokens. The cooldown comes before the budget, so a run started again and again keeps showing up as a
 * cooldown skip, which the Apps Script monitor reports.
 */
export function applyLimits(ids, runs, { now, currentRunId, dryRun, dailyLimit, tokenBudget, force }) {
  const window = runs.filter((run) => String(run.id) !== String(currentRunId) && now - Date.parse(run.startedAt) < LIMIT_WINDOW_MS);
  const ran = window.filter((run) => run.agentRan).map((run) => ({ startedAt: run.startedAt, tokens: run.tokens ?? fallbackTokens(run.codexStarted) }));
  const agentRuns = ran.length;
  const tokensUsed = sumTokens(ran);
  // usage lets the publish job count the budget again when it decides whether to report it.
  const base = { cooldown: [], limited: false, overBudget: false, notifyBudget: false, agentRuns, tokensUsed, tokenBudget, budgetFreesAt: null, usage: ran };
  if (force) return { ...base, allowed: ids };
  if (agentRuns >= dailyLimit) return { ...base, allowed: [], limited: true };
  const allowed = [];
  const cooldown = [];
  for (const id of ids) {
    const recent = window.find(
      (run) =>
        run.agentRan &&
        now - Date.parse(run.startedAt) < COOLDOWN_MS &&
        /\(dry run\)/.test(run.title) === dryRun &&
        titleAdvisories(run.title).includes(id),
    );
    if (recent) cooldown.push({ id, url: recent.url });
    else allowed.push(id);
  }
  if (allowed.length && tokensUsed >= tokenBudget) {
    // The run that used up the budget reports it. A report from before the newest agent run belongs to an earlier
    // stretch over the budget, so without a later one this run reports it instead. Forced runs are left out: one run
    // while the budget was already used up does not start a new stretch.
    const lastAgentRun = Math.max(...window.filter((run) => run.agentRan && !run.forced).map((run) => Date.parse(run.startedAt)));
    const notifyBudget = !window.some((run) => run.budgetNotified && Date.parse(run.startedAt) >= lastAgentRun);
    return { ...base, allowed: [], cooldown, overBudget: true, notifyBudget, budgetFreesAt: budgetFreesAt(ran, tokenBudget) };
  }
  return { ...base, allowed, cooldown };
}

/** When usage in the rolling 24 hours drops below the budget, as the oldest counted runs leave the window. */
export function budgetFreesAt(ran, budget) {
  let used = sumTokens(ran);
  for (const run of [...ran].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))) {
    used -= run.tokens;
    if (used < budget) return new Date(Date.parse(run.startedAt) + LIMIT_WINDOW_MS).toISOString();
  }
  return null;
}

/** Tokens a finished run's agent used, counted like Codex, from its summary; null when it recorded none. */
export function runTokens(summary) {
  const usage = summary?.tokens;
  if (!usage || typeof usage !== "object") return null;
  const value = "uncached" in usage ? Number(usage.uncached) : Number(usage.total) - Number(usage.cachedInput || 0);
  return Number.isFinite(value) && value >= 0 ? Math.trunc(value) : null;
}

const formatTime = (iso) => (iso ? `${iso.slice(0, 16).replace("T", " ")} UTC` : "an unknown time");

/**
 * The Chat detail saying the daily token budget is used up, or null. Two runs report it: the run that used it up
 * (usage in the last 24 hours was under the budget before the run and at or over it after), and a run held back by
 * the budget when no run in the last 24 hours reported it. Usage is counted again at the time of the call, because
 * earlier runs may have left the 24-hour window since the check job counted it.
 */
export function budgetMessage({ summary, tokens, agentRan, codexStarted, now }) {
  const budget = summary.tokenBudget;
  // No limits were applied, for example because nothing needed a fix.
  if (!budget) return null;
  const live = (summary.usage ?? []).filter((run) => now - Date.parse(run.startedAt) < LIMIT_WINDOW_MS);
  const before = sumTokens(live);
  const total = (count) => `Used ${count.toLocaleString("en-US")} of ${budget.toLocaleString("en-US")} tokens in the last 24 hours`;
  if (summary.overBudget) {
    if (!summary.notifyBudget || before < budget) return null;
    return `${total(before)} (cached input not counted). The agent can start again around ${formatTime(budgetFreesAt(live, budget))}.`;
  }
  if (!agentRan) return null;
  const used = runTokens({ tokens }) ?? fallbackTokens(codexStarted);
  if (before >= budget || before + used < budget) return null;
  const freesAt = budgetFreesAt([...live, { startedAt: summary.startedAt ?? new Date(now).toISOString(), tokens: used }], budget);
  return (
    `${total(before + used)} (this run: ${used.toLocaleString("en-US")}; cached input not counted). ` +
    `The agent can start again around ${formatTime(freesAt)}.`
  );
}

/** Total token usage from a Codex session log (JSON lines); the last token_count event holds the running total. */
export function tokenUsage(jsonl) {
  let usage = null;
  for (const line of String(jsonl).split("\n")) {
    if (!line.includes('"token_count"')) continue;
    try {
      const total = JSON.parse(line).payload?.info?.total_token_usage;
      if (total) usage = total;
    } catch {
      // A truncated last line is possible when the agent was stopped.
    }
  }
  if (!usage) return null;
  // Numbers only: these values reach Chat and a spreadsheet cell.
  const count = (value) => Math.max(0, Math.trunc(Number(value) || 0));
  const total = count(usage.total_tokens);
  const cachedInput = count(usage.cached_input_tokens);
  // Codex reports "tokens used" without cached input, which is billed at a lower rate.
  return { total, uncached: Math.max(0, total - cachedInput), input: count(usage.input_tokens), cachedInput, output: count(usage.output_tokens) };
}

/** Adds up the usage of several Codex sessions, for example a session and the sub-agents it started. */
export function addUsage(usages) {
  const found = usages.filter(Boolean);
  if (!found.length) return null;
  return Object.fromEntries(Object.keys(found[0]).map((key) => [key, found.reduce((sum, usage) => sum + usage[key], 0)]));
}

function usageLine(tokens, seconds) {
  if (!tokens?.total) return "";
  const minutes = seconds ? `, ${(seconds / 60).toFixed(1)} minutes` : "";
  const cached = tokens.cachedInput ? ` plus ${tokens.cachedInput.toLocaleString("en-US")} cached input tokens` : "";
  return `Agent: ${(tokens.uncached ?? tokens.total).toLocaleString("en-US")} tokens${cached}${minutes}.`;
}

/** The Chat detail: reasons, each open PR once (several advisories can share one), and the agent's usage. */
export function detailLines({ reasons, existing, tokens, seconds }) {
  const urls = [...new Set(existing.flatMap((entry) => entry.urls))];
  const usage = usageLine(tokens, seconds);
  return [...reasons.slice(0, 10), ...urls.map((url) => `Open PR: ${url}`), ...(usage ? [usage] : [])].join("\n");
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
    if (summary.limited) return { action: "none", status: "daily_limit", reasons: [`${summary.agentRuns} agent runs in the last 24 hours.`] };
    if (summary.overBudget) {
      const used = `${summary.tokensUsed.toLocaleString("en-US")} of ${summary.tokenBudget.toLocaleString("en-US")} tokens`;
      return {
        action: "none",
        status: "token_budget",
        reasons: [`${used} used in the last 24 hours; the agent can start again around ${formatTime(summary.budgetFreesAt)}.`],
      };
    }
    if (summary.existing.length) return { action: "none", status: "pr_exists", reasons: [] };
    if (summary.cooldown?.length) {
      return { action: "none", status: "cooldown", reasons: summary.cooldown.map(({ id, url }) => `${id}: ${url}`) };
    }
    return { action: "none", status: "not_reported", reasons: [] };
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
 * Whether a job or step did work, from its conclusion, or its status while it has none. One that ran, is running
 * or is queued counts; one that was skipped, or one the run does not have, does not.
 */
export function ranFrom(conclusionOrStatus) {
  return conclusionOrStatus !== "" && conclusionOrStatus !== "skipped";
}

/**
 * What a run's jobs did, from the jobs API listing reduced to {name, result, codex}: whether the agent job ran,
 * whether its Codex step started (an agent job cancelled before it got a runner has no steps), and whether the publish
 * job, which writes the summary, ran.
 */
export function jobFacts(jobs) {
  const job = (name) => jobs.find((item) => item.name === name) ?? { result: "", codex: "" };
  return { agentRan: ranFrom(job("agent").result), codexStarted: ranFrom(job("agent").codex), publishRan: ranFrom(job("publish").result) };
}

const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

function runJobs(repo, runId) {
  // The jobs have no display names, so they are listed as "agent" and "publish"; a test checks the workflow keeps
  // those names and the "Run Codex" step name.
  return jobFacts(
    JSON.parse(
      gh([
        "api",
        `repos/${repo}/actions/runs/${runId}/jobs?per_page=100`,
        "--jq",
        '[.jobs[] | {name, result: (.conclusion // .status), codex: ([.steps[]? | select(.name == "Run Codex") | (.conclusion // .status)][0] // "")}]',
      ]),
    ),
  );
}

/**
 * This workflow's runs whose latest attempt started in the last 24 hours. A run re-run by hand keeps its creation
 * time and can be re-run for 30 days, so the listing reaches back that far. With the created filter GitHub lists at
 * most 1,000 runs, far more than this workflow starts in 30 days. The current run is listed without its jobs, for
 * its start time.
 */
function earlierRuns(repo, currentRunId) {
  const since = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
  const runs = gh([
    "api",
    "--paginate",
    `repos/${repo}/actions/workflows/${WORKFLOW}/runs?per_page=100&created=${encodeURIComponent(`>=${since}`)}`,
    "--jq",
    ".workflow_runs[] | {id, startedAt: (.run_started_at // .created_at), title: .display_title, url: .html_url}",
  ])
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((run) => Date.now() - Date.parse(run.startedAt) < LIMIT_WINDOW_MS);
  return runs.map((run) => {
    if (String(run.id) === String(currentRunId)) return run;
    const { agentRan, codexStarted, publishRan } = runJobs(repo, run.id);
    const summary = publishRan ? runSummary(repo, run.id) : null;
    return {
      ...run,
      agentRan,
      codexStarted,
      tokens: agentRan ? runTokens(summary) : null,
      budgetNotified: summary?.budgetNotified === true,
      forced: summary?.force === true,
    };
  });
}

/** A run's summary artifact, or null when it cannot be read. */
function runSummary(repo, runId) {
  const dir = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), "run-summary-"));
  try {
    execFileSync("gh", ["run", "download", String(runId), "-R", repo, "-n", "security-fix-summary", "-D", dir], { stdio: "ignore" });
    return JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
  } catch {
    console.log(`::warning::Could not read the summary of run ${runId}. If its agent ran, its usage counts as unknown.`);
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Open upstream PRs whose title or description names the advisory and that change dependency files.
 * The pulls API is read directly because the search index can lag behind a newly opened PR.
 */
function openFixPullRequests(ids) {
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
    const summary = { requested, targets: [], missing: [], existing: [], cooldown: [], limited: false, overBudget: false, agentRuns: 0 };
    // Read before the slow calls below, so an invalid repository variable fails the run at once.
    const dailyLimit = parseLimit(opts["daily-limit"], "SECURITY_FIX_DAILY_LIMIT", DEFAULT_DAILY_LIMIT);
    const tokenBudget = parseLimit(opts["token-budget"], "SECURITY_FIX_DAILY_TOKEN_BUDGET", DEFAULT_TOKEN_BUDGET);
    const openFixes = openFixPullRequests(requested.filter((id) => reported.has(id)));
    const needed = [];
    for (const id of requested) {
      if (!reported.has(id)) {
        summary.missing.push(id);
        continue;
      }
      const urls = openFixes[id];
      if (urls.length) summary.existing.push({ id, urls });
      else needed.push(id);
    }
    if (needed.length) {
      const now = Date.now();
      const runs = earlierRuns(opts.repo, opts["run-id"]);
      const limits = applyLimits(needed, runs, {
        now,
        currentRunId: opts["run-id"],
        dryRun: opts["dry-run"] === "true",
        dailyLimit,
        tokenBudget,
        force: opts.force === "true",
      });
      summary.targets = limits.allowed;
      summary.cooldown = limits.cooldown;
      summary.limited = limits.limited;
      summary.agentRuns = limits.agentRuns;
      summary.overBudget = limits.overBudget;
      summary.notifyBudget = limits.notifyBudget;
      summary.tokensUsed = limits.tokensUsed;
      summary.tokenBudget = limits.tokenBudget;
      summary.budgetFreesAt = limits.budgetFreesAt;
      summary.usage = limits.usage;
      // Other runs place this run in their 24-hour window by the start of its latest attempt, so the budget message does too.
      summary.startedAt = runs.find((run) => String(run.id) === String(opts["run-id"]))?.startedAt ?? new Date(now).toISOString();
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

  if (command === "usage") {
    const sessions = join(opts["codex-home"], "sessions");
    const files = [];
    const walk = (dir) => {
      for (const entry of existsSync(dir) ? readdirSync(dir, { withFileTypes: true }) : []) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (/^rollout-.*\.jsonl$/.test(entry.name)) files.push(path);
      }
    };
    walk(sessions);
    const tokens = addUsage(files.map((file) => tokenUsage(readFileSync(file, "utf8"))));
    const seconds = opts.started ? Math.max(0, Math.round(Date.now() / 1000 - Number(opts.started))) : 0;
    console.log(JSON.stringify({ tokens, seconds }));
    output("tokens", tokens ? JSON.stringify(tokens) : "");
    output("seconds", String(seconds));
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
    let tokens = null;
    try {
      tokens = opts.tokens ? JSON.parse(opts.tokens) : null;
    } catch {
      tokens = null;
    }
    const detail = detailLines({ reasons: decision.reasons, existing: summary.existing, tokens, seconds: Number(opts.seconds) || 0 });
    console.log(JSON.stringify({ ...decision, title, branch }, null, 2));
    if (opts["decision-out"]) {
      writeFileSync(
        opts["decision-out"],
        JSON.stringify({ ...decision, title, requested: summary.requested, targets: summary.targets, tokens, agentSeconds: Number(opts.seconds) || null }),
      );
    }
    output("action", decision.action);
    output("status", decision.status);
    output("notify", String(!SILENT_STATUSES.includes(decision.status)));
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

  if (command === "budget") {
    let tokens = null;
    try {
      tokens = opts.tokens ? JSON.parse(opts.tokens) : null;
    } catch {
      tokens = null;
    }
    const summary = JSON.parse(opts.summary);
    // Read the same way as for earlier runs, so this run counts here as later runs will count it. A run held back by
    // the budget did not run the agent.
    const counts = summary.tokenBudget && !summary.overBudget;
    const { agentRan, codexStarted } = counts ? runJobs(opts.repo, opts["run-id"]) : { agentRan: false, codexStarted: false };
    const detail = budgetMessage({ summary, tokens, agentRan, codexStarted, now: Date.now() });
    console.log(detail ?? "This run does not report the daily token budget.");
    output("report", String(Boolean(detail)));
    output("detail", detail ?? "");
    return;
  }

  if (command === "summary") {
    const decision = readJson(opts.decision);
    if (!decision) throw new Error("Decision file is missing or invalid");
    const summary = {
      version: 1,
      runId: Number(opts["run-id"]),
      dryRun: opts["dry-run"] === "true",
      force: opts.force === "true",
      requested: decision.requested,
      targets: decision.targets,
      status: opts.status || decision.status,
      action: decision.action,
      title: decision.title,
      url: opts.url || "",
      tokens: decision.tokens,
      agentSeconds: decision.agentSeconds,
      // Read by later runs, so the budget message is posted once.
      budgetNotified: opts["budget-notified"] === "true",
      reasons: decision.reasons.slice(0, 5),
    };
    writeFileSync(opts.out, JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  if (command === "notify") {
    await notify({ status: opts.status, advisories: opts.advisories, url: opts.url, detail: opts.detail });
    return;
  }

  throw new Error("Usage: publish.mjs targets|prompt|usage|decide|budget|summary|audit-check|notify [--option value ...]");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
