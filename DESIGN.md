# dashi: product and technical design

dashi: a terminal UI for DeepSeek Harness

Status: implemented for `0.1.0-alpha.2`
Date: 2026-09-03
Targets: DSH `a66e4702`, `@earendil-works/pi-tui` `0.84.4`
Principles: KISS, DRY, no speculative abstractions

## 1. Decision

Build the TUI out of tree as ordinary DSH plugin packages and ship a `dashi`
profile. After installation, the product starts with:

```text
dashi
```

The profile runs a complete interactive coding agent in the foreground DSH
process. It mounts DSH's transport-neutral Session Controller and uses DSH
services for agents, sessions, history, tools, permissions, commands, models,
skills, questions, plans, and persistence. It does not speak ACP to itself,
start a browser, maintain another conversation store, or add a sidecar.

No DSH-core change is required. `@antst/dashi-launcher` only execs
`dsh --profile dashi`; the same spelling remains available directly or through
the shell alias documented in the README.

Four decisions define the design:

1. **One foreground process.** The launched profile owns the terminal and its
   roots for the real process lifetime.
2. **One domain authority.** DSH owns every session, title, message, queue,
   permission, model, tool, plan, usage, and workspace fact. TUI state is
   disposable presentation state.
3. **Existing host API first.** Mount and call `ctx.sessionController`;
   do not extract or copy the Web controller.
4. **Small stock renderer.** Pin vanilla `@earendil-works/pi-tui`; implement
   DSH terminal components, not another framework or a patched fork.

The interface is a calm working document: conversation first, compact inline
activity, a strong multiline composer, and temporary overlays only on request
or when a decision is required. The completeness target is Claude Code/Codex
daily-driver functionality, not a streaming-text demo.

## 2. Scope and verified DSH capabilities

This design was checked against:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) at
  `a66e4702047846cdaa10c66c9d3df3951f5ea70d`;
