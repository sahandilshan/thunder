# Security fix agent

Fork-only automation that prepares fixes for high and critical npm advisories on upstream `thunder-id/thunderid` main and opens them as draft pull requests.

The Apps Script security monitor detects a new advisory on upstream main and starts `.github/workflows/security-fix-agent.yml` with the GHSA IDs. The workflow has three jobs:

1. **check** audits the upstream commit with the command upstream CI runs and drops advisories that are no longer reported or that an open upstream pull request already fixes: one that names the advisory in its title or description and changes dependency files.
2. **agent** runs Codex on Azure OpenAI through `openai/codex-action`. It follows the repository's `fix-npm-vulnerability` skill under the rules in `prompt.md`. The job has read-only repository access, and Codex may reach only `registry.npmjs.org` and GitHub's public advisory API (`codex-config.toml`). Before finishing, the agent runs `lint-overrides.mjs` and fixes what it reports. The job saves the change as a patch.
3. **publish** has no model key. It applies the patch to a clean checkout and re-checks it:
   - `guard.mjs` allows only `package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml`, and only same-major raises of existing versions count as automatic.
   - `pnpm install --lockfile-only` must leave the lockfile unchanged.
   - `pnpm audit --ignore-registry-errors --audit-level=high` must no longer report the targeted advisories and must not report new ones. Advisories that were already reported and are handled elsewhere may remain; the PR description lists them.
   - `lint-overrides.mjs` must report no problems. It applies the conventions upstream review enforced on #5942: every touched override is range-qualified or parent-scoped, its justification names the advisory, an `Added` date and a `Remove once` condition, every cited GHSA ID lists that package, and no unchanged comment still names a replaced version.

   An automatic fix becomes a signed-off commit on a `security-fix/` branch of the fork and a **draft** pull request on upstream. New overrides, major bumps, audit ignores and release-age exceptions are pushed as a branch for a maintainer instead. Every outcome is posted to Google Chat.

## Setup

In the fork, open **Settings > Secrets and variables > Actions**.

Secrets:

| Name | Value | Needed for |
|---|---|---|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI key | All runs |
| `GOOGLE_CHAT_SECURITY_WEBHOOK` | Chat incoming webhook URL (already set for the monitor) | Live runs |
| `SECURITY_FIX_FORK_TOKEN` | The fork token (see below). Pushes fix branches, which carry upstream commits that change workflow files and so cannot be pushed with the default `GITHUB_TOKEN`. | Live runs |
| `UPSTREAM_PR_TOKEN` | The PR token (see below). Opens draft pull requests on `thunder-id/thunderid`. Stored only here. | Live runs |

Variables:

| Name | Example | Needed for |
|---|---|---|
| `SECURITY_FIX_ENABLED` | `true` | All runs |
| `AZURE_OPENAI_RESPONSES_ENDPOINT` | `https://<resource>.openai.azure.com/openai/v1/responses` | All runs |
| `AZURE_OPENAI_MODEL` | The Azure deployment name of a strong coding model | All runs |
| `AZURE_OPENAI_EFFORT` | `high` (default) | Optional |
| `SECURITY_FIX_GIT_NAME`, `SECURITY_FIX_GIT_EMAIL` | The identity used for the commit and its DCO sign-off | Live runs |
| `SECURITY_FIX_PR_LABELS` | `trigger-pr-builder,skip-changelog` | Optional |

In the Apps Script project, add the script properties `FIX_DISPATCH_TOKEN` (the same fork token) and `FIX_MODE`. Move `FIX_MODE` from `off` to `dry-run`, then to `live`.

### Tokens

Two tokens keep each one narrow. A fine-grained token covers repositories of one owner only, so it cannot both push to the fork and open a pull request on `thunder-id/thunderid`. A single classic token could, but starting a workflow with a classic token needs the `repo` scope, which grants access to every public and private repository the account can reach.

| Token | Type | Access | Stored in |
|---|---|---|---|
| Fork token | Fine-grained | Repository `sahandilshan/thunder` only. **Actions**, **Contents** and **Workflows**: read and write. | `SECURITY_FIX_FORK_TOKEN` secret and the `FIX_DISPATCH_TOKEN` script property |
| PR token | Classic | The `public_repo` scope only | `UPSTREAM_PR_TOKEN` secret |

When a token expires, starting the workflow, pushing or opening the pull request fails, and the failure is posted to Google Chat.

## Testing

Run the workflow by hand against an upstream commit that still had an advisory, with `dry_run` checked. A dry run runs the agent and every check, then shows the outcome and the pull request body in the job summary. It does not push, open a pull request or post to Chat.

```sh
gh workflow run security-fix-agent.yml -R sahandilshan/thunder \
  -f advisories=GHSA-8r5x-fm3f-whwj,GHSA-p8wg-vrv2-v86f \
  -f ref=f00b0ef6e1b2e7182f75e276352a8f2115ed1510 -f dry_run=true
```

That commit is upstream main just before #5711 fixed the two `handlebars` advisories. `ref` must be a branch name or a full commit SHA. The unit tests run with `node --test .github/security-fix/security-fix.test.mjs` and need Ruby for YAML parsing.

## Limits

- Only npm advisories on upstream main. Go modules and container images (for example #5875) and the `1.0.x` release branch are out of scope.
- Draft pull requests still need a maintainer review, the `trigger-pr-builder` label and the full PR Builder run.
- The commit is signed off with the configured identity. Review each draft before marking it ready.
