# Upstream security monitor

Fork-only monitoring for `thunder-id/thunderid`. No upstream workflow changes or AI service are needed.

Every 30 minutes, the workflow audits a snapshot of upstream `main` using its lockfile and workspace configuration. It also inspects failed PR Builder runs created in the last seven days, including their latest attempts, and reports failed `pnpm audit` steps. It never checks out or executes a pull request's code.

## Enable

1. Put this branch in a public fork or copy `.github/security-monitor/` and the workflow into a dedicated public automation repository.
2. Add a small scheduler workflow on the fork's **default branch** that calls this reusable workflow at a pinned implementation commit and passes that same commit as `monitor_ref`. The implementation can stay on `codex/upstream-security-monitor`. Alternatively, deploy the complete monitor to the default branch of a separate automation repository.
3. Enable GitHub Actions. The scheduler only calls this monitor; existing fork workflows have their own triggers.
4. Add the repository variable `SECURITY_MONITOR_ENABLED` with value `true`.
5. Run **Upstream security monitor schedule** manually with `dry_run` checked. Review the `security-monitor-report` artifact and notification previews in the job log.
6. Add the repository Actions secret `GOOGLE_CHAT_SECURITY_WEBHOOK` containing the Chat space's incoming webhook URL. Do not commit it or put it in repository variables.
7. If the fork's default `GITHUB_TOKEN` cannot read upstream job metadata/logs, add `UPSTREAM_READ_TOKEN` with read access to upstream Actions. The token is only passed to the scan job. Public content is still fetched from upstream, not from the fork's potentially stale main branch.
8. Run manually with `dry_run` unchecked to verify delivery, then confirm a scheduled run completes.

Standard runners in a public repository have free runner minutes. Reports are retained for three days; no dependency cache is created. A schedule may be delayed, and GitHub disables public-repository scheduled workflows after 60 days without repository activity. Maintain ownership of the monitor and check its last successful run periodically.

## Notification behavior

- New high/critical main advisories, changed advisory severity/patch metadata, and newly observed CI advisories are reported.
- Findings already reported on main are not reported again for every failing PR. CI-only advisories are deduplicated across runs. The first run inspects seven days of history and can send a backlog of alerts.
- A failed audit step with unavailable advisory details still produces a job link.
- Scan failures produce an operational alert and fail the notification job. An unchanged operational error stays quiet; recovery is reported.
- The main audit honors upstream's configured ignores, matching its CI policy. It does not independently reassess ignored advisories. A disappearance is described as no longer reported, not automatically as fixed.
- An advisory's patch range is labeled as unverified. This phase does not test registry publication, compatibility, or installability.
- Only PR Builder audit-step failures are inspected. Unrelated build/test failures are not security alerts. Runs originally created more than seven days ago, even if rerun recently, are outside the polling window. Pagination is bounded at 1,000 results and fails visibly rather than silently dropping results.

## State and permissions

The scan job has read-only repository permissions and downloads only the upstream manifest, workspace file, and lockfile at an immutable main SHA. It does not install the dependency tree. The pnpm version is pinned; a change to upstream's required version produces a visible error until the workflow pin is updated.

The notification job has write access to the monitoring repository to maintain `state.json` on an isolated `security-monitor-state` branch. This branch starts with no parent and contains no workflow files. It records deduplication state and caches inspected run attempts. Updates use the file SHA to reject concurrent writes. The reusable workflow's concurrency serializes scheduled/manual executions. The scheduler grants the permissions required by both jobs; the scan job explicitly reduces its token to read-only permissions.

State is saved only after all Chat deliveries succeed. Delivery is at least once: an interrupted run after a successful send can repeat a message. Stable message IDs help identify these rare duplicates. State persistence failure fails the workflow; it cannot be reliably reported through the same state store. Keep the monitor's own Actions failure notifications enabled. Do not delete its state branch unless intentionally resetting notification history.

The Chat credential is only available to the notification step. Dry runs send no messages and write no remote state. No upstream credentials with write access are required.

## Local validation

```sh
node --test .github/security-monitor/monitor.test.mjs
node .github/security-monitor/monitor.mjs scan /tmp/security-report.json
DRY_RUN=true node .github/security-monitor/monitor.mjs notify /tmp/security-report.json
```

Set `GITHUB_TOKEN` through your existing credential mechanism for API rate limits/log access. No webhook is needed for the commands above. Use pnpm 11.21.0. Scanner output contains public advisory/run data; no credentials are included.