- [`@earendil-works/pi-tui`](https://github.com/earendil-works/pi/tree/main/packages/tui)
  `0.84.4` at `e266507b606b9552fa277252644054afd4384b11`;
- current Claude Code and Codex CLI interactive behavior;
- the current external-integration requirements supplied by the owner.

The implementation relies on these existing DSH facts:

- `SessionEvent` is the append-only durable transcript authority.
- `ctx.agents` owns live Agents and publishes native
  `agent/created`, `agent/disposed`, and `agent/status` events.
- `Agent.followup()` and `Agent.steer()` accept addressed `UserMessage`s and
  wake the exact idle root; `Agent.cancel({kind:'user'}, {keepInbox:true})`
  interrupts without losing queued input.
- `ctx.sessionController` is a Typert Host service, not Web transport code. It
  provides cold-safe session list/search, history pages/following,
  create/adopt, fork, rename, model catalog/selection, skill catalog,
  queue control, prompt admission, and cancellation.
- `ApiSessionList` already implements bounded blank probing. Its `running`
  field is derived from the current process's Agent registry.
- `ctx.sessionController.fork()` selects the completed `turn/end` boundary and
  creates the child through `ctx.agents.create()` with the correct seed,
  inherited count, lineage, and `isSeeded` metadata.
- `ctx.sessionQuery.searchSessions()` and `searchEvents()` use the base
  bundle's SQLite FTS backend.
- `ctx.commands.execute(agent, line, images, signal)` owns parsing and takes the
  complete submitted line. `ctx.commands.find()` is sufficient for completion
  labels.
- Session titles are durable `session/title` events, mutated through the
  native title/controller API.
- Permission presets are data. In particular, `danger-full-access` resolves to
  `approval: 'never'`; the preset service itself has no confirmation UI.
- Tools own `presentCall` and `presentResult`; the terminal must not infer a
  tool's meaning by inspecting arbitrary arguments.

The former in-tree TUI was removed because it had no shipped composition and
had become a product-sized unowned surface. This proposal does not revive or
extract that implementation.

## 3. Product contract

### 3.1 Daily-driver workflows

- Start a fresh durable session with one command and display its full,
  product-issued Session UUID near startup.
- Start with a native title; rename later through the same DSH title service.
- Resume only by an exact Session UUID, or select from a list containing UUID,
  title, cwd, and update time.
- Reject title resolution when it matches zero or more than one session.
- Stream Markdown, provider-visible reasoning, tool calls/results, diffs,
  plans, tasks, jobs, subagents, usage, errors, and queued input without
  flicker.
- Interrupt, steer the active turn, or queue a later turn as three visible
  actions.
- Answer approvals and structured questions without leaving the terminal.
- Select model, effort, and permission preset through native DSH services.
- Search and navigate large transcripts; inspect and copy full content.
- Fork/rewind conversation without rewriting its source. Files remain
  unchanged because DSH exposes no native workspace rollback.
- Work in ordinary terminals, SSH, tmux, screen, and accessible/monochrome
  environments without browser-only control.
- Load normal external DSH plugins, including commands, tools, presenters, and
  plugins that need the exact terminal-bound root.

### 3.2 Feature and phase map

| Workflow | Behavior | Phase |
|---|---|---|
| Chat | multiline composer, streaming Markdown/reasoning | A |
| Tools and diffs | presenter-owned compact cards and detail view | A |
| Control | interrupt, steer, explicit next-turn queue | A |
| Decisions | approvals, questions, plan review | A |
| Sessions | new, exact resume, picker, title/rename | A |
| Models and permissions | searchable native pickers and visible status | A |
| Root hosting | exact accessor, replacement event, native lifecycle | A |
| Navigation | lazy scroll, search, expand, copy | B |
| Completion | native commands/skills and workspace paths | B |
| Recall | current and same-cwd prompt history through DSH query | B |
| Conversation rewind | source-preserving native fork | B |
| Images | composer attachments and supported terminal display | B |
| Terminal ergonomics | inline/accessibility, editor, stash, copy | B |
| Human shell | bounded sandbox-policy execution with closed stdin | B |
| Plans/jobs/subagents | compact status and on-demand detail | A/B |
| Hardening | cross-platform PTY, hostile output, performance | C |

### 3.3 Non-goals

- IDE panes, file tree, embedded terminal emulator, Git UI, or permanent
  dashboard.
- A TUI protocol, daemon, browser bridge, ACP loopback, or second runtime.
- Any TUI-owned database for sessions, titles, prompts, messages, search,
  permissions, queues, checkpoints, or file history.
- Destructive session truncation or inferred file rollback.
- A public widget SDK or theme/layout marketplace.
- Tool cards based on argument-name heuristics.
- Fuzzy or first-match title resume.

## 4. Simplicity and ownership

### 4.1 Rules

- Call the existing DSH service before writing code.
- Store only disposable view state: focus, scroll, expansion, draft, overlay
  selection, and bounded rendered lines.
- Never serialize `ViewState`; rebuilding it from DSH and terminal dimensions
  must always be possible.
- A missing domain capability is unavailable or is proposed upstream
  separately. It is not recreated in the terminal.
- A small TUI service is allowed only for a fact foreign to DSH. In v1 the
  sole example is “which DSH root is bound to this terminal.”
- No facade package, internal event bus, reconciliation loop, or generalized
  extension system.

Before implementing a feature, enumerate:

1. its single owner;
2. successful input/output;
3. cancellation, failure, replacement, and terminal-loss edges;
4. whether anything persists and why DSH cannot own it.

If the answer requires two writers, synchronization, or a growing state
diagram, redesign the ownership. Prefer removing an edge by construction.

### 4.2 Authority map

| Concern | DSH owner used by the profile | TUI-owned delta |
|---|---|---|
| Session operations | `ctx.sessionController` | picker and launch parsing |
| Durable transcript | Session Controller history + `SessionEvent` | terminal cell fold/layout |
| Commands | `ctx.commands` | completion and terminal commands only |
| Skills | Session Controller/`ctx.skills` | labeled completion |
| Models | Session Controller catalog/selection | searchable picker |
| Permissions | `ctx.permissionPresets` | picker and safety confirmation |
| Queue/control | exact `Agent` methods/status | visible composer mode |
| Tools/diffs | events + tool presenters | card layout/expansion |
| Search/history | `ctx.sessionQuery` | current-cwd result presentation |
| Questions/approvals | native request/responders | focused decision overlay |
| Plans/jobs/subagents | native events/projections | compact terminal rows |
| Current terminal root | none | `ctx.tuiRoot` pointer and one event |

The TUI has no persistent store. A future terminal-only preference may persist
only if it mirrors no DSH fact and has exactly one owner. Temporary mode-0600
editor files are transient I/O, not persistence.

## 5. Profile and command-line contract

### 5.1 Installation and launch

The distribution contains `@antst/dashi` in `packages/dashi`, the
`@antst/dashi-app` bundle in `packages/dashi-app`, and the exec-only
`@antst/dashi-launcher` in `packages/dashi-launcher`. A normal DSH plugin
installation creates/composes the named profile:

```text
pnpm install @deepseek-ai/dsh@0.1.2-rc.1 @antst/dashi-launcher
dsh plugin --profile dashi add @antst/dashi-app
dashi [TUI_ARGS...] [PROMPT]
```

The first two commands install DSH and the profile. Every later session is one
ordinary terminal command. DSH launcher flags precede the app boundary; TUI
arguments arrive through `ctx.cmdlineArgs` and are parsed by the TUI app plugin.
Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease. When upgrading DSH, remove `node_modules` and
the lockfile before installing so pnpm cannot retain stale peer-only DSH
packages. dashi validates each DSH release before adopting it, and its packages
pin DSH dependencies exactly.
Without `@antst/dashi-launcher`, `dsh --profile dashi` or the shell alias
`alias dashi='dsh --profile dashi'` is the equivalent launch form.

```text
dashi [PROMPT]
  -n, --name TITLE
  --agent PRESET
  --session-id UUID
  -r, --resume [NAME|UUID]
  --all                    # include every cwd in the resume picker
  -c, --continue
  --fork-session           # branch the resume/continue target
  -C, --cwd PATH
  --provider ID
  --model ID
  --effort ID
  --permission PRESET
  --yolo | --dangerously-skip-permissions
  --image PATH              # repeatable
  --fullscreen | --inline  # inline is the default
  --no-color
  --accessible
```

Fresh start, `--resume`, and `--continue` are mutually
exclusive. Bare `--resume` opens the current-cwd session picker (`--all`
widens it to every cwd); `-r` and `-c` are aliases for `--resume` and
`--continue`. These flags affect startup; DSH remains the owner of any durable
effect. `--agent` and `--session-id` belong to fresh creation; `--fork-session`
passes the resolved resume/continue target through DSH's native fork first.
Launch model and effort flags apply DSH's native selection before
the first prompt; like `/model`, DSH also saves that selection as its default
because it does not expose session-only selection. dashi stores no setting and
does not restore the prior default. A `PROMPT` starts or resumes an interactive
session and submits its first turn after any picker selection.

`--provider` disambiguates a model ID present in more than one catalog group.
`--permission` applies the native `/permission` command at startup. `--yolo`
and `--dangerously-skip-permissions` are explicit-consent aliases for
`--permission danger-full-access`, so they do not add a launch confirmation.

`UUID` in this interface means DSH's complete product `SessionId` (currently
`session-` plus the generated UUID), not an accepted prefix. An ID-shaped value
resumes exactly. Every other value matches DSH's native title exactly, then by
case-insensitive substring; one match resumes and multiple matches open the
existing picker. Names are not unique and dashi stores no name index.

