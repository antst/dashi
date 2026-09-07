# Two install hazards: mixed prerelease graphs and stale peer dependencies

## Body

- Queued (not yet posted): DSH Discussion on two install hazards: (1) the `@deepseek-ai/dsh` CLI's caret ranges on its own packages resolve a mixed prerelease graph (alpha.5 CLI with rc.1 libraries fails to load); (2) nineteen packages (dsh-attachment, dsh-fs, dsh-shell, dsh-jobs, dsh-sandbox, dsh-compaction, dsh-session-persistence, dsh-session-query, dsh-settings, dsh-code-runtime, dsh-bash-local, dsh-workflow, dsh-spill, dsh-output-retention, dsh-session-telemetry, dsh-session-title-llm, dsh-authorization, dsh-anonymous-user-id, dsh-subagent-in-process-driver) are reached only as peer dependencies, so a user upgrading with an existing lockfile keeps stale versions that pnpm treats as satisfied (proven 2026-09-03: only a node_modules and lockfile wipe refreshed them); suggest a boot-time peer-version check or making them dependencies. Release to the lane when convenient.

Target: DSH Discussion (plain)
