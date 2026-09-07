# Token-meter projection makes cold resume quadratic in session event count

## Body

Cold resume of a large V3 session regressed from about 2.3 seconds on
0.1.2-rc.1 to about three minutes on 0.1.5-rc.2 and 0.1.6-alpha.2. CPU
profiling localizes the growth to the token-meter context-breakdown
projection, not persistence I/O or interrupted-turn repair.

### Reproduction

1. Use a uniform DSH graph at the version under test with JSONL session
   persistence and the ordinary token-meter projection enabled.
2. Generate a valid V3 session containing repeated completed turns. Each turn
   has `turn/start`, a surface-appended `user/message`, a surface-appended
   `assistant/message`, and `turn/end` (four events per turn).
3. Start a new process, resume that session through SessionController, and
   measure from the resume request until the agent is published idle and the
   first view can be rendered.
4. Repeat at 10k, 50k, 100k, and 200k total events. Profile the 50k run with
   `node --cpu-prof`.

Measurements from the same Linux host and generated fixture:

| DSH version | Events | Cold resume |
| --- | ---: | ---: |
| 0.1.5-rc.2 | 10,000 | 1,629 ms |
| 0.1.5-rc.2 | 50,000 | 11,879 ms |
| 0.1.5-rc.2 | 100,000 | 47,246 ms |
| 0.1.5-rc.2 | 200,000 | 183,088 ms |
| 0.1.6-alpha.2 | 50,000 | 11,764 ms |
| 0.1.6-alpha.2 | 200,000 | 183,216 ms |

For comparison, the same 200k-event fixture resumed in about 2.3 seconds on
0.1.2-rc.1. The scaling from 50k to 100k to 200k is approximately 4x for each
2x increase in events.

The 50k CPU profile identifies
`contextBreakdownProjectionDefinition.apply` and `commitSurfaceTokens` as the
hot path. For every surface event,
`packages/llm/token-meter/src/breakdown-projection.ts:56-75` plans against the
current retained nodes, clones `state.nodes`, commits the change, and then
`findLast`-scans the cloned array. With a growing surface this is O(current
surface) work per event and O(n²) over the replay.

The behavior was introduced by upstream commit `6525195953`,
`fix(token-meter): classify surviving prompts in surface order` (2026-09-07),
and remains present at HEAD. Earlier large-session performance reports,
Discussions #928 and #4416, were fixed by commit `0c5aa8110f`, which is already
in 0.1.2-rc.1; this is a later, distinct regression. No existing upstream
report for this regression was found.

Expected: replaying the context-breakdown projection should be linear (or
near-linear) in log size. The projection should avoid cloning and scanning the
entire retained surface for every surface event while preserving its
last-surviving-system classification.

GitHub issues are disabled for this repository, so this should be posted as a
Discussion in the Bug category.

Target: DSH Discussion (Bug)

Priority: high