`--continue` selects the most recently updated ordinary root in the requested
cwd, with UUID as deterministic tie-breaker, then performs the same exact
controller resume as `--resume`. DSH at the pinned revision has no
cross-process writer ownership, so dashi cannot detect or reject a concurrent
resume and adds no lock, PID file, retry, or shadow ownership state.

The app refuses full interactive startup without a controlling TTY. It never
emits control sequences into a pipe. Inline mode is the default and uses the
main terminal buffer as an append-only document: the whole loaded transcript
plus live suffix reaches pi-tui, committed rows enter native scrollback, and
mouse tracking stays off. PageUp and Ctrl+Home open history inline.
`--fullscreen` selects the application-owned alternate-screen viewport.

### 5.2 Early identity and native name

Startup order is:

1. parse/validate app arguments before raw mode;
2. boot the profile and mounted capabilities;
3. list cold sessions for bare or named `--resume`, waiting for a selection on
   bare or duplicate matches; call `ctx.sessionController.create({cwd, ...})`
   for a fresh session, or `ctx.sessionController.resolveAgent(exactId)` for
   native resume;
4. resolve/bind the exact live Agent returned or registered by that call;
5. apply `--name` through `ctx.sessionController.rename()` for a fresh session;
6. await `ctx.sessions.flush(root.session)`;
7. bind `ctx.tuiRoot`, emit `tui/root-changed`, and render the first frame.

The first frame shows the complete product-issued ID, title if present, and
cwd. A shortened ID may appear after startup, but is never accepted as resume
authority. `/rename TITLE` uses the same native rename then flushes before
reporting success.

### 5.3 Profile-provided session list

The TUI app parser also provides:

```text
dsh --profile dashi sessions list [--cwd PATH | --all] [--json]
```

This is a command of the out-of-tree profile, not an `apps/cli` modification.
The command boots only the services required for a cold list, calls
`ctx.sessionController.list({}, signal)`, prints `UUID`, `TITLE`, `CWD`, and `UPDATED`,
then exits through `ctx.appExit`. Its stable JSON envelope is:

```json
{
  "version": 1,
  "sessions": [
    {
      "sessionId": "session-08d3bde2-40df-4d80-9de3-11d8fcf4f12f",
      "title": "Fix cache invalidation",
      "cwd": "/work/project",
      "updatedAt": "2026-09-02T10:22:31.451Z"
    }
  ]
}
```

`running` is deliberately absent: a separate list process can know only its
own Agent registry, not whether another process owns the session. Title may be
`null`; a legacy missing cwd is represented as absent, never invented.

## 6. Interaction design

### 6.1 Layout and visual language

```text
 dashi  Fix cache invalidation  session-08d3…  ~/work/project
 ─────────────────────────────────────────────────────────────────────

 You
 Find the stale-cache race and fix it. Add a regression test.

 ● Read packages/cache/src/store.ts                         142 lines
 ● Edit packages/cache/src/store.ts                         +14  -6
 ● Test pnpm test cache                                      passed

 Assistant
 The race was caused by returning the stale entry after the version check…

 ─────────────────────────────────────────────────────────────────────
   Ask a follow-up…
 ─────────────────────────────────────────────────────────────────────
   workspace-write · deepseek-chat/high · 42% context · Enter send · F1 help
```

