You are fixing npm security advisories in the ThunderID monorepo checked out in the current directory: upstream `thunder-id/thunderid` at commit {{BASE_SHA}}. You run unattended in CI. Nobody can answer questions, so never ask; decide, then report.

Advisories to fix: {{ADVISORIES}}

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
  5. Anything else needs a maintainer: a new override, a major version bump, an `auditConfig.ignoreGhsas` entry or a `minimumReleaseAgeExclude` entry. You may prepare such a change, but set `status` to `needs_review` and explain why the lighter options do not work.
- If no published release fixes an advisory, set `status` to `waiting_for_release` and change nothing for it.
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
- `pnpm audit --ignore-registry-errors --audit-level=high` must exit 0. This is the command upstream CI runs. It may still fail only when `status` is `needs_review` or `waiting_for_release`.
- `node {{TOOLS_DIR}}/lint-overrides.mjs --repo . --base {{BASE_SHA}}` reports no problems.

## Final answer

Return JSON that matches the provided schema.

- `status`: `fixed` when the audit passes with only rule 1 to 4 changes; otherwise the matching status.
- `advisories`: one entry per advisory with the package, the strategy you used, and the version before and after.
- `title`: a short imperative sentence under 72 characters with no prefix such as `fix:`. Examples from this repository: "Raise handlebars to 4.7.10 for two critical advisories", "Bump next to 16.3.8 to fix GHSA-cjq9-62q9-8jv4".
- `purpose`: Markdown. Say which advisories make `pnpm audit --audit-level=high` fail, with a table of package, advisory link (`https://github.com/advisories/<GHSA>`) and fixed version.
- `approach`: Markdown. Say what changed and why, including why a lighter fix was not possible and any lockfile drift you kept.
- `validation`: Markdown list of the commands you ran and their results.
- `notes`: anything a reviewer must know, or an empty string.

Write "ThunderID", never "Thunder" alone. Do not use em dashes.
