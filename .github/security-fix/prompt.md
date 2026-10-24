You are fixing npm security advisories in the ThunderID monorepo checked out in the current directory: upstream `thunder-id/thunderid` at commit {{BASE_SHA}}. You run unattended in CI. Nobody can answer questions, so never ask; decide, then report.

Advisories to fix: {{ADVISORIES}}

{{OPEN_PR}}

The audit output for this commit is in `{{CONTEXT_DIR}}/audit.json`. It is `pnpm audit --json --ignore-registry-errors --audit-level=high` from pnpm 11: `advisories` is keyed by numeric ID, and each entry has `github_advisory_id`, `module_name`, `vulnerable_versions`, `patched_versions`, `severity` and `findings[].paths`.

Follow `.agent/skills/fix-npm-vulnerability/SKILL.md` and `AGENTS.md`, with these rules for unattended use. Where the skill says to ask the user, apply the rules below instead.

## Rules

- Only edit `pnpm-workspace.yaml`, `package.json` files and `pnpm-lock.yaml`. Never edit any other file, never create files in the repository, and never run `git commit`.
- Never run `pnpm install` or `pnpm update` without `--lockfile-only`. Do not create `node_modules` and do not run package scripts.
- Network access is limited to `registry.npmjs.org`. Research with `pnpm view <package> versions time --json`, `pnpm view <package>@<version> dependencies --json` and `pnpm why <package>`.
- Do not create GitHub issues or pull requests. A later job does that.
- Choose the smallest fix, in this order:
  1. The vulnerable package is a direct dependency or a catalog entry: raise its range to the first patched version in the same major version.
  2. The existing ranges already allow a patched version: refresh only that package in the lockfile.
  3. An override already exists for it: raise the override to the patched version.
  4. A newer release of the dependency that pulls it in ships the patched version within the same major version: raise that dependency.
  5. Anything else needs a maintainer: a major version bump (the skill's Step 5a) or a new override (its Step 5b). Prepare the complete change the skill describes anyway, so that `pnpm audit` no longer reports the advisory and a maintainer only has to review it. Do not stop at a partial fix. For a major version bump, put the skill's Step 6 testing checklist (affected workspaces and the commands that test them) in `notes`. For a new override, leave out the skill's `# Tracking:` line and say in `notes` that it needs the Step 7 tracking issue, which a maintainer creates and adds. A dependent whose declared range excludes the patched major (for example a dependency that requires `^3` when only 4.x is patched) is a compatibility risk to explain in `notes`, not a reason to stop: override it for that dependent. Set `status` to `needs_review` and explain why the lighter options do not work.
- Never add `auditConfig.ignoreGhsas` or `minimumReleaseAgeExclude` entries; the skill has no step for them.
- If no published release in any major version fixes an advisory, set `status` to `waiting_for_release` and change nothing for it. A fix that exists only in a newer major version falls under rule 5, not this one.
- If pnpm refuses a patched version because of `minimumReleaseAge`, do not add an exclusion. Set `status` to `waiting_for_release` and say when the version becomes eligible.
- Keep lockfile drift minimal. If pnpm also changes entries unrelated to the advisories, revert that drift only when the lockfile stays consistent; otherwise keep it and mention it.
- Match the comment and formatting style of existing entries in `pnpm-workspace.yaml`.

## Override conventions

Upstream review enforces these on every override a change touches, including one you only raise. Follow `.agent/skills/prune-npm-overrides/SKILL.md` Step 5:

- Use the narrowest form. Write `<package>@<affected range>: '>=<patched>'`, for example `follow-redirects@<1.16.1: '>=1.16.1'`, or `<parent>><package>` when one dependency path is affected. Never leave a bare `<package>: <version>`, which pins every consumer.
- Give it a complete justification: the advisory IDs with a one-line description, how the package enters the tree (the dependency path with versions from `pnpm why`), what blocks the real fix, `Added YYYY-MM-DD` and a `Remove once ...` condition. For an existing entry, find its original date with `git log -S '<package>' --format=%as -- pnpm-workspace.yaml` and add the date of this change, for example `Added 2026-05-14, narrowed and raised 2026-10-21.`
- Verify every advisory ID you cite or keep with `curl -s https://api.github.com/advisories/<GHSA>`: its `vulnerabilities` must list the package. Existing comments can be wrong; correct them.
- After you change a version, search `pnpm-workspace.yaml` comments for the old version and update every stale mention.
- Before you finish, run `node {{TOOLS_DIR}}/lint-overrides.mjs --repo . --base {{BASE_SHA}}` and fix every problem it reports. It must print no problems.

## Verify before you finish

- After your edits, `pnpm install --lockfile-only` must leave `pnpm-lock.yaml` unchanged.
- `pnpm audit --json --ignore-registry-errors --audit-level=high`, the command upstream CI runs, must no longer report the advisories you were asked to fix and must not report any advisory that `{{CONTEXT_DIR}}/audit.json` does not already list. Other advisories already in that file are handled elsewhere; leave them alone. It may still report them only when `status` is `waiting_for_release`, or when pnpm cannot resolve the complete change; then quote pnpm's error in `notes`.
- `node {{TOOLS_DIR}}/lint-overrides.mjs --repo . --base {{BASE_SHA}}` reports no problems.

## Final answer

Return JSON that matches the provided schema.

- `status`: `fixed` when the advisories you were asked to fix are gone with only rule 1 to 4 changes; otherwise the matching status.
- `advisories`: one entry per advisory with the package, the strategy you used, and the version before and after.
- `title`: a short imperative sentence under 72 characters with no prefix such as `fix:`. Examples from this repository: "Raise handlebars to 4.7.10 for two critical advisories", "Bump next to 16.3.8 to fix GHSA-cjq9-62q9-8jv4".
The `purpose`, `approach`, `validation` and `notes` fields become the pull request description, read by upstream maintainers who have not seen these instructions. Write them like recent security PRs in this repository (for example #5711, #5694 and #5942):

- `purpose`: Markdown. Say which advisories make `pnpm audit --audit-level=high` fail, with a table of package, advisory link (`https://github.com/advisories/<GHSA>`) and fixed version.
- `approach`: Markdown. Say what changed and why in plain terms, including why a lighter fix was not possible and any lockfile drift you kept. Never refer to these instructions, their rule numbers or this workflow.
- `validation`: Markdown list of the checks a reviewer can re-run from the repository root, such as `pnpm why <package>`, `pnpm install --frozen-lockfile` and `pnpm audit --ignore-registry-errors --audit-level=high`, with their results. Do not list paths outside the repository, environment variable tricks or tools from this workflow.
- `notes`: only what a reviewer must know about the change itself, such as kept lockfile drift, a compatibility risk, or the testing checklist and tracking issue a `needs_review` fix needs; otherwise an empty string. Do not describe how you worked (scripts, `node_modules`, commits) and do not mention advisories outside this fix, because the description already lists them.

Write "ThunderID", never "Thunder" alone. Do not use em dashes.
