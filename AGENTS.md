# dashi: working agreement

dashi is a terminal UI for DeepSeek Harness (DSH), built out of tree as DSH
plugin packages plus a shipped `tui` profile. DESIGN.md is the accepted
design. LEDGER.md is the append-only record of decisions and work items.

Roles: the architect (Claude session) decides and gates. The builder
(dsh-exec) designs details, implements, and tests. The builder proposes;
the architect disposes. Disagreement is welcome; scope creep is not.

## Rules that are not derivable from the code

1. **Completeness is the product; minimalism is the implementation.**
   The user-facing bar is Claude Code's interactive mode: anything a
   developer does there daily must exist in dashi and be no clumsier.
   Remaining gaps must be DSH gaps, named as such, never papered over.
   "Minimal" applies only to dependencies (DSH packages and pi-tui),
   owned state (zero files, one reducer), mechanisms (one process, one
   fold, one queue, one effect runner), code size, and scope (nothing
   that is not about driving DSH from a terminal). The word "minimal"
   never appears in user-facing text; the tagline is "dashi: a terminal
   UI for DeepSeek Harness".
2. **One owner per fact.** DSH owns every durable or behavioral fact.
   dashi keeps only disposable presentation state. No TUI persistence, no
   writable mirror, no cache that writes back.
3. **A growing diagram is a redesign signal.** If a mechanism needs more
   than a few states, more than one lock, a reconciliation loop, retries
   or flags to patch ownership, stop and redesign. Do not patch.
4. **Prefer old, rigid, boring solutions.** Append-only logs, a single
   reducer, one queue, one pure fold, synchronous state. No event bus, no
   generic abstraction with one consumer, no speculative seams.
5. **Reuse before writing.** Call `ctx.sessionController`, `ctx.agents`,
   `ctx.commands`, `ctx.skills`, `ctx.sessionQuery`, permission presets,
   and tool presenters directly. Copying DSH source is allowed only when the
   published package does not export it; state the copy in the ledger and
   keep it minimal.
6. **No fake completion.** TODO markers, skipped tests, stubs, and
   unimplemented branches are blockers, not progress.
7. **Published packages only.** dashi depends on published `@deepseek-ai/*`
   and `@earendil-works/pi-tui` releases at pinned versions, never on a
   source checkout or a fork.

## Mandatory analysis before every change

Owner's verbatim instruction, 2026-09-30:

> ok, now, ANY change require extensive analysis of edge cases and consequences

> this is rule

> record also in AGENTS.md in ALL repos. Also add to it KISS, RCA etc.

This is a mandatory rule, not a preference. It applies to production code, tests, test oracles, configuration, installation, documentation and diagnostics, including changes described as small or defensive.

Before changing anything, record the intended behavior, the existing behavior being preserved, and the affected callers and lifecycle. Trace actual consequences through relevant code and evidence rather than assuming that a helper name, error label or passing test explains them. For each applicable case, analyze normal operation, empty and populated state, boundary races, cancellation, partial success, uncertain outcomes, duplicate/stale events, shutdown, reconnect and subsequent recovery. State why a case is inapplicable instead of silently omitting it.

For messaging changes, explicitly account for connection/presence, inbound and outbound tools, message ownership, never-attempted and attempted/uncertain entries, capacity/accounting, active delivery, idle wake, native session identity, permissions, terminal results and later valid delivery. A missed model-step callback does not itself justify disconnecting, discarding input or disabling future delivery. Still-unattempted input must remain eligible for a later valid step; uncertain native attempts must not be blindly replayed.

Describe user-visible consequences and possible functionality loss. Do not label shutdown, feature removal, delayed delivery or queue disposal a repair merely because it makes a failure explicit. Unresolved behavior changes must remain explicit; existing implementation authority is not authority to silently weaken the owner's requirements.

Obtain independent review of the consequence analysis before adopting the change. Review the actual implementation and meaningful regression evidence before merge/install. Tests must exercise adverse outcomes and continuity, not merely confirm the implementation's chosen behavior. Test-oracle edits require analysis of false PASS/FAIL cases and preservation of historical evidence. A receipt, source inspection or green build alone does not establish working product behavior.

