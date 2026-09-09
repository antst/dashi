# Take-once access for launchEnvironment secrets

## Body

- Queued (not yet posted): DSH Discussion (Ideas): ctx.launchEnvironment (packages/util/launch-environment/src/index.ts) is an immutable snapshot, so a plugin that consumes a one-time secret from the environment (the agentbus launch token) cannot remove it and it stays readable to every plugin for the process lifetime; suggest a take-once accessor (read and delete) on the snapshot. Raised by the agentbus plugin work 2026-09-06.

Target: DSH Discussion (Ideas)
