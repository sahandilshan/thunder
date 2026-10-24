# Security fix agent

Fork-only automation that prepares fixes for high and critical npm advisories on upstream `thunder-id/thunderid` main and opens them as pull requests, keeping every fix in one open pull request at a time.

The Apps Script security monitor detects a new advisory on upstream main and starts `.github/workflows/security-fix-agent.yml` with the GHSA IDs. The workflow has three jobs:

1. **check** audits the upstream commit with the command upstream CI runs and drops advisories that are no longer reported or that an open upstream pull request already fixes: one that changes dependency files and names the advisory in its title or description. A pull request whose description has the hidden `<!-- security-fix-agent: ... -->` marker counts only for the advisories the marker lists, because its description also names advisories that are handled elsewhere. It also applies the [run limits](#run-limits-and-usage). See [one pull request at a time](#one-pull-request-at-a-time) for what happens when the agent's own pull request is still open.
2. **agent** runs Codex on Azure OpenAI through `openai/codex-action`. It follows the repository's `fix-npm-vulnerability` skill under the rules in `prompt.md`. When the fix needs a major version bump or a new override, which the skill leaves to a maintainer, it still prepares the complete change, with the skill's testing checklist, rather than a partial one. The job has read-only repository access, and Codex may reach only `registry.npmjs.org` and GitHub's public advisory API (`codex-config.toml`). Before finishing, the agent runs `lint-overrides.mjs` and fixes what it reports. The job saves the change as a patch.
3. **publish** has no model key. It applies the patch to a clean checkout and re-checks it:
   - `guard.mjs` allows only `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`, and only same-major raises of existing versions count as automatic.
   - `pnpm install --lockfile-only` must leave the lockfile unchanged.
   - `pnpm audit --ignore-registry-errors --audit-level=high` must no longer report the targeted advisories and must not report new ones. Advisories that were already reported and are handled elsewhere may remain; the PR description lists them.
   - `lint-overrides.mjs` must report no problems. It applies the conventions upstream review enforced on #5942: every touched override is range-qualified or parent-scoped, its justification names the advisory, an `Added` date and a `Remove once` condition, every cited GHSA ID lists that package, and no unchanged comment still names a replaced version.

   An automatic fix becomes a signed-off commit on a `security-fix/` branch of the fork and a pull request on upstream, ready for review and labelled with `SECURITY_FIX_PR_LABELS`. New overrides and major bumps are pushed as a branch for a maintainer instead. A change to audit ignores or release-age settings is rejected: the skill has no step for them, so a maintainer makes them by hand. The Chat message links to a new upstream pull request from that branch, with the title and the marker filled in; the description is in the run's job summary. Every outcome is posted to Google Chat, except runs held back by the [run limits](#run-limits-and-usage), which are reported as described there. A message that needs someone to act (a pull request to review, a fix for a maintainer, an advisory to add to a pull request's marker, no fix released yet, a failed run) starts with `<users/all>`, which mentions everyone in the space. The monitor's messages include the same mention for a new advisory, changed advisory details, the 12-hour "still not fixed" reminder and an advisory the agent stopped working on.

## Setup

In the fork, open **Settings > Secrets and variables > Actions**.

Secrets:

| Name | Value | Needed for |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | All runs |
| `AZURE_OPENAI_RESPONSES_ENDPOINT` | `https://<resource>.openai.azure.com/openai/v1/responses`. A secret so the resource name is masked in public run logs. | All runs |
| `GOOGLE_CHAT_SECURITY_WEBHOOK` | Chat incoming webhook URL (already set for the monitor) | All runs. Dry runs post only the daily token budget message. |
| `SECURITY_FIX_FORK_TOKEN` | The fork token (see below). Pushes fix branches, which carry upstream commits that change workflow files and so cannot be pushed with the default `GITHUB_TOKEN`. | Live runs |
| `UPSTREAM_PR_TOKEN` | The PR token (see below). Opens and updates pull requests on `thunder-id/thunderid`. Stored only here. | Live runs |

Variables:

| Name | Example | Needed for |
|---|---|---|
| `SECURITY_FIX_ENABLED` | `true` | All runs |
| `AZURE_OPENAI_MODEL` | The Azure deployment name of a strong coding model | All runs |
| `AZURE_OPENAI_EFFORT` | `high` (default) | Optional |
| `SECURITY_FIX_GIT_NAME`, `SECURITY_FIX_GIT_EMAIL` | The identity used for the commit and its DCO sign-off | Live runs |
| `SECURITY_FIX_PR_LABELS` | `trigger-pr-builder,skip-changelog` | Optional |
| `SECURITY_FIX_DAILY_LIMIT` | `6` (default): agent runs allowed in 24 hours | Optional |
| `SECURITY_FIX_DAILY_TOKEN_BUDGET` | `1000000` (default): agent tokens allowed in 24 hours | Optional |

The two limits take a positive whole number; `1,000,000` and `1_000_000` also work. Any other value fails the run, and live runs post the failure to Google Chat.

In the Apps Script project, add the script properties `FIX_DISPATCH_TOKEN` (the same fork token) and `FIX_MODE`. Move `FIX_MODE` from `off` to `dry-run`, then to `live`.

The monitor's source is [`apps-script/Code.gs`](apps-script/Code.gs). Apps Script does not read it from here: after a change, paste the whole file into the sheet's Apps Script editor and save. `testFixDispatch()` starts a dry run on a past commit, skipping the run limits, to check that `FIX_DISPATCH_TOKEN` can start this workflow.

### Tokens

Two tokens keep each one narrow. A fine-grained token covers repositories of one owner only, so it cannot both push to the fork and open a pull request on `thunder-id/thunderid`. A single classic token could, but starting a workflow with a classic token needs the `repo` scope, which grants access to every public and private repository the account can reach.

| Token | Type | Access | Stored in |
|---|---|---|---|
| Fork token | Fine-grained | Repository `sahandilshan/thunder` only. **Actions**, **Contents** and **Workflows**: read and write. | `SECURITY_FIX_FORK_TOKEN` secret and the `FIX_DISPATCH_TOKEN` script property |
| PR token | Classic | The `public_repo` scope only | `UPSTREAM_PR_TOKEN` secret |

When a token expires, starting the workflow, pushing or opening the pull request fails, and the failure is posted to Google Chat.

## One pull request at a time

Upstream CI fails a pull request while main reports any high advisory. Two open fixes for different advisories would each fail for lack of the other, so neither could be merged. So while the agent's own pull request is open, a new fix goes into it:

- The agent's pull request is the newest open one from a `security-fix/` branch of this fork into the base branch whose description has the `<!-- security-fix-agent: ... -->` marker, opened by this fork's owner (the PR token's account) or by an upstream owner, member or collaborator. A pull request opened by hand counts too if it follows these rules, for example one opened from the link in a "needs review" message.
- Only a run of the base branch itself (`ref` equal to `base_branch`, as the monitor starts it) builds on that pull request. The check job rejects a live run of any other `ref`, which would open a second pull request; a dry run of an older commit does not build on it.
- The agent job starts from that pull request's change and is asked to fix its advisories (those main still reports) and the new ones. If its `pnpm-lock.yaml` part no longer applies to main, the agent regenerates the lockfile; if nothing applies, it fixes every advisory from main. The job stops before Codex runs if the pull request changed since the check job read it.
- An automatic result replaces the pull request's commit with one new signed-off commit on current main, pushed to the same branch, and the title and description are rewritten for every advisory. That includes a run that adds nothing because the pull request already fixes the new advisory: its description then lists it. The push uses a lease, so it fails instead of overwriting a commit pushed after the check.
- The agent does not update a pull request that someone other than this fork's owner opened, that has more than one commit, or whose commit was authored or committed by anyone other than `SECURITY_FIX_GIT_EMAIL`. It pushes the combined change as a branch for a maintainer instead, as it does for a result that needs review. The guard checks the whole combined change, so while the open pull request contains a change that needs review (for example a new override), every later fix is pushed as a branch too.
- The monitor gives back the attempt of an advisory that a run only carried along from the open pull request.

## Run limits and usage

Each layer stops repeated runs on its own, so one fault cannot loop the agent:

- **Apps Script monitor:** starts the workflow for an advisory at most 3 times, a day apart, counted separately for dry-run and live mode. A start the workflow skipped without running the agent (open pull request, cooldown, daily limit, token budget, no longer reported), or in which the advisory was only carried along in the agent's open pull request, does not count. After the last attempt it posts one message and stops until upstream main no longer reports the advisory.
- **check job:** holds back an advisory that a run of the same mode requested within the last 20 hours when its agent ran. It stops all advisories once the agent ran `SECURITY_FIX_DAILY_LIMIT` times in 24 hours. It stops the advisories that are not in that cooldown once the agent's tokens in those 24 hours reach `SECURITY_FIX_DAILY_TOKEN_BUDGET`. The cooldown comes first so that a run started again and again still shows up as a cooldown skip. These skips are not posted to Chat as run outcomes. The monitor reports cooldown and daily-limit skips at most once a day, because they mean something starts the agent too often; the token budget has its own message. The `force` input skips all three limits for manual tests.
- **daily token budget:** counted like Codex's "tokens used", without cached input, from the summaries of the runs in the last 24 hours. Real fixes used 60,000 to 81,000, so the default of 1,000,000 allows six runs of twice the largest. A run that started Codex but recorded no usage, for example because it hit the time limit, counts as 450,000: 15 minutes at about 30,000 tokens a minute, the highest rate measured. A run where Codex never started counts as 0.
  - The run that uses up the budget posts one message to Chat, including dry runs, saying when the agent can start again. Its summary records that, and runs the budget holds back stay quiet. If that message is missing, for example because Chat was unreachable, the first run held back posts it. If a run posts the message but its summary cannot be uploaded, a later run posts it again.
  - The check happens before the agent starts, so the last run can go past the budget. Without forced runs or re-runs, the worst case is the budget plus one run: about 1,450,000 tokens in 24 hours with the defaults.
  - Runs are placed in the 24 hours by the start of their latest attempt. A run re-run by hand counts once, with the usage its summary recorded, so tokens spent by its earlier attempts are not counted.
- **agent job:** stops after 15 minutes. A fix usually takes about 4.

These limits are enforced by this workflow, not by Azure. For a hard spending ceiling, set a tokens-per-minute quota on the Azure OpenAI deployment and a budget alert on its resource.

Every run that reaches the publish job uploads `security-fix-summary` (kept 30 days): status, advisories, pull request or branch link, and the agent's token usage, read from the Codex session log. The agent's Chat message ends with the token count. Like Codex's own "tokens used", it leaves out cached input, which is billed at a lower rate and reported separately. The monitor adds a row per finished run to the sheet's **Fix runs** tab, including runs without a summary.

## Testing

Run the workflow by hand against an upstream commit that still had an advisory, with `dry_run` checked. A dry run runs the agent and every check, then shows the outcome and the pull request body in the job summary. It does not push, open a pull request or post its outcome to Chat. It does post the daily token budget message if it uses up the budget.

```sh
gh workflow run security-fix-agent.yml -R sahandilshan/thunder \
  -f advisories=GHSA-8r5x-fm3f-whwj,GHSA-p8wg-vrv2-v86f \
  -f ref=f00b0ef6e1b2e7182f75e276352a8f2115ed1510 -f dry_run=true -f force=true
```

That commit is upstream main just before #5711 fixed the two `handlebars` advisories. `ref` must be a branch name or a full commit SHA. Without `force=true`, repeating the run within 20 hours is held back by the cooldown.

The tests run with `node --test .github/security-fix/security-fix.test.mjs` (needs Ruby for YAML parsing) and `node --test .github/security-fix/apps-script/monitor.test.mjs`.

## Limits

- Only npm advisories on upstream main. Go modules and container images (for example #5875) and the `1.0.x` release branch are out of scope.
- Pull requests still need a maintainer review and the full PR Builder run. The `trigger-pr-builder` label comes from `SECURITY_FIX_PR_LABELS`.
- The commit is signed off with the configured identity, and the pull request is opened ready for review under the PR token's account. Review each one before it is merged.