This rule does not require repeated owner permission for already-authorized work. It requires the analysis and review to be performed, recorded and used to guide that work.

## KISS: the smallest sufficient change

Prefer the simplest design that satisfies the complete requirement and preserves tested behavior. Compare the proposed change with the existing supported native capability and the smallest local correction before adding abstractions, queues, state, transports, dependencies, processes or fallback paths. Explain why each addition is necessary and who owns its lifecycle. Fewer lines are not simpler if they hide uncertainty, lose functionality or shift complexity elsewhere. Do not rewrite or change languages by discarding established product knowledge and regression fixes.

## RCA: establish the cause before fixing it

For a defect, reproduce it where feasible and trace the concrete causal sequence through the actual implementation and relevant native version. Separate observed facts, hypotheses and unknowns. Compare against earlier working behavior and retained evidence; challenge claims that native support is absent before designing around them. A symptom, receipt, error label or coincident event is not a root cause. If reproduction is unavailable, state that limitation and what evidence supports the proposed cause. Fix the cause at the smallest appropriate boundary; do not mask it with blanket catches, disconnects, retries, feature removal or weakened tests.

## Preservation and proof

Derive acceptance from the owner's required behavior, not from what the current adapter happens to implement. Preserve existing regression tests, or map each changed test to an equally strong or stronger replacement and explain why. Include failure controls that demonstrate the test can reject the defect. Record exact source/build/configuration provenance and distinguish source findings, mocked tests, native admission and observed native effects. Unrun or ambiguous checks remain unrun or unknown; do not turn them into PASS.

Busy delivery and idle wake are separate requirements. A message delivered at a later model step of the same original active task is delayed active delivery, not automatically a delivery failure; record latency separately. Intentionally holding messages until the task ends does not satisfy active delivery. Retain unsent input for the next valid opportunity, preserve idle wake, and never replay an uncertain native handoff merely to obtain a clean result.

## Scope, coordination and truthful completion

Keep one coordinated writer per source or host change. Preserve other contributors' uncommitted work. Follow repository review and validation gates at the actual proposed commit, and report unresolved findings and behavioral trade-offs before adoption. Keep fixes focused; do not bundle unrelated cleanup or silently replace the native runtime, installation layout, permissions or identity model. Ordinary authorized work should continue without repeated permission requests, but a newly discovered loss of required functionality is not implicitly approved.

After each pushed correction, wait for the configured review bot to start and finish reviewing that exact head. Read the full review, including summary concerns, inline comments and nitpicks. Address every item by fixing it or recording an independently verified refutation and replying; an initial clean summary is not permission to ignore other findings. Merge only after independent review, completed bot review and required CI are clear at the head being merged. Pin the merge to that reviewed head; a mergeable branch or green build alone is insufficient.

Report what actually changed, what was verified, and what remains incomplete. Documentation, a review verdict, a successful build or a receipt cannot substitute for the product behavior the user requested.

## Handoff protocol

- Work items live in LEDGER.md as `W-NNN`. The builder takes one at a
  time, in ledger order, and works on a branch named `w-NNN-short-name`.
- Before handing off, run the gate script (`pnpm gate`, once W-001 lands)
  and paste its final summary into the handoff message.
- A handoff message has four parts: consequence analysis, what changed
  (files and behavior), gate output, and anything the builder is unsure
  about or wants to discuss. Cite file:line for claims about DSH or pi-tui.
- The architect replies with ACCEPT, or with a redesign instruction. A
  redesign instruction names the mechanism to remove, not a patch to add.
- The builder never edits LEDGER.md decision entries. It may append a
  `Builder note:` line under its own work item.
- Commits go on the work branch. After ACCEPT the architect squash-merges
  the pull request into `develop` (one commit per work item; the PR title
  becomes the commit title, so name it `W-NNN: short description`) and
  fast-forwards `main` for releases.

## Verification

Tests run against recorded DSH session logs and, for terminal behavior,
`@xterm/headless` at fixed sizes. PTY end-to-end tests run the real shipped
profile with a recorded model. A feature is done when the ledger's stated
acceptance evidence exists and the gate passes, not when the code compiles.