DSH owns every fact shown in the header. There is no Git branch because this
profile does not mount or own a branch fact.

Use the terminal background, one accent, semantic success/warning/error, and
diff green/red. Avoid nested boxes, decorative chrome, and indispensable
animation. Respect `NO_COLOR`; retain ASCII status markers in monochrome and
accessible modes. Sanitize model, path, title, tool, and plugin text before it
reaches pi-tui.

Under 72 columns, identity moves to a second line. Under 48, show title or full
ID with `/status` retaining all details. Full-screen mode refuses dimensions
below 32 columns or 8 rows with an inline-mode hint.

### 6.2 Transcript

Cells are keyed by durable event range or live identity:

- human and plugin input, with source/provenance;
- Markdown assistant output and provider-visible reasoning;
- presenter-backed tool call/result, diff, and command rows;
- plan/todo, approval/question outcome, job/subagent, error, and notice rows.

Tool output is compact by default: first 12 and last 8 lines plus an omitted
count. Detail opens in a scrollable overlay; the durable session remains the
only full log. Hidden reasoning is never reconstructed.

`/history` opens a cell browser. Arrows select, Enter expands, `/` searches,
`y` copies trusted plain text, and Escape returns to the composer. `Ctrl+O`
cycles every tool card through collapsed, expanded, and hidden modes. Mouse
actions are optional shortcuts to the same commands.

### 6.3 Composer and recall

The 2–8 row composer uses pi-tui's editor buffer and supports Unicode/IME,
bracketed paste, portable readline editing, input undo, `Ctrl+J` newline,
attachments, and terminal-supported modified Enter keys.

Up/down traverses human prompts in the current session and, at its boundary
or in a fresh session, continues through prior sessions in the same cwd.
`Ctrl+R` searches human prompts across sessions in the current cwd. Both use
`ctx.sessionQuery.searchSessions/searchEvents` and the base SQLite FTS backend;
there is no history file or TUI search index.

Completion opens live for `/` at line start and `@` tokens, labels commands
from `ctx.commands`, invocable skills from the native skill catalog, and paths
rooted at the Session cwd, and narrows prefix matches before substring matches.
Tab inserts a selection. Enter executes a selected command that needs no input;
otherwise it inserts the selection.

Skill discovery remains DSH-owned: project `.dsh/skills` and `.agents/skills`,
configured roots, `$DSH_HOME/skills`, and `~/.agents/skills`. A leading `/name`
skill token is ordinary prompt text that DSH's skill tool expands.

On submission the TUI passes the entire line and images to
`ctx.commands.execute(agent, line, images, signal)`. If it returns `undefined`,
the same submission is normal prompt input. The TUI uses
`ctx.commands.find()` only for completion and labeling; it has no competing
slash parser and no special “otherwise empty submission” rule.

`Ctrl+S` stashes/restores one process-local draft. `Ctrl+G` edits text through
`$VISUAL`, then `$EDITOR`, using one mode-0600 temporary file; attachments
remain explicit.

A literal `Ctrl+V` with no bracketed-paste text asks `pngpaste` then
`osascript` on macOS, or `wl-paste` then `xclip` on Linux, for a PNG and sends
the bytes through the same DSH attachment path. dashi bundles no helper.

While work runs, the footer exposes `steer` or `next turn`; `Ctrl+T` toggles:

| Root state | Mode | Enter |
|---|---|---|
| idle | either | `Agent.followup(message)` |
| running | steer | `Agent.steer(message)` |
| running | next turn | `Agent.followup(message)` |

### 6.4 Keyboard and collision rules

| Key | Context | Action |
|---|---|---|
| `Enter` | composer | submit with displayed mode |
| `Enter` | startup or `/resume` picker | resume the selected exact session; submit any launch prompt |
| `/` | start of composer line | open and filter command/skill completion |
| `@` | composer token | open and filter path completion |
| `Tab` | completion | insert selected completion |
| `Ctrl+J` | composer | newline |
| `Ctrl+T` | running | toggle steer/next-turn |
| `Esc` | running, no overlay | interrupt, keep inbox |
| `Esc Esc` | idle, empty composer | rewind picker |
| `Esc` | overlay | close/cancel |
| `Ctrl+C` | running | interrupt and preserve any draft |
| `Ctrl+C` | idle, nonempty composer | clear draft |
| `Ctrl+C` twice within two seconds | idle, empty composer | exit |
| `Ctrl+D` twice within two seconds | idle, empty composer | exit; shares the Ctrl+C arm |
| `Ctrl+F` | any non-decision focus | open transcript search; preserve draft |
| `Ctrl+O` | no decision | cycle global tool-card mode |
| `Ctrl+B` | no decision | job and subagent details |
| `Ctrl+V` | composer, no decision | paste an image through an installed platform helper |
| `Ctrl+L` | no decision | full redraw |
| `Shift+Tab` | no decision | permission picker/cycle |
| `Ctrl+Z` | Unix, no decision | cooked-terminal suspend/resume |
| `F1` | any non-decision focus | help |

