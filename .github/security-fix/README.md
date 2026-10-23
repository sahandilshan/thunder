# Security fix agent

Fork-only automation that prepares fixes for high and critical npm advisories on upstream `thunder-id/thunderid` main and opens them as draft pull requests.

The Apps Script security monitor detects a new advisory on upstream main and starts `.github/workflows/security-fix-agent.yml` with the GHSA IDs. The workflow has three jobs:

1. **check** audits the upstream commit with the command upstream CI runs and drops advisories that are no longer reported or that an open upstream pull request already fixes: one that names the advisory in its title or description and changes dependency files. It also applies the [run limits](#run-limits-and-usage).
2. **agent** runs Codex on Azure OpenAI through `openai/codex-action`. It follows the repository's `fix-npm-vulnerability` skill under the rules in `prompt.md`. The job has read-only repository access, and Codex may reach only `registry.npmjs.org` and GitHub's public advisory API (`codex-config.toml`). Before finishing, the agent runs `lint-overrides.mjs` and fixes what it reports. The job saves the change as a patch.
3. **publish** has no model key. It applies the patch to a clean checkout and re-checks it:
   - `guard.mjs` allows only `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`, and only same-major raises of existing versions count as automatic.
   - `pnpm install --lockfile-only` must leave the lockfile unchanged.
   - `pnpm audit --ignore-registry-errors --audit-level=high` must no longer report the targeted advisories and must not report new ones. Advisories that were already reported and are handled elsewhere may remain; the PR description lists them.
   - `lint-overrides.mjs` must report no problems. It applies the conventions upstream review enforced on #5942: every touched override is range-qualified or parent-scoped, its justification names the advisory, an `Added` date and a `Remove once` condition, every cited GHSA ID lists that package, and no unchanged comment still names a replaced version.

   An automatic fix becomes a signed-off commit on a `security-fix/` branch of the fork and a **draft** pull request on upstream. New overrides, major bumps, audit ignores and release-age exceptions are pushed as a branch for a maintainer instead. Every outcome is posted to Google Chat, except runs held back by the run limits, which the Apps Script monitor reports at most once a day.

## Setup

In the fork, open **Settings > Secrets and variables > Actions**.

Secrets:

| Name | Value | Needed for |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | All runs |
| `AZURE_OPENAI_RESPONSES_ENDPOINT` | `https://<resource>.openai.azure.com/openai/v1/responses`. A secret so the resource name is masked in public run logs. | All runs |
| `GOOGLE_CHAT_SECURITY_WEBHOOK` | Chat incoming webhook URL (already set for the monitor) | Live runs |
| `SECURITY_FIX_FORK_TOKEN` | The fork token (see below). Pushes fix branches, which carry upstream commits that change workflow files and so cannot be pushed with the default `GITHUB_TOKEN`. | Live runs |
| `UPSTREAM_PR_TOKEN` | The PR token (see below). Opens draft pull requests on `thunder-id/thunderid`. Stored only here. | Live runs |

Variables:

| Name | Example | Needed for |
|---|---|---|
| `SECURITY_FIX_ENABLED` | `true` | All runs |
| `AZURE_OPENAI_MODEL` | The Azure deployment name of a strong coding model | All runs |
| `AZURE_OPENAI_EFFORT` | `high` (default) | Optional |
| `SECURITY_FIX_GIT_NAME`, `SECURITY_FIX_GIT_EMAIL` | The identity used for the commit and its DCO sign-off | Live runs |
| `SECURITY_FIX_PR_LABELS` | `trigger-pr-builder,skip-changelog` | Optional |
| `SECURITY_FIX_DAILY_LIMIT` | `6` (default): agent runs allowed in 24 hours | Optional |

In the Apps Script project, add the script properties `FIX_DISPATCH_TOKEN` (the same fork token) and `FIX_MODE`. Move `FIX_MODE` from `off` to `dry-run`, then to `live`.

The monitor's source is [`apps-script/Code.gs`](apps-script/Code.gs). Apps Script does not read it from here: after a change, paste the whole file into the sheet's Apps Script editor and save. `testFixDispatch()` starts a dry run on a past commit, skipping the run limits, to check that `FIX_DISPATCH_TOKEN` can start this workflow.

### Tokens

Two tokens keep each one narrow. A fine-grained token covers repositories of one owner only, so it cannot both push to the fork and open a pull request on `thunder-id/thunderid`. A single classic token could, but starting a workflow with a classic token needs the `repo` scope, which grants access to every public and private repository the account can reach.

| Token | Type | Access | Stored in |
|---|---|---|---|
| Fork token | Fine-grained | Repository `sahandilshan/thunder` only. **Actions**, **Contents** and **Workflows**: read and write. | `SECURITY_FIX_FORK_TOKEN` secret and the `FIX_DISPATCH_TOKEN` script property |
| PR token | Classic | The `public_repo` scope only | `UPSTREAM_PR_TOKEN` secret |

When a token expires, starting the workflow, pushing or opening the pull request fails, and the failure is posted to Google Chat.

## Run limits and usage

Each layer stops repeated runs on its own, so one fault cannot loop the agent:

- **Apps Script monitor:** starts the workflow for an advisory at most 3 times, a day apart, counted separately for dry-run and live mode. A start the workflow skipped without running the agent (open pull request, cooldown, daily limit, no longer reported) does not count. After the last attempt it posts one message and stops until upstream main no longer reports the advisory.
- **check job:** holds back an advisory that a run of the same mode requested within the last 20 hours when its agent ran, and stops all advisories once the agent ran `SECURITY_FIX_DAILY_LIMIT` times in 24 hours. These skips are not posted to Chat; the monitor reports them at most once a day. The `force` input skips both limits for manual tests.
- **agent job:** stops after 15 minutes. A fix usually takes about 4.

These limit how often the agent runs, not what Azure charges. For a hard spending ceiling, set a tokens-per-minute quota on the Azure OpenAI deployment and a budget alert on its resource.

Every run that reaches the publish job uploads `security-fix-summary` (kept 30 days): status, advisories, pull request or branch link, and the agent's token usage, read from the Codex session log. The agent's Chat message ends with the token count. Like Codex's own "tokens used", it leaves out cached input, which is billed at a lower rate and reported separately. The monitor adds a row per finished run to the sheet's **Fix runs** tab, including runs without a summary.

## Testing

Run the workflow by hand against an upstream commit that still had an advisory, with `dry_run` checked. A dry run runs the agent and every check, then shows the outcome and the pull request body in the job summary. It does not push, open a pull request or post to Chat.

```sh
gh workflow run security-fix-agent.yml -R sahandilshan/thunder \
  -f advisories=GHSA-8r5x-fm3f-whwj,GHSA-p8wg-vrv2-v86f \
  -f ref=f00b0ef6e1b2e7182f75e276352a8f2115ed1510 -f dry_run=true -f force=true
```

That commit is upstream main just before #5711 fixed the two `handlebars` advisories. `ref` must be a branch name or a full commit SHA. Without `force=true`, repeating the run within 20 hours is held back by the cooldown.

The tests run with `node --test .github/security-fix/security-fix.test.mjs` (needs Ruby for YAML parsing) and `node --test .github/security-fix/apps-script/monitor.test.mjs`.

## Limits

- Only npm advisories on upstream main. Go modules and container images (for example #5875) and the `1.0.x` release branch are out of scope.
- Draft pull requests still need a maintainer review, the `trigger-pr-builder` label and the full PR Builder run.
- The commit is signed off with the configured identity. Review each draft before marking it ready.
