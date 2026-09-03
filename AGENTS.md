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

## Handoff protocol

- Work items live in LEDGER.md as `W-NNN`. The builder takes one at a
  time, in ledger order, and works on a branch named `w-NNN-short-name`.
- Before handing off, run the gate script (`pnpm gate`, once W-001 lands)
  and paste its final summary into the handoff message.
- A handoff message has three parts: what changed (files and behavior),
  gate output, and anything the builder is unsure about or wants to
  discuss. Cite file:line for claims about DSH or pi-tui.
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