`?` is ordinary input, including at the start of an empty composer. Help is
F1-only, so a message beginning with `?` is never blocked.

An approval or question preempts any non-decision overlay: the disposable
overlay closes and the decision receives focus. Decisions themselves remain
FIFO and are never covered by another overlay.

Changing to a preset whose resolved policy has `approval: 'never'` opens a
TUI-owned confirmation showing the effective sandbox and approval policy. The
preset package supplies data and mutation only; this document does not claim
that native `/permission` supplies confirmation semantics.

### 6.5 Commands

Reuse a native command when one exists. TUI-specific commands are limited to
terminal operations and orchestration of existing services:

```text
/help  /status  /new  /clear  /reset  /resume  /continue  /fork  /branch
/rewind  /rename  /model  /effort  /permission  /config  /login  /logout  /agents  /queue  /context  /memory  /diff
/plugins  /plugin  /tasks
/history  /export  /copy  /exit  /quit
```

Command registration, collision, execution, and logging remain
`ctx.commands` behavior. `/clear` aliases `/new`; `/reset`, `/continue`,
`/branch`, and `/quit` reuse `/clear`, `/resume`, `/fork`, and `/exit`;
`/effort` reuses native model selection; `/agents` selects a native
agent preset; `/config` reads and updates DSH's settings provider; `/login` and
`/logout` use DSH's authorization flows and credential records; `/context`
reads the token-meter estimate; `/memory` opens DSH's loaded instruction files;
`/diff` shows working-tree or last-turn changes; `/tasks` opens native
job/subagent details;
`/plugins` reads DSH's plugin inventory; `/plugin` runs the current profile's
DSH CLI; `/export` writes controller history as Markdown.

Phase B adds `!command` as a deliberately small human shell escape:

- it requires an idle root and calls `ctx.shell.run()` with the current
  Session's resolved `ctx.sandboxPolicy`;
- stdin is closed, the deadline is 30 seconds, and stdout and stderr are each
  capped at 32 KiB; a command waiting for input receives EOF;
- it is outside the model-tool approval path because the human directly asked
  for it; the resolved sandbox still applies, so `git status` does not ask the
  user to approve their own command while forbidden writes remain forbidden;
- command, capped stdout/stderr, exit status, and timeout become one durable
  `Agent.inject()` message with source
  `{kind:'plugin', plugin:'dashi', form:'notice', summary}`;
- injection does not wake a turn; the result is available to the next admitted
  step and is flushed before “recorded” is shown.

dashi does not pre-classify interactive or background commands. A timeout
suggests suspending dashi with `Ctrl+Z` before running an interactive program;
detached processes are unmanaged. The shell cell never claims its filesystem
effects are reversible.

Outside accessible mode, the terminal rings once when a decision arrives while
the root is running and once when a turn ends after at least 10 seconds. Each
triggering event rings at most once; accessible mode never emits an audible
bell.

### 6.6 Approvals and questions

One FIFO decision queue contains borrowed DSH request identities; it stores no
outcome. Its overlay shows exact action/arguments, cwd/resource, current
preset, reason, and only response choices the native request supports. Terminal
loss rejects or marks unavailable, never grants.

Structured questions support batches, selection, custom text, and external
editing. Answers use the existing responder/waterfall. There is no second
promise registry.

## 7. Session, root, and process lifecycle

The screen has one exact current root. DSH may have other live roots, and every
root retains native per-Agent lifecycle. Switching the terminal binding must
not fabricate an Agent disposal.

The only missing fact is the terminal binding, so `@antst/dashi` provides:

```ts
interface TuiRootContext {
  current(): Agent | undefined
}

interface TuiRootChanged {
  readonly previous: Agent | undefined
  readonly current: Agent | undefined
}
```

`ctx.tuiRoot.current()` is a read-only accessor over the application's pointer.
`tui/root-changed` fires after that pointer changes. These public types are the
entire host extension surface; renderer components and reducer state stay
private.

Binding rules:

- initial: controller create/adopt and required flush succeed, pointer changes,
  then `tui/root-changed(undefined, current)` fires;
- replacement requires an idle root and offers to interrupt first; candidate
  creation/adoption succeeds, pointer changes, then
  `tui/root-changed(previous, current)` fires; the previous root remains
  registered and idle under the controller until profile teardown;
- failure before the swap leaves the previous root current;
- exit: admissions stop, pointer clears,
  `tui/root-changed(current, undefined)` fires, then profile disposal owns
  native Agent teardown and emits the real `agent/disposed` events;
- unexpected native disposal of the bound Agent clears the pointer once.

The profile may briefly or intentionally contain multiple roots. Consumers use
native `agent/created`/`agent/disposed` for each root and
`tui/root-changed` only for terminal selection.

The foreground process remains alive while the TUI is attached. `/exit` and
signals request shutdown through `ctx.appExit`; success is reported only after
active work is cancelled/drained as required, session flush settles, the
profile tree disposes, and terminal state is restored.

## 8. Fork and rewind

Rewind changes conversation history only:

```text
Branch from “Find the stale-cache race…” at 10:14?
Files will not be changed.
```

The complete algorithm is:

1. pick a stable displayed event boundary;
2. call `ctx.sessionController.fork({sessionId, atSeq})`;
3. resolve the returned Session ID to its exact Agent and switch through
   section 7.

The controller owns completed-turn selection, seed balancing, lineage, ID
minting, child publication, and workspace attachment. `/fork` uses the latest
completed boundary. The original remains durable and resumable.

DSH at the pinned revision has no native reversible workspace history.
Therefore the TUI creates no snapshots, mutation journal, Git transaction, or
diff-derived rollback. A future DSH-owned rollback command would appear
through the ordinary command/result path.

## 9. Runtime architecture

### 9.1 Profile composition

The `dashi` profile mounts the normal base bundle plus:

- the agent-preset package with `standard` as default and the same preset-owned
  agent-plane rows disabled by DSH's Web bundle;
- Session Controller and its existing Host dependencies;
- the TUI app/lifecycle plugin;
- the pi-tui renderer adapter;
- optional ordinary DSH plugins selected by the operator.

A drift test compares dashi's patch changes, disabled rows, and upstream inserts
with the installed validated DSH base and Web patches.

The direct path is: terminal input → TUI action/effect → exact DSH service;
DSH event/status → TUI reducer → pi-tui frame. There is no transport or event
bus between the profile and DSH.

### 9.2 Out-of-tree packages

```text
packages/dashi/                 @antst/dashi
  src/application.ts       lifecycle and effects
  src/state.ts             actions, pure reducer, selectors
  src/transcript.ts        pure SessionEvent slice -> cells
  src/input.ts             key contexts/composer actions
  src/renderer.ts          pi-tui composition and terminal cells
  src/tui-root.ts          generic terminal-root host contract
  src/terminal-guard.ts    acquisition and idempotent release
  tests/

packages/dashi-app/             @antst/dashi-app
  cordis.patch.yml         installable DSH bundle patch

packages/dashi-launcher/        @antst/dashi-launcher
  bin/dashi.js             zero-dependency dashi command
```

All three packages live in this repository, not under DSH's `packages/terminal`
(which is PTY tooling) or any DSH monorepo path. Do not add `tui-core`,
`protocol`, `client`, `server`, `widgets`, or `sdk` packages.

The app bundle declares the DSH bundle patch in its package manifest, so
`dsh plugin --profile dashi add ...` composes it through the supported plugin
mechanism. `@antst/dashi` keeps pi-tui as its direct dependency and publishes
DSH service imports as peer dependencies, binding the profile's single DSH
registries instead of installing a second copy. Packed-package installation is
part of the release gate.

### 9.3 State and effects

```ts
interface ViewState {
  root: RootView
  transcript: TranscriptView
  live: LiveTailView
  composer: ComposerView
  modal: DecisionView | OverlayView | null
  status: StatusView
}

function reduce(state: ViewState, action: UiAction):
  [ViewState, readonly UiEffect[]]
```

There is one reducer and one effect runner. Components never mutate DSH.
Effects resolve the exact current Agent before create/adopt, send, command,
decision, query, clipboard, or shutdown work. Async completions carry request
IDs; the reducer ignores stale results after root replacement. DSH events are
adapted to actions at one boundary.

### 9.4 Transcript fold and lazy history

`packages/client/ui-chat/.../event-projection.ts` contains useful pure helpers:
`contextForm`, `contextProvenance`, `sessionRecallLabels`,
`toAssistantBlock(s)`, `emptyAssistantBlock`, `displayFailure`, and
`isTokenDelta`. At the pinned release they are not publicly value-exported in
the published package. Phase A neither imports private source paths nor copies
that file.

V1 owns one pure, terminal-specific function:

```ts
function foldCells(events: readonly SessionEvent[]): readonly TerminalCell[]
```

It groups only event relationships forced by the durable log: user/plugin
messages, assistant chunks/final messages, tool call/result pairs,
command run/done pairs, turn outcomes, and decision outcomes. It has no class,
service, cache, event bus, persistence, or browser/client types and stays under
a few hundred lines. Recorded Session logs are its conformance fixtures. If
tool grouping or chunk rules begin growing optional branches, stop and
redesign rather than reproducing `UiConversation`.

The TUI does not use
`ui-conversation/.../assembly.ts`: `UiConversation extends Service`, imports
client types, maintains bindings/stores, and is not lazy over a 200k-event log.

History comes from `ctx.sessionController.page()` and `follow()`. The fold sees
only the loaded chronological slice plus the live tail. The renderer owns a
bounded line cache keyed by `(cell, width, expansion, theme generation)`.
Full-screen mode materializes the viewport plus overscan. Inline mode gives
`TuiMainScreen` the whole loaded chronological transcript plus the live suffix,
so committed rows enter terminal scrollback once while streaming coalesces
changes to the mutable suffix.

An optional upstream PR may publicly export the pure ui-chat helpers. After
that release the TUI can import the applicable helpers directly and delete
equivalent lines. That PR is not a Phase A or release gate.

### 9.5 Scheduling

- Keys and decisions request an immediate frame.
- Stream chunks coalesce to at most 30 frames/s.
- Resize invalidates width-dependent lines once.
- Status clocks update at most once/s.
- No timer survives application disposal.

### 9.6 Renderer and terminal release

Use unmodified pi-tui `0.84.4`: `TuiAltScreen` for full screen,
`TuiMainScreen` for inline, and its editor/Markdown/overlay primitives.

The deleted DSH TUI patched its pinned pi-tui dependency only to add a
frameless Editor, embedded equal-width first/continuation prompt prefixes, and
the resulting different wrap/navigation widths, as recorded in the
[archived DSH editor note](https://github.com/deepseek-ai/deepseek-harness/blob/49a606bc5b5934603f22a26957a07dc799ab0291/.agents/notes/archived/feature/2026-07-24-tui-shell-prompt-editor.md).
Pi-tui `0.84.4` does not contain that patch, and this design does not need it:
the stock editor keeps its own frame and the TUI renders prompt/status as
sibling components. No patch or fork is shipped.

`TerminalGuard` owns raw mode, bracketed paste, cursor, mouse, synchronized
output, alternate screen, capability-query listeners, and timers. One
idempotent disposer handles normal exit, partial boot, exceptions, SIGINT,
SIGTERM, editor/suspend handoff, and broken output.

The 2026-07-31 DSH “fail-loud releases the terminal” incident is a release
requirement, not merely history. Once any plugin acquires terminal state, every
later profile-boot failure must print the original diagnostic, invoke the
launcher's bounded fail-loud/profile-root release, drain pending terminal-query
responses while input is still controlled, stop pi-tui, and restore modes
before nonzero exit. A PTY test must prove the following shell receives no
Device Attributes bytes and needs no `stty sane`.

External editor and Unix suspend share one cooked-terminal helper: leave
raw/full-screen state, run or suspend, then reacquire and force a full redraw.

## 10. Capability behavior

| Feature | Call/read | Important edge |
|---|---|---|
| New/resume | controller create/resolveAgent | exact ID; DSH has no cross-process writer lock |
| Rename | Session Controller rename + session flush | no success before durability |
| Prompt/control | exact Agent followup/steer/cancel | busy and queue mode visible |
| Commands | `ctx.commands.execute` | whole-line owner; undefined means prompt |
| Models | controller catalog/select | no copied catalog |
| Permissions | preset resolve/set | TUI confirms `approval:'never'` |
| Tools/diffs | native events/presenters | generic fallback only |
| Search/recall | `ctx.sessionQuery` | current-cwd scope, no second index |
| Fork/rewind | controller fork | conversation only |
| Root replacement | `ctx.tuiRoot` event | not a disposal event |

If a selected profile capability is absent, hide the action or show a precise
unavailable reason. Never approximate it with terminal persistence.

## 11. Generic host contract

Agent Sessions is one intended consumer, but its adapter, transport, presence,
name resolution, busy policy, tools, packaging, and end-to-end tests live in
its own repository. This repository ships a standalone generic TUI
and only the following DSH-facing contract, usable by any ordinary plugin:

- a stable product Session ID exists before the first frame;
- native title, exact resume, and list remain DSH-owned;
- `ctx.tuiRoot.current()` returns the exact currently displayed Agent;
- `tui/root-changed` reports exact previous/current bindings;
- native `agent/created`, `agent/disposed`, `agent/status`, `session/title`,
  and session events remain observable without TUI mirrors;
- a plugin calls `followup()` or `steer()` on that exact Agent; input wakes and
  renders through normal DSH paths without fabricated keystrokes;
- busy status and the caller's steer/follow-up choice remain explicit;
- plugins may register finite-schema, promptless DSH tools with structured
  results and presenters; the TUI uses the normal registry and generic
  fallback;
- all launch options remain ordinary arguments after `dashi` or
  `dsh --profile dashi`, and
  operation requires no browser.

No widget API or integration-specific ingress method is added.

## 12. Performance gates

| Gate | Requirement |
|---|---|
| Composer latency | p95 <16 ms normally and <25 ms with a 200k-event session |
| Streaming | ≤30 frames/s, bounded pending work, no forced scroll |
| Large resume | usable view <3 s for 200k events/2k tool cells after DSH load |
| Bounded UI | warm 1k-session first rows <150 ms; line cache ≤64 MiB |

Fixtures include large tool output, chunk storms, long strings, CJK,
combining marks, emoji, and hostile terminal escapes. DSH persistence load time
is reported separately from render time.

## 13. Reliability, security, and accessibility

- Treat every rendered value as untrusted. Strip C0/C1 and ANSI
  CSI/OSC/DCS/APC/PM sequences except permitted newline/tab.
- Content cannot set titles, hyperlinks, clipboard, or image protocols
  directly. Copy is explicit, size-capped, and allowlisted.
- Approval failure, missing responder, terminal loss, sandbox unavailability,
  title-flush failure, and root-preparation failure fail closed.
- Interrupted tools with unknown external outcome are labeled `unknown`.
- Only native session/persistence services write durable facts.
- `--accessible` disables animation, mouse, and color-only meaning; uses a
  linear reading order and announces overlay title/count/selection/actions.
- Every mouse action has a key/command equivalent. Unsupported images show
  alt text/path. Accessible mode defaults to inline rendering.
- Inline mode leaves wheel and selection to the terminal. Full-screen mode
  enables pi-tui mouse tracking; each wheel notch moves three transcript lines,
  while PageUp/PageDown and Ctrl+Home/Ctrl+End remain equivalent controls.

## 14. Testing

### 14.1 Phase A

- Unit-test the reducer, key collisions, whole-line command dispatch, decision
  preemption, permission confirmation, exact title resolution, root binding,
  and the pure transcript fold against recorded DSH logs.
- Semantic-screen tests cover wide/narrow, color/monochrome, stock editor,
  streaming tail, tool cards, approvals, questions, pickers, and hostile text.
- Real PTY tests boot the installed `dashi` profile with a deterministic model
  and cover fresh/named start, flush, exact resume,
  rename, model/permission changes, interrupt/steer/queue, resize, clean exit,
  failed boot after terminal acquisition, signals, and broken stdout.

### 14.2 Phase B

- Extend the same PTY suite for fork/rewind, lazy history/search, cross-session
  prompt recall, completion, images, inline/accessibility, `!command`, external
  editor, stash, copy, suspend/resume, and large-session gates.
- Run one small Cordis fixture plugin: attach late, read the exact current root,
  observe exact root-change pairs across `/new` and `/resume`, inject addressed
  input, and
  register one structured tool/presenter. It has no external adapter
  dependency.

Phase C verifies xterm, tmux, GNU screen, Linux-console, and dumb capabilities
on Linux, and runs shutdown fault injection plus dependency-upgrade and
clean-package-install gates. macOS is supported by design but was not available
for the automated release run.

## 15. Delivery

### Phase A — usable chat

- Publish/install the three out-of-tree packages and shipped profile bundle.
- Parse `dsh --profile dashi` app arguments; enforce the terminal guard.
- Deliver streaming, Markdown, tool cards/diffs, approvals/questions,
  interrupt/steer/queue, new/resume/picker/rename, model and permission
  pickers, exact root accessor/event, and native session list.
- Mount and call Session Controller; ship the small pure terminal fold.

Exit gate: an installed profile completes a recorded coding turn and exact
resume in a PTY, while every injected startup/shutdown failure restores the
terminal. There is no DSH-core patch, TUI database, or private Web import.

### Phase B — daily-driver beta

- Add fork/rewind, completion, history/search and same-cwd recall, images,
  inline/accessibility, human shell, external editor, stash, copy,
  plan/job/subagent detail, and large-session optimization.
- Run the generic host-contract fixture.

Exit gate: normal development can stay in the terminal for two weeks without
falling back to Web for a TUI-owned workflow. Missing DSH capabilities remain
clearly unavailable.

### Phase C — hardening

- Complete platform/terminal, performance, accessibility, hostile-output,
  packaging, upgrade, and teardown matrices.

Exit gate: the feature map and Phase C gates pass from clean published
packages.

## 16. Rejected designs

| Design | Why |
|---|---|
| In-tree/core implementation prerequisite | contradicts the out-of-tree plugin decision |
| Web/ACP loopback | extra process/transport and duplicated lifecycle |
| Web controller extraction | Session Controller already is the Host API |
| Rust/OpenTUI/custom renderer | extra runtime or framework without a required gain |
| Patched pi-tui | stock 0.84.4 supports this design |
| `UiConversation` reuse | stateful client service; not lazy or Host-neutral |
| Destructive rewind/file snapshots | second authority and misleading rollback |
| TUI persistence | duplicates DSH facts and creates reconciliation |
| Public widget SDK | no proven consumer; freezes internals |
| Permanent dashboard | obscures the conversation and wastes terminal space |

The product is an out-of-tree DSH application, not a framework: a small
terminal adapter over existing DSH authority, with a complete daily-driver
interaction surface.
