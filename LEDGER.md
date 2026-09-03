# dashi ledger

Append-only. Decisions are `D-NNN`; work items are `W-NNN`. Never rewrite
an entry; supersede it with a new one that references the old.

## Decisions

### D-001 (2026-09-02) Out-of-tree plugin plus profile
dashi is built outside the DSH repository as `@antst/dashi` (TUI plugin)
and `@antst/dashi-app` (shipped `tui` profile), launched as
`dsh --profile tui`. Zero required DSH core changes. Upstream PRs (CLI
alias, public helper exports) are optional and never a gate.
Why: the owner does not control upstream, upstream deleted its own TUI on
2026-08-04, and DSH's CLI already boots arbitrary profiles.

### D-002 (2026-09-02) Name: dashi
Repo `ai/dashi` on Forgejo (`ssh://git@forgejo.antst.net:224/ai/dashi.git`).
Zero GitHub name collisions. `dshterm` was considered and rejected for
pronunciation; `dsh-tui` is taken.

### D-003 (2026-09-02) License: MIT
Copyright (c) 2026 Anton Starikov. DSH and pi-tui are both MIT.

### D-004 (2026-09-02) Design accepted
DESIGN.md revision (1464 to 817 lines) accepted after gate check of 13
required changes, KISS filter, and contradiction pass. Key architecture:
one process, `ctx.sessionController` called in-process for list, fork,
history, cancel; one pure `foldCells` over event slices; one reducer plus
one effect runner; one current root exposed via `ctx.tuiRoot.current()`
and a single `tui/root-changed` event; no TUI persistence.
The unverifiable pi-tui version pin was removed before commit; the patch is described by behavior with a citation to the DSH archived note.

### D-005 (2026-09-02) Tooling is three files
AGENTS.md (working agreement), LEDGER.md (this file), and one gate script
`pnpm gate` (typecheck, lint, tests, import lint). No CI until a remote
pipeline is needed. No further process tooling until a step is repeated
by hand three times.

### D-006 (2026-09-02) Primary targets: Linux and macOS
Windows is not a supported target and not a release gate. No ConPTY tests,
no Windows-specific code paths, no `pwsh` handling. pi-tui's native
modifier-key modules are optional and unused on Linux; do not build them.
Test matrix: Linux and macOS PTYs, tmux, screen, SSH-like TERM values.
Why: the owner's users are on Linux and macOS; every Windows branch is
untested code.

### D-007 (2026-09-02) `dashi` command and profile name
The profile is named `dashi`, not `tui`, to avoid colliding with any
future upstream `tui` profile. Launch forms: `dsh --profile dashi [args]`
and the short `dashi [args]`. `dashi` is an npm `bin` in `@antst/dashi-app`:
a tiny Node file that invokes DSH's CLI entry in-process with
`--profile dashi` prepended; if that entry is not importable, it spawns
the pinned `dsh` bin from dashi's own `node_modules`. No shell script.
Why: one install command, DSH version pinned by our lockfile, no PATH
coupling. DESIGN.md still says `tui`; fix in the next doc pass.
Supersedes the profile name in D-001.

### D-008 (2026-09-02) Install via DSH's native profile mechanism; no `dashi` bin
Supersedes the `dashi` bin in D-007. DSH resolves `--profile NAME` to
`$DSH_HOME/profiles/NAME`, created by `dsh plugin --profile NAME add
<published bundle>`; the published `@deepseek-ai/dsh` package has a bin
only, nothing importable (cited by the builder: apps/cli/src/args.ts:130-145,
packages/boot/app-boot/src/profile.ts:127-134 and 805-837,
apps/cli/src/plugin.ts:120-130). Supported install:
`npm i -g @deepseek-ai/dsh`, then `dsh plugin --profile dashi add
@antst/dashi-app`, then `dsh --profile dashi`. README documents
`alias dashi='dsh --profile dashi'`. `@antst/dashi-app` does not depend on
the DSH CLI package; it declares DSH peers the way DSH's own published
bundles do, and the profile pins DSH.
Rejected: a launcher that composes the profile on first run (lifecycle
and version drift), and a CLI dependency inside the bundle (breaks the
profile-local install). A zero-dependency exec-only launcher package may
be added later if users ask; it must never compose profiles.
The profile name `dashi` from D-007 stands.

### D-009 (2026-09-02) Adopted and rejected from the survey of existing DSH TUIs
Surveyed: openma-ai/Martty, huiliyi37/dsh-tianshu-tui, dsh-tui/dsh-tui,
ccch1mneyyy/dsh-TUI, jame100101/dsh-terminal-ui, mervyn-teo/dsh-plugin-terminal,
hust-open-atom-club/oh-dsh and others by search.
Adopted:
- A validated-DSH-versions allowlist checked by the gate and, at boot,
  a one-line warning when the profile's DSH version is outside it. Two
  independent projects had to add this after drift across DSH
  pre-releases. It is a list and a comparison, nothing more.
- The import-boundary lint already in W-001 is the same idea as
  dsh-TUI's `verify:boundary`; keep it.
- dsh-tui/dsh-tui is the closest architectural peer (pi-tui, out-of-tree
  bundle over `@deepseek-ai/dsh-base`, `cordis.patch.yml` with `inject:`
  ordering). Use its bundle composition as a reference for W-001; do not
  copy code.
- Ctrl+O cycling a tool card collapsed, expanded, hidden (from
  dsh-tui/dsh-tui) goes into the feature map at the next doc pass.
Rejected:
- Any local preference directory (dsh-TUI writes ~8 JSON files under
  `~/.dsh-tui/`); dashi keeps no files.
- LSP diagnostics, vision bridges, memory recall, i18n frameworks, and
  packaging subtrees; these are the observed feature-creep path.
- ACP out-of-process attachment (Martty). Its `_dsh/cordis/tui/*`
  namespace is not in DSH at the pinned commit; in-process stays.
- Forking the harness (dsh-terminal-ui).
- Patch-surface snapshots (dsh-TUI) until dashi actually disables or
  overrides an upstream Cordis row; then reconsider.

### D-010 (2026-09-02) oh-dsh confirms the install primitive
hust-open-atom-club/oh-dsh is a multi-surface distribution, not a TUI; it
vendors ccch1mneyyy/dsh-TUI and bootstraps profiles by shelling the
unmodified `dsh plugin --profile <name> add <path>` (its src/main.ts:879)
and launching `dsh --profile <name>` as a child process. D-008 stands.
Nothing adopted. Noted for later, not for dashi: the standalone
`@deepseek-harness-tui/dsh-auth` plugin provides subscription OAuth and
can be added to a profile by users themselves; auth is not dashi's job.

### D-011 (2026-09-02) Correction to D-010, and the profile manifest fact
oh-dsh bootstraps its built-in profiles by writing
`$DSH_HOME/profiles/<name>/package.json` directly, merging its bundle
list into `manifest.dsh.profile.bundles` (its src/profile.ts:152); it
uses `dsh plugin --profile X add <path>` only for ad hoc local plugins.
Its TUI profile is `['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui', ...]`.
For dashi, D-008 still stands: users install with `dsh plugin add`, and
dashi never writes profile manifests on a user's machine. The dev-loop
script may write a throwaway manifest under an explicit DSH_HOME if that
is simpler than `dsh plugin add` with a local path; the builder decides
and cites the DSH manifest schema.

### D-012 (2026-09-02) Node only; no Rust or Go components
dashi is TypeScript in the DSH process. No sidecar process, no native
addon, no second language. Why: DSH and pi-tui already own the only
parts where native code earns its place (PTY, sandbox, terminal
mechanics); a sidecar reintroduces the protocol and lifecycle boundary
rejected in DESIGN.md; an addon adds a toolchain and prebuild matrix.
If a profiler shows a hotspot: fix the algorithm, then laziness, and
only then propose a native module as a ledger decision with measured
numbers.

### D-013 (2026-09-02) Composer uses pi-tui's framed editor as-is
pi-tui 0.84.4's Editor always draws top and bottom horizontal rules with
symmetric padding and has no prompt-prefix hook (builder citation:
packages/tui/src/components/editor.ts:228-236, 482-497, 521-531,
573-588); `editor-component.ts` is only an interface. v1 uses the editor
unchanged: the top rule is the composer separator already in the design
mock, and the `›` prefix is dropped. Rejected: pnpm patch (what the old
DSH TUI did; carried on every upgrade), subclass stripping rendered rows
(undocumented output), own editor (2k+ lines). Optional, never a gate:
an upstream pi-tui PR adding `frame` and `prefix` options, specified by
the archived DSH note 2026-07-24-tui-shell-prompt-editor. DESIGN.md's
composer mock is updated at the next doc pass. W-002's stop condition
is resolved; the frameless check is removed from its scope.

### D-014 (2026-09-02) Renderer stays @earendil-works/pi-tui
Surveyed as of 2026-09-02 against the hard constraints (in-process Node
>= 22, no reconciler, no native addon, permissive license, maintained,
alt-screen diff redraw, editor with undo and paste, Markdown, CJK/emoji
width): ink 7.1 (React + Yoga, no editor), terminal-kit 3.1 (no diff
engine, basic input), blessed/neo-blessed/reblessed (dead), @unblessed
(alpha), terminui 0.3 (renderer primitive only), clack (prompt flows),
termui (Ink wrapper), OpenTUI 0.5.10. OpenTUI is the strongest
alternative and reconciler-free at its core, but it runs under Node only
on 26.4+ through the experimental `node:ffi` behind `--experimental-ffi`
(Node docs: memory-unsafe), and it loads prebuilt Zig libraries per
platform; DSH's floor is Node 22 and dashi does not control the DSH
process's flags. pi-tui has no frameless/prefix editor option through
0.84.4 (see D-013). Maintenance risk is ordinary: org-owned, outside
contributors, several releases a month; pin exactly, upgrade on our
schedule with the headless screen tests as the gate.
Reopen only on new evidence: DSH raising its Node floor to a line where
`node:ffi` is stable and default-on, or a pure-TypeScript library with
an editor and Markdown appearing.

### D-015 (2026-09-02) Concurrent resume is a DSH gap; dashi adds no lock
DSH's single-writer guarantee is in-process only: the persistence
contract claims atomic ownership (packages/session/session-persistence/src/index.ts:149-160)
but the JSONL backend's writer tracker is a per-process Map
(session-persistence-jsonl/src/storage.ts:319-361), and controller
resume adds no OS lock (api/session-controller/src/agent.ts:398-432).
Two `dsh` processes can resume the same session at once (builder's
two-PTY test). dashi does not add a lock file, a PID file, or any
detection: that would be TUI-owned persistence with stale-lock
reconciliation and a second authority. Consequences: the "second
writer rejected" statements in DESIGN.md 7.3 and D-008's `--continue`
wording are withdrawn at the next doc pass and replaced by "DSH gap:
no cross-process session lock"; W-003's writer-held acceptance item is
removed. Optional upstream PR, never a gate: an advisory `flock` on the
session directory in dsh-session-persistence-jsonl.

### D-016 (2026-09-02) Upstream PRs delegated to a Codex lane
Optional upstream changes are handled by the Agent Sessions Codex lane
`upstream-prs` (cwd ~/upstream, gpt-5.6-sol, xhigh, no auto-archive),
one PR at a time, plan approved by the architect before each PR is
opened, drafts under the owner's GitHub account. Queue: (1) DSH
cross-process session writer lock (D-015); (2) pi-tui Editor `frame`
and `prefix` options (D-013); (3) DSH FileSystem delete primitive
(roller D-003). Held: command presenters, ignorable custom event types,
public ui-chat helper exports. None is a gate for dashi or roller.

### D-017 (2026-09-02) Held upstream PRs released at the architect's discretion
The three held PRs in D-016 are queued to the lane when a product can
consume them: command presenters after roller's restore command fixes
its output; ignorable custom event types right after, if a durable
restore event would replace the text report; ui-chat helper exports
when dashi's fold reaches Phase B and the imports would delete lines.

### D-018 (2026-09-02) Upstream channel is reports, not PRs
Supersedes the PR mechanics in D-016 and D-017. DSH's CONTRIBUTING.md
states external pull requests are not accepted and asks for bug reports
in GitHub Discussions. pi's CONTRIBUTING.md auto-closes issues and PRs
from contributors without a maintainer `lgtm`; a PR may follow only
after that reply. The `upstream-prs` lane therefore files one
well-evidenced report per item through the sanctioned channel, text
approved by the architect before posting, and opens a pi PR only if a
maintainer grants `lgtm`. Consequence: every named DSH gap stays a gap
for the foreseeable future; dashi and roller are designed for that.

### D-019 (2026-09-02) Previous roots stay live until profile teardown
DSH's session controller retains the AgentHandle for every root it
creates or resumes and exposes no release (pinned
packages/api/session-controller/src/agent.ts:63-66, 428-432, 460-485;
index.ts:185-212); only the handle holder may dispose
(packages/core/agent/src/index.ts:151-168). dashi therefore cannot
dispose a previous root after /new, /resume, /fork, or /rewind. The
DESIGN.md binding rule "dispose previous through DSH" is withdrawn at
the next doc pass and replaced by: the previous root is unbound and
stays live and idle until profile teardown, which is the Web UI's own
model. Safety rule added: /new, /resume, /fork, and /rewind require an
idle root and offer to interrupt first, so an unbound root is never
running unattended with unclaimed approvals. Rejected: calling
ctx.agents directly (duplicates controller composition) and any
upstream API as a gate. W-006's carry-over test is redefined: on /new
and /resume, tui/root-changed fires with the exact previous and
current agents, the previous agent stays registered and idle, and all
roots are torn down at exit by the profile.

### D-020 (2026-09-03) pi editor change: no further effort
The frame/prefix change is on the fork and linked from pi issue 9032.
No pings, no rework unless a maintainer asks, no carrying the patch.
If no maintainer response by the time Phase B closes (W-011
accepted), the item is closed in the ledger and the branch stays as a
record. D-013 stands regardless.

### D-021 (2026-09-03) Mid-turn input for DSH lanes: AS-owned plugin on native inbox
Requirement from the Agent Sessions architect session: a DSH lane busy
on a long turn is unreachable over ACP. Answer given: no harness or
dashi change; an AS-owned Cordis plugin in the profile calls
`Agent.steer` (next step boundary, the interject) or `Agent.followup`
(own next turn) with a caller-identified UserMessage; DSH appends
`agent/inbox/spliced` on acceptance (the receipt) and `user/message`
with the same id when consumed; results correlate by turn for followup
and by seq range for steer, as dashi's W-004 PTY test already proves
from the log. Caller chooses placement; rejection is DSH's own error.
Root via `ctx.tuiRoot.current()` in dashi profiles, `ctx.agents.roots()`
headless. This is DESIGN.md section 11 as intended; nothing to build here.

### D-022 (2026-09-03) Phase B closed; pi item closed per D-020
W-001 through W-011 accepted. No maintainer response on pi issue 9032
by Phase B close, so the item is closed; the fork branch stays as a
record and D-013 stands. Phase C (hardening) begins after W-012.

### D-023 (2026-09-03) Inline is the default renderer; full screen gets wheel scrolling
Owner report: in full-screen mode the mouse wheel cycles prompt
history instead of scrolling, because mouse tracking is off, the
terminal translates wheel to arrow keys in the alternate screen, and
Up/Down are bound to recall. Decision: inline (main screen) becomes
the default, matching Claude Code and giving native scrollback, wheel,
and selection; `--fullscreen` remains and gains wheel scrolling via
pi-tui mouse tracking mapped to the existing scroll actions. DESIGN.md
5.1 default and 13.1 mouse rule are updated in W-013.

### D-024 (2026-09-03) A separate exec-only launcher package
Owner request. `@antst/dashi-launcher`, a third package in the dashi
workspace with zero dependencies, exposing the `dashi` bin: it execs
`dsh --profile dashi` from PATH with the user's arguments, stdio
inherited and exit code propagated, and prints one hint when `dsh` is
missing or the profile does not exist. It never composes or installs a
profile, never pins DSH, and never reads or writes any file. This is
the launcher D-008 permitted "if users ask". Install becomes
`npm i -g @deepseek-ai/dsh @antst/dashi-launcher`, then the one
profile-add command; the README keeps the shell alias as the
no-extra-package alternative (owner decision 2026-09-03).

### D-025 (2026-09-03) Patch-surface drift check adopted
dashi-app now disables 24 upstream Cordis rows (the agent plane moved
behind agent presets, identical to web-app), so D-009's condition is
met. One test in Phase C asserts (a) every row dashi overrides or
disables exists in the installed `@deepseek-ai/dsh-base` patch, (b)
dashi's disabled set equals the set DSH's own web-app bundle disables,
and (c) every row dashi inserts that originates upstream exists in
web-app's inserted rows with the same package name, dashi's own row
excepted (corrected 2026-09-03: inserted rows come from web-app, not
base). A DSH upgrade that renames or adds agent-plane rows fails the
gate instead of silently dropping a tool. No snapshot files; the
comparison reads the installed packages at the validated version.

### D-026 (2026-09-03) Clean-install test caught a packaging defect
W-017's clean install from packed tarballs exposed that `@antst/dashi`
declared DSH services as dependencies, which in an out-of-tree profile
produced a second DSH tool registry and broke tool dispatch. The
workspace had masked it. Fix: DSH services are peer ranges in
`@antst/dashi`, matching DSH's own bundles and roller; pi-tui stays a
direct dependency; `@antst/dashi-app` gains the upstream code-runtime
row and its worker-thread package as web-app declares them. Rule: no
package publishes until the clean-install test passes from packed
tarballs; the 0.1.0-alpha.1 release commit predates this fix and would
have shipped the defect.

### D-027 (2026-09-03) Inline mode is an append-only document; corrects D-023
D-023's claim that inline mode gave native scrolling was false because
dashi sliced the transcript to terminal height before rendering
(renderer.ts:426-437), so nothing ever entered scrollback. pi-tui's
TuiMainScreen renders the whole tree, scrolls the main screen by
emitting newlines, and writes only changed rows on append
(pinned pi packages/tui/src/tui-main-screen.ts:262-333, 461-545,
599-614), which is the model pi's own coding agent uses. Decision:
inline mode hands the renderer the entire loaded chronological
transcript plus the live tail; committed rows enter native scrollback
once; the live cell, decisions, overlays, composer, and status are the
mutable suffix; mouse tracking stays off so wheel and selection are the
terminal's; PageUp and Ctrl+Home open the history overlay; older pages
load only there and in full screen. Known and accepted: a change above
the viewport (Ctrl+O card mode, resize) makes pi-tui clear and replay
the loaded document, as it does for pi itself. Full screen keeps the
viewport model. The reducer and fold are unchanged.

### D-028 (2026-09-03) Agent Sessions DSH lane landed on the native inbox
The AS-owned adapter (agent-sessions 8427b2a) is credited on DSH
0.1.2-alpha.5 as the first native implementer of AS's peer protocol
v1: base bundle plus adapter as the app, `sessionController.create`
with a caller id, `Agent.steer`/`followup` with `agent/inbox/spliced`
as receipt, cancel with keepInbox and canceled-splice reporting,
explicit presets (danger-full-access for yolo; the bundle's own
workspace-write-noninteractive row otherwise), cold confirmation via
`sessionController.list`, archive = cancel, idle, flush, appExit. No
dashi or DSH change was needed. dashi's interactive profile gains
the same adapter later (B-002).

### D-029 (2026-09-03) DSH versions are pinned exactly; drift fails loudly
Owner's first real install failed to load: DSH published a full
0.1.2-rc.1 set on 2026-09-03 (06:07-06:21 UTC), the `dsh` CLI declares
its own packages with caret ranges, so a fresh install mixed an alpha.5
CLI with rc.1 libraries whose imports the alpha.5 modules lack
(builder diagnosis: profiles/dashi lock resolves nine packages at
rc.1; first failing import is session-controller lib/index.js:10
admitPromptContent). D-008's "the profile pins DSH" was wrong: nothing
pinned it. Decision: @antst/dashi and @antst/dashi-app declare DSH
peer and dependency versions as the exact validated version, not
carets, so an incompatible installation fails to resolve rather than
load a mixed tree; the clean-install test asserts every resolved
@deepseek-ai/* version equals the validated version; the README
install instructions pin the CLI and its packages with an override
until DSH pins its own (corrected 2026-09-03: pnpm 11 ignores
`pnpm.overrides` in package.json; the override goes in
pnpm-workspace.yaml as `overrides: {'@deepseek-ai/*': <v>}`, which
pnpm 10 also reads; npm users use the `overrides` field). Moving to rc.1 is a separate
validation item, never an implicit upgrade.

### D-030 (2026-09-03) Track the current DSH release; never pin backwards
Owner rule: effort goes to supporting the current DSH, not the past
one. When DSH publishes a newer release, dashi and roller validate
against it first (bump the allowlist and the pinned reference tree,
run the gate, fix what dashi's own code broke, report contract
changes); the exact pin from D-029 then carries the new version. The
alpha.5 pin plan for the owner's home install is withdrawn (their pnpm
10 also ignores a scoped wildcard override). Order: W-021 (validate
0.1.2-rc.1) before W-020 (exact pins), and W-020's pin value is rc.1.
Owner's home install made coherent at rc.1 on 2026-09-03 by removing
node_modules and the lockfile and reinstalling (pnpm keeps stale
peer-only packages on incremental installs); the `dashi` profile was
recreated on it and boots with the not-validated warning pending
W-021. README upgrade note (W-020): upgrading DSH means a fresh
lockfile, not an incremental install.

### D-031 (2026-09-03) No override instruction in the README
The scoped wildcard override is ignored by pnpm 10.28 (clean
reproduction 2026-09-03: dsh-base resolved rc.1 despite an alpha.5
wildcard) and honored only by pnpm 11. Since dashi's packages pin DSH
exactly (D-029) and we follow DSH forward (D-030), the README drops the
override block entirely: install the CLI at the exact validated
version, upgrade with a fresh lockfile, and expect dashi to be
re-validated when DSH moves. An exact-name override list is rejected
as brittle. Owner's profile rebuilt on 0.1.0-alpha.3 plus roller 0.1.1
and boots with no warning.

### D-032 (2026-09-03) Rewind copies Claude Code's flow
Owner report: the rewind pickers are confusing ("Before turn 2 · ls",
"Edit and resend", "Conversation only") and the natural case, restore
files and edit the prompt, is unreachable; steered prompts are absent.
Decision, from Claude Code's documented flow: the first screen lists
every prompt sent in the session by its text; the second screen offers
"Restore code and conversation", "Restore conversation", "Restore
code", "Never mind"; after a conversation restore the selected
prompt's text is placed in the composer and never auto-sent; "Restore
code" runs roller in the current session without a fork; the code
options appear only when roller is installed. No "resend" variants,
no "latest" row (that is /fork), no summarize options (DSH compaction
is whole-session; a range summary is a named DSH gap). Steered
prompts are listed and marked mid-turn; selecting one rewinds to the
start of the turn that consumed it, because DSH forks only at turn
boundaries (named DSH gap). Double Esc with text in the composer
clears the draft into history instead of opening rewind, as Claude
Code does.

### D-033 (2026-09-03) dashi-app bundles roller
Owner asks that dashi always come with roller. The profile bundle
`@antst/dashi-app` is the composition point, so it depends on
`@antst/roller` at an exact version and inserts roller's row after
dashi's; one `dsh plugin add @antst/dashi-app` installs both. The TUI
plugin `@antst/dashi` keeps no dependency on roller and still detects
`roller-restore` by name, so a custom profile without roller works
with the code rows absent. Releases of dashi-app bump the roller pin
deliberately; the validated-versions gate covers it.

### D-034 (2026-09-03) dashi moves to GitHub with the roller setup
Owner decision: same as roller D-007/W-008. After W-026 merges, the
current tree is pushed as a single initial commit to
https://github.com/antst/dashi; Forgejo stays as remote `forgejo`
with the old history; `main` is the release branch (tags), `develop`
the integration and default branch, work branches as pull requests
against `develop`, both branches protected so ledger edits also go
through pull requests. CI publishes previews of all three packages to
pkg.pr.new from `develop` and pull requests, and to npm with
provenance on GitHub releases, in dependency order (dashi, dashi-app,
launcher).

## Work items

### W-001 Repo scaffold — status: accepted 2026-09-02 (aa1b01f, merged to main)
Owner: dsh-exec. Branch `w-001-scaffold`.
Scope: pnpm workspace with `packages/dashi` and `packages/dashi-app`;
TypeScript config; pinned dependencies on published `@deepseek-ai/*`
packages at the versions matching DSH `0.1.2-alpha.5` and
`@earendil-works/pi-tui@0.84.4`; `pnpm gate` script running typecheck,
lint, unit tests, and an import lint that forbids persistence backends,
`ui-*` client packages, and any path import into `node_modules` source;
`dsh --profile dashi` boots the profile and exits cleanly with a plain
"dashi: profile booted" line and no terminal takeover yet.
Added 2026-09-02 (D-007): profile name is `dashi`.
Added 2026-09-02 (D-008): no `dashi` bin. Mirror a published DSH bundle's
package.json shape for @antst/dashi-app (peer ranges, no CLI dependency).
Provide one script for the dev loop that installs the local workspace
build into a `dashi-dev` profile and boots it; document it in README.
report in the handoff how DSH resolves `--profile NAME` to a package
(cite file:line in the pinned DSH tree) and whether the CLI entry is
importable in-process.
Not in scope: any renderer, any transcript, any command.
Acceptance evidence: gate output pasted in handoff; the boot line
reproduced in a PTY test; `pnpm ls` shows no unpinned or duplicate
`@deepseek-ai` versions; total new source under 300 lines excluding
config.

### W-002 Terminal shell without an agent — status: accepted 2026-09-02 (10288e7, merged to main)
Owner: dsh-exec. Branch `w-002-terminal-shell`.
Scope: `dsh --profile dashi` takes over the terminal and shows the
empty document: header (cwd, no session yet), an empty transcript, the
composer, and the status line, in pi-tui alt screen by default and main
screen with `--inline`. TerminalGuard per DESIGN.md 9.6 owning raw mode,
bracketed paste, cursor, alt screen, and synchronized output, with one
idempotent async disposer reachable from every exit path including the
fail-loud release lesson (DSH note 2026-07-31). Application skeleton:
one immutable ViewState, one pure reducer, one effect runner, key
contexts for the portable minimum that applies without an agent
(Ctrl+C twice or Ctrl+D on empty composer exits, Ctrl+L redraws,
Ctrl+J newline, Ctrl+Z suspend/resume on Unix, Esc closes nothing yet).
Composer delegates editing to pi-tui's editor used unchanged (D-013:
framed, no prefix).
Not in scope: creating or resuming any DSH root, transcript content,
commands, completion, overlays, approvals, mouse.
Acceptance evidence: gate passes; @xterm/headless screen tests at 48,
80, and 160 columns and 8, 24 rows for both renderers; PTY tests prove
the terminal is restored after clean exit, Ctrl+C twice, SIGINT,
SIGTERM, a thrown error inside the effect runner, and closed stdin;
suspend/resume redraws; typing and pasting multi-line text into the
composer works; no pi-tui import outside the allowed modules; the
reducer has no async code and no DSH imports; new source under 900
lines excluding tests.

### W-003 Root lifecycle and streaming transcript — status: accepted 2026-09-02 (66946bb, merged to main)
Gate notes for later phases: line cache has no theme key (one theme
exists); renderer recomputes all loaded cells per frame, bounded by the
50-message follow snapshot; viewport-plus-overscan is the Phase B lazy
materialization item.
Owner: dsh-exec. Branch `w-003-root-and-transcript`.
Scope: the first real conversation. Startup per DESIGN.md 5.2: fresh
session by default with a DSH-minted UUID, `--name TITLE` as a flushed
native title, `--resume UUID` exact, `--continue` per D-008 semantics,
`[PROMPT]` submitted after the first frame. Root creation and resume go
through `ctx.sessionController` where it has the operation and
`ctx.agents` otherwise; concurrent resume is a DSH gap (D-015), not tested.
`ctx.tuiRoot.current()` and the single `tui/root-changed` event per
DESIGN.md 7.2, with the binding rules as written (no more states).
Header shows title or UUID and cwd; `/status` is not in scope.
Enter submits via `Agent.followup`; Esc and Ctrl+C interrupt via
`agent.cancel({kind:'user'},{keepInbox:true})`; two-stage Ctrl+C exit
from W-002 stays. Transcript: `foldCells` v1 over event slices loaded
through `ctx.sessionController` page/follow, rendering user messages,
assistant text with streaming live tail coalesced to at most 30 fps,
provider-visible reasoning collapsed after completion, one generic
tool row per call/result pair (presenters come in W-004), turn
outcomes, and errors. Status line: root state, model id, and what Esc
does. Exit ordering per DESIGN.md 7.2 including drain and the
one-line summary with the resume command.
Model replacement for tests: reuse DSH's own test-support or fake
provider if the pinned tree has one (look in packages/test-support and
packages/llm); if not, the smallest recorded-stream provider plugin
that DSH's llm contract allows, in tests only, and cite the contract.
Not in scope: tool presenters and diffs, approvals, questions,
steer/queue send mode, commands, completion, pickers, rewind, search,
history overlay, images.
Acceptance evidence: gate passes; PTY test with the recorded provider
runs a full turn (prompt, streamed answer, one tool call rendered as a
generic row) and exits with the summary line; a second PTY run resumes
by exact UUID and shows the prior turn; `--name` proves a
`session/title` event in the durable log with no messages sent;
interrupt mid-stream leaves the terminal restored and the session
resumable; `tui/root-changed` fires exactly once at bind and once at
exit in the specified order (unit test with a fixture plugin);
foldCells is one exported pure function under 300 lines with fixture
tests over recorded logs; the reducer still imports nothing; new
production source under 1200 lines.

### W-004 Tool cards, approvals, questions, steer and queue — status: accepted 2026-09-02 (443afd2, merged to main)
Carry-over tests into W-005: sanitizer test must include OSC and C1
cases; a test for an approval arriving while the composer holds text.
Owner: dsh-exec. Branch `w-004-tools-and-decisions`.
Scope: the generic tool row becomes presenter-backed: `presentCall` and
`presentResult` select the card, one generic card is the only fallback,
no argument parsing. Diff cells show file name and +/- totals collapsed
and a bounded contextual diff expanded. Large bodies bounded to first
12 and last 8 lines with an omitted-line count; no detail overlay yet.
Ctrl+O cycles one global tool-card mode: collapsed, expanded, hidden
(D-009). Approvals: DSH's `approval/request` becomes one decision
overlay with Allow once, Reject, Cancel, exactly the choices DSH
supports; one FIFO decision queue whose head owns focus; terminal loss
or exit rejects. Questions: DSH's user-questions service becomes one
overlay supporting batches, arrow and number selection, and custom
text, answered through DSH's own responder. Send mode: Ctrl+T toggles
steer or next-turn while the root is running; the footer states what
Enter does; Enter calls `Agent.steer` or `Agent.followup` per DESIGN.md
6.4; idle Enter unchanged.
Not in scope: commands, completion, pickers, detail or history overlay,
search, rewind, images, permission cycling, plan mode.
Acceptance evidence: gate passes; PTY with the replay provider drives
a turn whose tool call requires approval under a preset that asks, the
overlay is answered by keys, the durable log shows the decision, and
the card renders through the tool's own presenter; a fixture tool that
asks a batch question is answered including custom text; a steer sent
mid-stream appears at the next step and a next-turn message runs after
the turn ends, both proven from the durable log; Ctrl+O cycles through
the three modes in a headless screen test; hostile presenter output
(ANSI, control characters, oversized text) is sanitized in a unit
test; the reducer imports nothing; foldCells stays under 300 lines;
new production source under 1200 lines.

### W-005 Commands, completion, pickers, session commands — status: accepted 2026-09-02 (13baa2a, merged to main)
Carry-over test into W-006: assert from the durable log or events that
the previous root's agent/disposed follows tui/root-changed on /new and
/resume.
Owner: dsh-exec. Branch `w-005-commands-and-pickers`.
First commit: the two carry-over tests from W-004.
Scope: slash commands per DESIGN.md 6.6. `/` completion with two
labeled groups: `ctx.commands` entries plus the small TUI-owned set,
and user-invocable skills from `ctx.skills`; completion inserts text
only; a submitted line starting with `/` goes to `ctx.commands.execute`
whole, and an undefined result means it was ordinary prompt input.
TUI-owned commands: `/help`, `/status` (unabridged UUID, title, cwd,
lineage, model, effort, permission preset, usage if DSH exposes it),
`/new [--name TITLE]`, `/resume [UUID]` with a picker over
`ctx.sessionController` list showing UUID, title, cwd, updated,
`/rename TITLE` (native rename then flush), `/model` picker over the
model catalog with effort, `/permission` bare form as a picker over
`ctx.permissionPresets`, `/queue TEXT`, `/exit`. Root replacement for
`/new` and `/resume` follows the DESIGN.md 7.2 binding rules already
implemented. Shift+Tab cycles presets with a TUI-owned confirmation
when the target preset's approval policy is `never` (D-013 wording
rule applies: TUI-owned, keyed on the preset's policy). `?` stays
ordinary input; F1 opens help. Overlays: exactly one at a time; a
decision preempts and closes any picker.
Not in scope: `@` path completion, images, fork/rewind, history and
search overlays, external editor, stash, copy, inline polish.
Acceptance evidence: gate passes; PTY tests with the replay provider
prove: a native DSH command (use `/compact` or another shipped one)
executes and its command/run and command/done render as a command
cell not a prompt; a skill token in a prompt is not executed as a
command; `/rename` yields a session/title event; `/new` then
`/resume` via the picker switches roots with tui/root-changed firing
in order; `/model` changes the durable model selection; Shift+Tab
into danger-full-access shows the confirmation and a single keypress
does not switch; headless tests cover completion rendering for both
groups and each picker at 80 and 48 columns; the reducer imports
nothing; new production source under 1200 lines.

### W-006 Fork, rewind, roller integration, prompt recall — status: accepted 2026-09-02 (ada4bfa, merged to main)
Verified: native fork with parent untouched and resumable; roller
end-to-end restore proven through the installed profile (closes roller
D-005); SQLite query provider enabled declaratively in the profile
patch; previous roots retained idle per D-019. One send-back: the
double-Esc PTY test needed a gap above pi-tui's 10 ms escape window.
Owner: dsh-exec. Branch `w-006-rewind`.
First commit: the carry-over test from W-005 as redefined by D-019.
Scope: `/fork` and `/rewind` per DESIGN.md section 8 and D-002:
require idle (offer to interrupt), present balanced boundaries as the
state before each human prompt plus the latest completed boundary,
call `ctx.sessionController.fork` for the chosen boundary, switch
roots by the existing replacement path, and put the selected prompt
back in the composer when "edit and resend" was chosen. `Esc Esc` on
an idle empty composer opens the rewind picker. The picker states
"Files will not be changed" unless roller is present. roller
integration: when `ctx.commands` lists `roller-restore` for the root,
the picker offers "conversation and files"; choosing it forks, then
executes `/roller-restore <turn-end-seq>` in the child through
`ctx.commands.execute`, and the command cell shows roller's report.
dashi has no dependency on roller; presence is checked by name at
picker-open time only. Prompt recall: Up and Down over the current
session's human prompts and Ctrl+R reverse search over
`ctx.sessionQuery` in the current cwd, inserting text only. `/status`
shows "forked from <UUID> at turn N" for children.
Not in scope: history overlay, transcript search, lazy paging, images,
path completion, external editor, stash, copy.
Acceptance evidence: gate passes; PTY with the replay provider: a
three-turn session, `/rewind` to before turn 2 with "edit and resend"
yields a new root whose log is the parent prefix plus nothing, the
composer holds the turn-2 prompt, and the parent session is unchanged
and resumable; the same with roller installed in the dashi-dev profile
(add `@antst/roller` from its local build) and "conversation and
files" restores the workspace files to their turn-1 bytes and shows
roller's report cell, which is the end-to-end proof roller D-005
deferred to dashi; `Esc Esc` on idle opens the picker and on a running
root does nothing; Ctrl+R finds a prompt from an earlier session in
the same cwd; the reducer imports nothing; new production source
under 900 lines.

### W-007 History overlay, transcript search, lazy history — status: accepted 2026-09-02 (f2ac2b5, merged to main)
Verified: materialized cells at the top of a 200k-cell transcript
within viewport plus 8; key-to-frame p95 10.26 ms; cold resume of a
200k-event session under 3 s from the resume command; OSC 52 payload
decoded and sanitized in tests. Carry-over into W-008: a test for copy
unavailability on TERM=dumb, and make that detection explicit about
the terminal type rather than the presence of an injected terminal.
Owner: dsh-exec. Branch `w-007-history`.
Scope: the Phase B navigation items. Lazy history: on start and
resume, load through `ctx.sessionController` page/follow so that only
the viewport plus an overscan window of cells is materialized; older
history pages in on demand when the user scrolls up (PageUp,
Ctrl+Home) and is evicted from the line cache by the existing bounded
rule; a 200k-event fixture session must open within DESIGN.md's gate.
Scrolling: PageUp/PageDown and Ctrl+Home/Ctrl+End over the transcript
while the composer keeps focus; when scrolled away from the end, new
activity increments a "new output" marker instead of moving the
viewport. Ctrl+O remains the card mode toggle. The history overlay
opens with `/history`: arrows select a
cell, Enter expands it, `y` copies its plain text through one
clipboard helper (OSC 52 or a platform helper; report unavailability,
never execute model text), `/` searches within the overlay, Esc
returns. Transcript search: Ctrl+F opens an in-transcript search
bar over loaded cells with next/previous and a match count; `/copy`
copies the latest completed assistant response as plain text; the
line cache gains a theme-generation key now that the cache is
exercised by paging (W-003 note).
Not in scope: composer extras (@ paths, images, external editor,
stash), plans/todos/jobs/subagents presentation, inline and
accessible polish, performance tuning beyond the one open gate.
Acceptance evidence: gate passes three consecutive runs; a recorded
200k-event session fixture (generate it once in tests, do not commit
it) resumes to a usable frame under 3 s after persistence load and
composer key-to-frame stays under 25 ms p95 measured in the headless
harness; scrolling up pages older history in and the cell count
materialized never exceeds viewport plus overscan (assert on the
renderer); the new-output marker appears and clears; the history
overlay, Ctrl+F search with counts, `y` copy, and `/copy` are proven
in headless tests, with clipboard output asserted on the terminal
output stream and never containing unsanitized sequences; the reducer
imports nothing; new production source under 900 lines.

### W-008 Composer extras: paths, images, external editor, stash — status: accepted 2026-09-02 (ab0fade, merged to main)
Verified: cwd-bounded @ listing, durable ImageAttachmentRef on the
log, editor round-trip with mode 0600 temp file removed and terminal
modes compared, stash swap semantics, CSI-u modified Enter. Recorded
copy: at-trigger.ts (20 lines) mirrors the @ branch of pinned
ui-input-trigger core/detect.ts:50-59 because the published package
does not export it; a public export upstream is optional.
Owner: dsh-exec. Branch `w-008-composer`.
First commit: the carry-over test from W-007.
Scope: DESIGN.md composer items not yet built. `@` path completion
rooted at the session cwd using DSH's existing input-trigger
matching (packages/client/ui-input-trigger core detect, pure) and
DSH's file reference service if the profile has one; selecting a
path inserts text, selecting an image-capable file attaches it.
Images: `--image PATH` (repeatable) resolved through DSH's attachment
policy and attached to the initial prompt or preloaded as chips;
visible attachment chips with remove and inspect; attachments travel
with the submitted message through DSH's own message attachment
path; no image decoding in dashi. Ctrl+G edits the draft in $VISUAL
then $EDITOR through TerminalGuard's cooked-terminal handoff, with a
mode-0600 temporary file unlinked on every path; saving replaces
text only. Ctrl+S stashes or restores one draft including cursor and
attachments, process-local. Ctrl+J newline remains; Shift+Enter and
Alt+Enter map to newline when the terminal reports them distinctly.
Not in scope: plans, todos, jobs, subagents, compaction presentation;
inline and accessible polish; performance work.
Acceptance evidence: gate passes three runs; PTY tests prove `@`
completion lists files under cwd only and never above it, an image
attached via `@` and via `--image` reaches the durable user message
through DSH's attachment representation (assert on the log), Ctrl+G
round-trips through a fake $EDITOR that appends text with the
terminal restored afterwards and the temp file gone, Ctrl+S stash and
restore including an attachment, and Shift+Enter inserts a newline
when the PTY reports the distinct sequence; the reducer imports
nothing; new production source under 900 lines.

### W-009 Plans, todos, jobs, subagents, compaction, context meter — status: accepted 2026-09-03 (c779da8, merged to main)
Verified: one PTY scenario through real plan, todo, subagent, job,
compaction, and token-meter paths; child events never in the root
transcript; neutral meter; second 34 ms timer accepted because it
debounces an independent control stream that would otherwise
enumerate sessions per subagent token. Recorded copy: the context
percentage formula from ui-conversation context-occupancy.ts:15-24.
Carry-over into W-010: README and DESIGN.md key table lack Ctrl+B.
Owner: dsh-exec. Branch `w-009-presentation`.
Scope: render what DSH's existing services already produce, nothing
more. Plan and todo cells: compact current state from the plan and
todo services' events or projections, earlier revisions collapsed;
plan-mode review answered through the existing decision overlay
(plan-review intent in DSH's question waterfall). Subagent and job
rows: one row per DSH subagent or job with label, state, elapsed
time, and DSH's own bounded summary; child transcripts never enter
the root transcript; a details overlay opens on demand and is the one
overlay. Compaction: rendered as a notice cell from DSH's compaction
events; `/compact` already works. Context meter: the status line
shows a neutral "NN% context" from the token-meter projection exactly
as the Web UI computes it (projected or pressure tokens over the
context window, clamped, shown only when both exist); DSH defines no
severity thresholds, so dashi shows none (amended 2026-09-02).
Not in scope: inline and accessible polish, performance table, any
new DSH capability; if a service is absent from the profile the cell
kind is simply never produced.
Acceptance evidence: gate passes three runs; PTY tests with the
replay provider drive: a plan created and revised (earlier revision
collapses), a plan-mode review answered through the overlay with the
durable outcome on the log, a todo list updated twice, a subagent
run whose child events do not appear in the root transcript while its
row shows state and summary and its details overlay opens, a job
started and completed, and a compaction with the notice cell and the
meter moving; foldCells stays under 320 lines (state the count) and
the reducer imports nothing; new production source under 900 lines.

### W-010 Shell escape, bell, documentation pass — status: accepted 2026-09-03 (e50ed72, merged to main)
Verified: shell escape through ctx.shell only with DSH result fields,
injection inside Agent.runMaintenance (public DSH API, same use as
compaction-basic), replay-proven model request content, bell on both
triggers and silent in accessible mode, DESIGN.md 829 lines with every
withdrawn claim gone.
Owner: dsh-exec. Branch `w-010-shell-and-docs`.
First commit: README and DESIGN.md key table gain Ctrl+B (details
overlay) and Ctrl+O (card mode).
Scope: `!command` per DESIGN.md: a line starting with `!` on an idle
root runs a bounded noninteractive command through DSH's own
shell/subprocess and sandbox services with the human as actor, never
as a tool call; the command and its capped stdout and stderr become
one identified message through `Agent.inject` with source
`{kind:'plugin', plugin:'dashi', form:'notice', summary}` (the shape
settled in the design pass), durable and visible to the next model
step without starting one; DSH cannot classify a command as
interactive or backgrounded before running it (amended 2026-09-03), so
dashi does not try: it calls ctx.shell.run only, with stdin closed, a
30 s deadline, and 32 KiB per stream; a command that waits for input
gets EOF, a command past the deadline is reported as timed out with
the suggestion to suspend with Ctrl+Z for interactive programs, and
detached processes are stated as unmanaged in the README; the
human's own command runs outside the tool approval path but inside
the session's sandbox policy. Bell: one BEL written through the terminal seam
when a decision (approval or question) is enqueued while the root was
running, and when a turn ends after running longer than a fixed
threshold; state the threshold; never in accessible mode; never
twice for one event. Documentation pass on DESIGN.md: fold in the
accepted decisions that changed it (D-007/D-008 profile and install,
D-013 framed editor, D-015 no writer lock, D-019 previous roots
retained, neutral meter, Ctrl+O and Ctrl+B), renumber nothing else,
keep it under 900 lines, and remove every sentence the ledger has
withdrawn; README gains the "Known DSH gaps" list matching the ledger.
Not in scope: clipboard image paste, inline and accessible polish,
performance table, vim mode.
Acceptance evidence: gate passes three runs; PTY tests prove `!echo`
output appears as a shell cell, the durable log holds one injected
message with the stated source and no model turn started, a
command that reads stdin gets EOF and ends, a command exceeding the
deadline is killed and reported as timed out with the suspend
suggestion, a sandbox-denied command reports the denial, and the next real prompt's model request
includes the injected content (assert through the replay provider's
recorded request or DSH's request/context event); the bell is
asserted on the terminal output stream for both triggers and absent
in accessible mode; DESIGN.md contains none of the withdrawn
sentences (list them in the handoff with grep proof); new production
source under 500 lines.

### W-011 Clipboard image paste, inline and accessible polish, Phase B exit — status: accepted 2026-09-03 (c576252, merged to main)
Verified: 138 tests; measured p95 composer 0.3 ms normal and 10-13 ms
at 200k cells, streaming 28.9 fps with no forced scroll, 200k-event
resume with 2,000 tool cells about 2.2 s from launch, warm 1k-session
list 35 ms, heap delta 24 MiB, spawn-to-first-frame about 1.0 s. Phase B
is closed. Finding: DESIGN.md 5.3 `sessions list --json` was never
scheduled; opened as W-012.
Owner: dsh-exec. Branch `w-011-phase-b-exit`.
Scope: Ctrl+V when the composer receives no bracketed-paste text:
one boundary module asks the platform clipboard for an image (macOS
`pngpaste` if present, else `osascript`; Linux `wl-paste` then
`xclip`), hands the bytes to the existing image-input path, and
reports one line when no helper or no image is available; no helper
is bundled or installed. Inline mode: every feature works on the
main-screen renderer: pickers, decisions, history overlay, search,
details, rewind; output stays bounded; PTY tests run the daily flow
under `--inline` and prove no alternate-screen sequence is emitted.
Accessible mode: no spinner (a changing ASCII status word), ASCII
markers beside semantic status, overlays announce title, item count,
and selected item as text, linear reading order, no color-only
meaning; headless tests at 80 columns. Performance: every gate in
DESIGN.md's table has a measuring test; report the numbers in the
handoff. Phase B exit: README daily-use walkthrough from install to
rewind; Known DSH gaps complete against the ledger; `dsh --profile
dashi` first-frame time measured and reported.
Not in scope: vim mode, Phase C matrix (tmux, screen, SSH terms,
fault injection), any new DSH capability.
Acceptance evidence: gate passes three runs; Ctrl+V with a fake
clipboard helper on PATH attaches an image that reaches the durable
log, and with no helper reports one line; the inline PTY flow
covers prompt, tool card, approval, picker, rewind, and exit with no
alt-screen sequence; accessible headless tests prove the announced
text for each overlay and the absence of spinner frames; the four
DESIGN.md performance gates each have a passing measurement; new
production source under 600 lines.

### W-012 `sessions list --json` and small carry-overs — status: accepted 2026-09-03 (899b8f3, merged to main)
Verified: pure 67-line parser and formatter, list mode exits before any
terminal object exists, PTY proves cwd filtering and the JSON envelope
with no alt-screen sequence. 112 production lines.
Owner: dsh-exec. Branch `w-012-sessions-list`.
First commit: bell-count unit cases for OSC 8 and OSC 52 with both
BEL and ST terminators.
Scope: the DESIGN.md 5.3 subcommand as a profile-provided entry:
`dsh --profile dashi sessions list [--cwd PATH | --all] [--json]`
prints the session catalog from `ctx.sessionController` list without
taking over the terminal and exits: human columns UUID, TITLE, CWD,
UPDATED; JSON envelope `{version: 1, sessions: [...]}` with sessionId,
title (nullable), cwd, updatedAt, and no `running` field (design
revision accepted in D-004: the flag is process-local).
`sessions show` stays dropped. Refuse when the profile boots with a
TTY takeover already requested (mutually exclusive with prompt,
--resume, --continue, --name, --image).
Not in scope: anything else; Phase C follows.
Acceptance evidence: gate passes; a PTY test proves the human table
and the JSON envelope for two sessions in one cwd and the --all
switch, no alt-screen sequence, exit 0; new production source under
120 lines.

### W-013 Default renderer and wheel scrolling — status: accepted 2026-09-03 (f2fa6f9, merged to main)
Verified: inline default with no alt-screen or mouse sequences; full
screen enables pi-tui tracking and a five-line pure wheel filter
behind a one-to-one forwarding Terminal; wheel scrolls without
disturbing the draft. 40 production lines. Nit for W-014: drop the
dead `--fullscreen` before `--inline` in one PTY launch string.
Owner: dsh-exec. Branch `w-013-scrolling`.
Scope per D-023: flip the default to inline and add `--fullscreen`;
in full-screen mode enable pi-tui mouse tracking and map wheel up and
down to the transcript scroll actions (state the lines per notch),
leaving Up/Down as prompt recall; no click handling beyond what the
design already allows; in inline mode mouse tracking stays off.
Update DESIGN.md 5.1 (default) and 13.1 (mouse rule) and README.
Acceptance evidence: gate passes; a PTY test in full-screen sends
wheel sequences and proves the transcript scrolls while the composer
text is unchanged and prompt recall is not triggered; a PTY test
proves inline mode emits no mouse-tracking enable sequence; the
default launch emits no alt-screen sequence; new production source
under 120 lines.

### W-014 `dashi` launcher package — status: accepted 2026-09-03 (598fab3, merged to main)
Verified by direct reading: 23-line bin, zero dependencies, inherited
stdio, signal forwarding, exact exit propagation, ENOENT hint only;
pack is bin, README, manifest; PTY proves identical first frame to the
direct command. 154 tests.
Owner: dsh-exec. Branch `w-014-launcher`.
Scope per D-024: packages/dashi-launcher with a `dashi` bin of under
30 lines and zero dependencies; execs `dsh` found on PATH with
`--profile dashi` prepended; on ENOENT prints one line saying DSH is
not installed with the install command; no profile-missing hint (amended
2026-09-03): DSH's own diagnostic already says `create it with 'dsh
plugin --profile dashi add <package>'` (pinned app-boot profile.ts:
805-815), and detecting it would need a stderr tee; stdio is fully
inherited; the exit code is propagated exactly; signals are forwarded
so Ctrl+C reaches DSH. Package manifest like the others (MIT, repository, engines,
public access), version 0.1.0-alpha.1, README with the three-line
install. Import lint covers it. README and DESIGN.md 5.1 gain the
launcher form and keep the alias as the alternative.
Acceptance evidence: gate passes; PTY tests prove `dashi` boots the
real profile identically to `dsh --profile dashi` (same first frame),
propagates a nonzero exit, prints the DSH-missing hint on ENOENT, and that the bin has
no dependency (npm pack contents listed); under 30 lines.

### W-015 Live slash completion and immediate command feedback — status: accepted 2026-09-03 (fd52c3a, merged to main)
Verified: completion opens on `/` and `@` without Tab and narrows by
prefix then substring; the cause of the silent command was the submit
effect awaiting execute inside the single queue, fixed by resolving on
the command/run admission record; one animation timer exists only
while a command is pending; unmatched pending command cells are
dropped at the seed boundary. 159 production lines, 160 tests.
Owner: dsh-exec. Branch `w-015-command-ux`.
Owner reports from daily use (2026-09-03): (1) the completion popup
opens only on Tab; Claude Code opens it as soon as `/` is typed at the
start of the line and narrows on every keystroke; (2) `/compact`
gives no feedback until it finishes.
Scope: completion opens automatically on `/` at line start and on `@`
anywhere, filters live by prefix then substring on each keystroke,
arrows move, Enter accepts, Esc closes, Tab still accepts; no new
state beyond the existing overlay and the current filter string.
Command feedback: the command cell appears the moment DSH logs
`command/run`, in a pending state with the spinner (or the ASCII
status word in accessible mode) and elapsed time, the status line
says "running /name", and `command/done` completes the cell; find
why the run record is not rendered before completion (a coalescing
or await-ordering defect in the runtime) and fix the cause, not the
symptom. Applies to every native and TUI command.
Acceptance evidence: gate passes; headless tests prove the popup
opens on `/` and `@` without Tab, narrows on typing, and Enter
executes the highlighted command; a PTY test with a slow fixture
command proves the pending row and status text appear before
`command/done` and complete after it, and the same for `/compact`
through the replay provider; new production source under 200 lines.

### W-016 Slash command and skill parity fills — status: accepted 2026-09-03 (895533f, merged to main)
Verified: /clear, /tasks, /context, /agents, /export over existing
services; the profile now disables the same 24 agent-plane rows as
DSH's Web profile, required by the preset package's mount audit, with
the default preset re-mounting them; skills proven end to end from
.dsh/skills; /mcp omitted as a DSH gap. 174 production lines, 163 tests.
Owner: dsh-exec. Branch `w-016-parity`.
Basis: audit of Claude Code's slash commands against the dashi
profile (2026-09-03). Skills already work Claude-style: DSH's skill
tool injects a skill named by a `/name` token in a user message
(pinned packages/skill/tool-skill/src/index.ts:177-203) and dashi's
completion lists user-invocable skills; the gap is discovery paths.
Scope, each a small command over an existing DSH service, none
adding state: `/clear` as an alias of `/new`; `/export [path]`
writing the current session transcript as Markdown to a file under
the session cwd through DSH's session query or controller history
(DSH's own export command is Web-only: session-log-export index.ts:76);
`/tasks` opening the existing jobs and subagents overlay; `/context`
showing the token-meter contextBreakdown projection; `/agents` as a
picker over agent presets if the session controller exposes preset
selection, else a listing (cite); `/mcp` as read-only status of
connected servers and tools if the MCP client exposes a list (cite),
else omitted and named as a DSH gap. Skills discovery: DSH's own paths only
(`.dsh/skills`, `.agents/skills`, configured custom dirs,
`$DSH_HOME/skills`, `~/.agents/skills`); dashi never reads
`.claude/skills` or `~/.claude/skills`, because DSH may need different
skills than Claude (owner decision 2026-09-03). README gains a skills
section: DSH discovery paths, SKILL.md format, the `/name` gesture,
and that `.claude/commands/*.md` prompt files are not a DSH mechanism. README Known DSH gaps gains: login, hooks, add-dir, memory
editing, Git diff, autocompact tuning, MCP management.
Not in scope: IDE, vim, theme, any Anthropic-account feature, any new
DSH capability.
Acceptance evidence: gate passes; each new command has a headless or
PTY test through the real registry; `/export` output verified as a
file with the turn's user and assistant text; skills from a
`.dsh/skills` fixture appear in completion and inject on `/name` in a
PTY test; new production source under 400
lines.

### W-017 Phase C: terminal matrix, fault injection, drift and install checks — status: accepted 2026-09-03 (a62de47, merged to main)
Verified: 187 tests, gate about 4.4 min; private tmux and screen
servers with in-pane restoration; TERM matrix including dumb; resize
synchronized on observed markers; four fault injections restore and
resume; drift test reads installed packages; clean install from packed
tarballs through the launcher; stray commit 4a685df reverted exactly
and reimplemented without its cross-branch coupling. 8 production
lines. Note for W-019: the clean-install test forces @antst/dashi to
the packed tarball via an override, which could mask a declared-range
drift; assert the declared range satisfies the packed version.
Owner: dsh-exec. Branch `w-017-hardening`.
Scope: (1) tmux and screen under private test servers, never the
user's: the inline daily flow and a full-screen flow with wheel, with
terminal restoration asserted inside the multiplexer pane; (2) TERM
matrix for the same flows: xterm-256color, tmux-256color, screen,
linux, and dumb (dumb must degrade to the accessible-style status
word and refuse nothing it can render); (3) resize during streaming
and during an open decision overlay in both renderers, asserting no
corruption and the overlay still answerable; (4) fault injection not
yet covered: broken stdout (EPIPE) mid-stream, stdin closed
mid-decision, SIGTERM during a pending command, a thrown presenter
during resize; each must restore the terminal and leave the session
resumable; (5) the D-025 drift test; (6) a clean-install test: pack
all three dashi packages, install into a fresh DSH_HOME with the
published DSH and `dsh plugin add`, run the daily flow through the
launcher, no workspace links; (7) README section "Terminals" stating
what is verified. macOS PTY runs are listed as verified only if a
macOS host runs the suite; otherwise the README says Linux-verified
and macOS by design.
Not in scope: new features; vim mode; anything the ledger lists as a
DSH gap.
Acceptance evidence: gate passes three runs with the matrix included
(report total gate time); every new case cites its assertion; new
production source under 100 lines (this item is tests and docs).

### W-018 Inline scrolling defect — status: accepted 2026-09-03 (e8d91c2, merged to main); owner confirmed scrolling by hand 2026-09-03
Verified by direct reading: 8 added lines; inline passes the whole
loaded transcript to TuiMainScreen; PageUp and Ctrl+Home open history
inline; PTY proves scrollback retention, no clear between chunks, no
alt-screen or mouse sequences. Carry-over into W-017: the launcher
signal timeout and the long-turn bell timing tests were flaky once in
a full run; make both deterministic (wait on observed state, not
elapsed time).
Owner: dsh-exec. Branch `w-018-inline-scroll`.
Owner report 2026-09-03: scrolling still does not work in the default
(inline) mode. Diagnosis to confirm: dashi renders a fixed-height
viewport slice and repaints in place, so committed lines never enter
the terminal's scrollback, and inline mode has mouse tracking off, so
the wheel reaches neither the terminal's history nor dashi. D-023's
claim that inline gives native wheel scrolling was wrong for dashi.
Step 1, report before code: reproduce in the dashi-dev profile with the
launcher; then establish from pi-tui 0.84.4 source what TuiMainScreen
does when the component tree exceeds terminal height (does it emit
overflow lines once into scrollback and repaint only the visible
bottom, as pi's own coding agent relies on), with file:line.
Then propose one of two designs with a size estimate: (A) inline mode
enables the same mouse tracking and wheel filter as full screen,
dashi keeps the viewport model in both modes, native selection needs
the terminal's bypass modifier; (B) inline mode is append-only:
committed cells are emitted once through the main-screen renderer and
flow into native scrollback, only the live tail, decisions, overlays,
composer, and status repaint, PageUp and Ctrl+Home in inline mode open
the history overlay instead of paging in place, lazy paging stays for
full screen and the overlay, mouse tracking stays off, wheel and
native selection are the terminal's. State which the reducer and fold
support unchanged. The architect chooses; the preference is (B) if
pi-tui supports it without patching, because it is the Claude Code
model and needs no mouse tracking.
Acceptance evidence: PTY test in the default mode proves that after a
transcript longer than the terminal height the older lines are present
in the PTY's scrollback (baseY above zero and the first turn's text
retrievable) with no alt-screen or mouse sequences; a streaming turn
appends without a full replay (assert the output between two chunks
contains no clear sequence); PageUp opens the history overlay inline;
full-screen behavior unchanged; README states the inline replay
caveat for Ctrl+O and resize; the owner confirms by hand; new
production source under 70 lines.

### W-019 Release readiness: 0.1.0-alpha.2 — status: accepted 2026-09-03 (bc2798a, merged to main, tagged v0.1.0-alpha.2)
Verified by direct reading: identical versions, app range asserted
against the packed plugin, DESIGN.md 871 lines with no withdrawn
claim, factual CHANGELOG, host-contract fixture reads the accessor
once per event, stray worktree removed, pack listings clean. Zero
production lines. The v0.1.0-alpha.1 tag remains as history and must
not be published (D-026).
Owner: dsh-exec. Branch `w-019-release`.
Scope: (1) versions 0.1.0-alpha.2 for @antst/dashi, @antst/dashi-app,
@antst/dashi-launcher, identical; the app's declared range on the
plugin must satisfy that version and the clean-install test asserts
it in addition to the override (W-017 note); (2) a short CHANGELOG.md
at the repo root listing what the alpha contains and the Known DSH
gaps, no marketing; (3) DESIGN.md doc pass for everything since the
W-010 pass: inline default and append-only document (D-023, D-027),
launcher (D-024), packaging as peers (D-026), sessions list, parity
commands, agent presets in the profile, drift test, terminals
section; under 900 lines; (4) the DESIGN.md section 15.5 host-contract
fixture test if not already present: a tiny fixture plugin reading
`ctx.tuiRoot.current()` once and observing exact `tui/root-changed`
pairs across /new and /resume, using only public exports (cite if
W-003's tui-root tests already satisfy it); (5) `git worktree list`
hygiene: report any stray worktrees under /home/antst other than
dtui, dtui-main, roller, roller-main, and do not remove them, list
them for the architect; (6) `pnpm pack --dry-run` for all three
packages listed in the handoff.
Acceptance evidence: gate passes three runs; pack listings; the
clean-install test range assertion; DESIGN.md contains no withdrawn
claim (grep proof for `viewport` claims about inline mode, `dashi bin`
absence claims, and `dependencies` for DSH services); new production
source under 40 lines.

### W-020 Exact DSH pins and resolved-graph assertion — status: accepted 2026-09-03 (43a145f, merged to main, tagged v0.1.0-alpha.3)
Verified by direct reading: 24 and 6 exact rc.1 pins, boot
cross-check of dsh-base against the CLI, README pnpm-only install and
fresh-lockfile upgrade note; 189 tests three runs. Open doubt: the
wildcard override is verified on pnpm 11 in the clean-install test;
verification on pnpm 10 is done during the owner's profile rebuild.
Owner: dsh-exec. Branch `w-020-exact-pins`.
Scope per D-029: exact versions for every @deepseek-ai/* peer and
dependency in @antst/dashi and @antst/dashi-app (validated-dsh-versions
remains the single source; a gate check asserts the manifests match
it); clean-install test asserts the resolved graph (every
@deepseek-ai/* in the fresh profile and in the fresh CLI install
equals the validated version) and fails otherwise; README install
section: `pnpm install @deepseek-ai/dsh@<v>` plus a pnpm-workspace.yaml
`overrides` block pinning `@deepseek-ai/*` to `<v>`, with the reason
in one sentence; npm is stated as unsupported for prerelease DSH
because its `overrides` field has no scoped wildcard (builder verified
2026-09-03: npm accepted the field and still resolved about 200
packages at rc.1) and a generated exact map is rejected as brittle; the
clean-install test may keep npm for the fresh CLI prefix if pnpm's
ignored-builds gate makes the pnpm path larger; the boot version probe additionally checks one library
package version (dsh-base) against the CLI version and warns on
mismatch. Also: recreate the owner's profile against their rc.1 home install
(with the architect's go), and verify boot.
Added 2026-09-03: this item also bumps all three dashi packages to
0.1.0-alpha.3 with a CHANGELOG entry ("validated against DSH
0.1.2-rc.1; DSH versions pinned exactly; upgrade requires a fresh
lockfile") and a README upgrade note that upgrading DSH means removing
node_modules and the lockfile, not an incremental install.
Acceptance evidence: gate passes three runs; the clean-install test
proves the exact graph; a deliberate mismatch fixture fails the
assertion; the owner's installed `dsh --profile dashi` boots and
answers one prompt; new production source under 40 lines.

### W-021 Validate DSH 0.1.2-rc.1 — status: accepted 2026-09-03 (d4c2e30, merged to main)
Zero production changes; no relied-on contract moved; reference tree
is tag dsh-v0.1.2-rc.1 (a66e470); 187 tests green three runs plus one
confirmation. The 25 initial failures were the workspace lockfile's
stale peer-only alpha.5 packages (tool scheduler Symbol mismatch,
rc.1 tool-calls.ts:170, tools/src/index.ts:459), cured by a clean
node_modules and lockfile install, the same hazard as the owner's home.
Owner: dsh-exec. Branch `w-021-rc1`.
Scope: bump validated-dsh-versions to 0.1.2-rc.1 and the pinned
reference tree, run the full gate, and report every failure with the
DSH change that caused it; fix dashi where its own code broke; stop
and report where rc.1 removed or changed a DSH contract dashi relies
on. The result is either an accepted rc.1 pin or a ledger decision to
stay on alpha.5 with the reasons.
Acceptance evidence: gate green three runs at rc.1 or a stop report;
roller gets the same treatment in its own ledger afterwards.

### W-022 README install note without the override — status: accepted 2026-09-03 (4c282cb, merged to main)
Docs only; grep-proven; 189 tests.
Owner: dsh-exec. Branch `w-022-readme-install`.
Scope per D-031: remove the pnpm-workspace.yaml override block and its
justification from the root and package READMEs and DESIGN.md; keep
the exact CLI version in the install command, the npm-unsupported
sentence (DSH's own caret ranges resolve a mixed prerelease graph
under npm), and the fresh-lockfile upgrade note; add one sentence that
dashi validates each DSH release and its packages pin DSH exactly. If
the clean-install test writes that override into its fresh prefix,
remove it there too and keep the resolved-graph assertion. Docs only;
zero production lines.
Acceptance evidence: gate passes once; grep proves no `overrides` text
remains in the READMEs and DESIGN.md.

### W-023 Ctrl+D exits only when pressed twice — status: accepted 2026-09-03 (969387c, merged to main)
Verified by direct reading: Ctrl+D delegates to the existing Ctrl+C
arm; 14 production lines; 191 tests.
Owner: dsh-exec. Branch `w-023-ctrl-d`.
Owner report from daily use (2026-09-03): a single Ctrl+D exits dashi;
Claude Code requires it twice, and a single keystroke risks an
accidental kill. Scope: Ctrl+D on an idle root with an empty composer
arms exit exactly as Ctrl+C does, showing the same "press again to
exit" status, and exits on the second press; any other key disarms;
Ctrl+C and Ctrl+D share one arm state, so Ctrl+C then Ctrl+D also
exits (two keystrokes either way). Behavior with a nonempty composer
or a running root is unchanged. Update the key table in DESIGN.md,
the README, and /help. Reducer-only change plus tests.
Acceptance evidence: gate passes; reducer tests for single press
(armed, no exit), second press (exit), disarm on another key, and the
mixed Ctrl+C then Ctrl+D case; the existing PTY exit tests that used a
single Ctrl+D are updated to two; new production source under 20
lines.

### W-024 `--resume` parity — status: accepted 2026-09-03 (8c4888b, merged to main)
Verified by direct reading: bare --resume and -r open the cwd-scoped
picker before the terminal binds, -c aliases --continue, --all in
picker mode, unknown exact id exits 1 with DSH's own message. 59
production lines; 194 tests.
Owner: dsh-exec. Branch `w-024-resume`.
Owner report from daily use (2026-09-03): "dashi does not support
--resume". Step 1, reproduce through the installed launcher on the
owner's rc.1 profile (read-only): `dashi --resume`, `dashi --resume
<uuid of an existing session>`, `dashi --continue`, and report the
exact output and exit code of each. Step 2, parity with Claude Code:
bare `--resume` (and `-r`) opens the session picker at startup, the
same picker `/resume` uses, over the current cwd with `--all`
honored; `--resume <UUID>` stays exact; `--continue` (and `-c`) stays
as is; a UUID that does not exist prints DSH's own not-found error
and exits 1; `--resume` combined with a prompt argument resumes then
submits the prompt. Key table, README, /help, and DESIGN.md 5.1
updated. If step 1 shows the launcher or DSH drops the argument,
report before fixing.
Acceptance evidence: gate passes; PTY tests for bare --resume opening
the picker and selecting a session, exact --resume, unknown UUID
error, and --resume with a prompt, all through the launcher; new
production source under 60 lines.

### W-025 Launch flags: permission, yolo, model, effort — status: open (after W-029)
Owner: dsh-exec. Branch `w-025-launch-flags`.
Owner report (2026-09-03): no `--yolo` or
`--dangerously-skip-permissions`. Audit: DESIGN.md 5.1 lists
`--permission PRESET`, `--model ID`, `--effort ID`, `--provider ID` as
launch-scoped flags and none is implemented. Scope: `--permission
<preset>` applied at bind through the same native `/permission`
command path the picker uses (durable DSH fact, no dashi state);
`--dangerously-skip-permissions` and `--yolo` as aliases for
`--permission danger-full-access`, with no confirmation at launch
because the flag is the explicit consent, and the status line showing
the preset as it already does; `--model <id>` and `--effort <id>`
applied through `sessionController.selectModel` at bind, with
`--provider` accepted only if the catalog needs it to disambiguate
(cite); unknown preset or model prints DSH's own error and exits 1.
All launch-scoped: nothing written to settings. Key table, README,
/help, DESIGN.md 5.1 updated.
Acceptance evidence: gate passes; PTY tests through the launcher prove
`--yolo` starts with danger-full-access and a bash escalation runs
without an approval overlay, `--permission read-only` refuses a write,
`--model` changes the durable selection, unknown values exit 1 with
DSH's message; new production source under 80 lines.

### W-026 Rewind flow per Claude Code — status: accepted 2026-09-03 (d4182dd, merged to main); owner hand check pending on alpha.4
Verified: pure rewind module, four action rows with roller-gated code
rows, first-prompt paths through create plus selectModel and
/roller-restore start, double Esc draft recall; 93 production lines;
197 tests.
Owner: dsh-exec. Branch `w-026-rewind-flow`.
Scope per D-032. Screen 1, title "Rewind to a prompt": one row per
human prompt in session order (steered ones included, suffixed
"· mid-turn"), text truncated to width, newest last, cursor on the
last; Esc closes. Screen 2, title is the selected prompt text
truncated: rows "Restore code and conversation", "Restore
conversation", "Restore code", "Never mind"; the two code rows only
when `roller-restore` is listed by name; "Never mind" returns to
screen 1. Actions: conversation restore = existing controller fork at
the boundary before that prompt (for a mid-turn prompt, the boundary
before its turn), switch roots, composer set to the prompt text;
code and conversation = the same plus `/roller-restore <seq>` in the
child; code only = `/roller-restore <seq>` in the current root, no
fork. First prompt (ruled 2026-09-03; DSH cannot fork before the
first completed turn, commands.ts:211-227): conversation restore =
`sessionController.create` of a fresh root in the same cwd with the
current session's agent preset and model selection passed
explicitly, then switch roots, composer set to the prompt text; code
only = `/roller-restore start` in the current root (roller W-006);
code and conversation = `/roller-restore start` in the current root
first, then the fresh root. /status shows no lineage for that root. Remove the "latest" row, the "edit and resend" and
"conversation only" labels, and the "Files will not be changed"
notice (replace with the absence of the code rows plus one README
sentence). Double Esc with a nonempty composer clears the draft into
prompt history (Up recalls) instead of opening rewind. rewind.ts
stays pure; the reducer imports nothing. README names two DSH gaps:
fork granularity is per turn, and no range summarization.
Acceptance evidence: gate passes; PTY tests through the launcher for
each of the three restore actions with roller installed (files
restored for the code paths, untouched for conversation only),
"Never mind" returning to screen 1, code rows absent without roller,
a steered prompt listed and rewinding to its turn start, and double
Esc clearing a draft recallable with Up; headless captures of both
screens at 80 columns in the handoff; new production source under
150 lines; the owner confirms by hand.

### W-027 Collapse injected context cells — status: open (after W-026)
Owner: dsh-exec. Branch `w-027-context-cells`.
Observed in the W-024 reproduction: on resume, DSH's injected
workspace instructions (a plugin message with a context form, e.g.
`instructions` or `snapshot`, carrying AGENTS.md) render in full as a
transcript cell, dozens of lines above the first prompt. Scope: any
user-role message whose source is `{kind:'plugin'}` with a
`ContextFormed` form (instructions, catalog, snapshot, notice, recall)
renders as one collapsed row: "Context · <form> · <first line or
summary> · N lines", expandable through the existing card mode
(Ctrl+O) and the history overlay, never expanded by default; relay
messages keep their current rendering. The fold classifies by the
source fields only, no text parsing. Reducer unchanged.
Acceptance evidence: gate passes; a recorded-log fixture with an
instructions injection folds to one collapsed row and expands under
Ctrl+O; the resume PTY test asserts the prompt is visible in the
first screen with the context row above it collapsed; new production
source under 60 lines.

### W-028 Resume by session name — status: accepted 2026-09-03 (156c0c8, merged to main)
Verified by direct reading: one pure resolver (id shape, exact title,
substring, cwd or all) shared by launch and /resume; native titles
only; 56 production lines; 196 tests.
Owner: dsh-exec. Branch `w-028-resume-by-name`.
Owner requirement (2026-09-03): `--resume <value>` and `/resume
<value>` accept a session name as well as a UUID. Resolution, in
order: a value shaped like a DSH session id resumes exactly; else an
exact title match among sessions in the current cwd (all cwds with
`--all`); if exactly one matches, resume it; if several match, open
the existing picker restricted to the matches; if none match, fall
back to a case-insensitive substring match with the same one, many,
none rule; none at all prints one line naming the value and exits 1
(or, for /resume, shows the notice). Titles come from DSH's native
session title only; no dashi name store. `--name TITLE` on launch and
`/rename TITLE` are already native and unchanged; README documents
the three together in one short "Sessions" section, including that
names need not be unique and the picker resolves duplicates.
Acceptance evidence: gate passes; PTY tests through the launcher:
`--resume <unique title>` resumes it; two sessions with the same
title open the picker showing only those two; substring match; no
match exits 1; `/resume <title>` in-session; new production source
under 60 lines.

### W-029 dashi-app bundles roller — status: accepted 2026-09-03 (PR #1 merged into develop; released as 0.1.0-alpha.4)
dashi-app pins @antst/roller 0.1.2 and inserts its row; clean-install
proves /roller-restore and the code rows after adding only dashi-app;
8 mechanism lines; 197 tests.
Owner: dsh-exec. Branch `w-029-bundle-roller`.
Scope per D-033: `@antst/dashi-app` depends on `@antst/roller` at the
exact version from roller's main (0.1.2 once roller bumps for W-006;
coordinate: roller-exec bumps first), inserts the roller row in
cordis.patch.yml after dashi's row, and its package README says roller
is included. `@antst/roller@0.1.2` is published on npm (2026-09-03), so the
dependency resolves from the registry with no tarball override.
Clean-install test: after only `dsh plugin add @antst/dashi-app`, the
profile lists roller-restore in `/help` and the rewind picker shows
the code rows. README install section unchanged (one add command);
the owner's profile rebuild then adds only dashi-app.
Acceptance evidence: gate passes; clean-install test proves the above;
no change to `@antst/dashi`; new production source under 10 lines.

### W-030 CI/CD on GitHub Actions for dashi — status: open (after W-029)
Owner: dsh-exec. Branch `w-030-ci` from `develop`; pull request against
`develop`.
Scope: mirror roller's two workflows. `ci.yml`: on pull_request and
push to develop and main: checkout, pnpm from the packageManager
field, Node 22, apt install tmux and screen (the gate needs both),
`pnpm install --frozen-lockfile`, `pnpm gate` (allow 20 minutes); on
pull_request and develop pushes, after the gate: `pnpx pkg-pr-new
publish ./packages/dashi ./packages/dashi-app
./packages/dashi-launcher --pnpm --compact`. `release.yml`: on GitHub
release published: gate, then `pnpm publish --access public
--provenance --no-git-checks` in packages/dashi, then dashi-app, then
dashi-launcher, in that order, with id-token: write; a prerelease tag
publishes under the npm `alpha` dist-tag (derive from the version
string). package.json repository, homepage, and bugs point to
https://github.com/antst/dashi with the directory field. README
"Development" section. Nothing else.
Acceptance evidence: PR CI green on GitHub except the preview step
until the owner installs the pkg.pr.new app; both YAML pass
actionlint; zero production source changes.

### W-031 Exit arm expires after two seconds — status: open (after W-030, before W-025)
Owner: dsh-exec. Branch `w-031-exit-arm-timeout`; PR against develop.
Owner report from daily use (2026-09-03): the exit arm never expires;
a first Ctrl+D and a second one a minute later still exit. Claude
Code's arm lapses after a short window. Scope: when the reducer arms
exit (Ctrl+C or Ctrl+D), it emits one effect that schedules a single
timer of 2000 ms dispatching the existing `disarm-exit` action; a
second press inside the window exits; a press after it re-arms with
the hint again; any other key still disarms immediately and clears
the timer; arming again resets the timer. One timer, cancelled on
disarm and on dispose; no new state beyond the existing arm flag.
Key table and README say "press again within two seconds". This is a
key-chord timer, which DESIGN.md's render scheduling permits.
Acceptance evidence: gate passes; reducer tests for arm, disarm via
the timer action, re-arm after expiry; a PTY test proves a second
Ctrl+D after 2.5 s does not exit and the hint is gone, while a second
within 500 ms exits; new production source under 25 lines.

## Backlog

### B-001 Workspace restore plugin (Claude Code style file rewind) — status: backlog
A separate DSH plugin, not part of the dashi TUI: e.g. `@antst/dsh-checkpoint`
in its own package or repo. Records the before-content of every file
touched by DSH's own file-mutation tools, keyed by the turn boundary
DSH already logs, and exposes one native DSH command to restore the
workspace to a chosen boundary plus durable session events for what was
restored. dashi's rewind picker then offers "conversation only" or
"conversation and files" by calling that command; no TUI-side storage.
Constraints: storage through DSH's storage service under its sandbox
rules; only DSH-tool edits are covered, and shell/hook/external edits
are stated as not covered; no Git reset or stash; bounded per-session
size with a plain eviction rule. Not scheduled; opens after Phase B.
Origin: owner request 2026-09-02, DESIGN.md 8.2.

## Upstream reports

- 2026-09-02 DSH Discussion: JSONL session ownership is process-local, allowing concurrent writers (D-015). https://github.com/deepseek-ai/deepseek-harness/discussions/5460
- 2026-09-02 pi issue: expose frameless and prompt-prefix options on Editor (D-013). https://github.com/earendil-works/pi/issues/9032
- 2026-09-02 DSH Discussion (Ideas): policy-aware FileSystem delete primitive for plugins (roller D-003). https://github.com/deepseek-ai/deepseek-harness/discussions/5461
- Status 2026-09-02: pi issue 9032 auto-closed by the contributor gate pending a maintainer reply; DSH 5460 has one community reply, no maintainer reply yet.
- 2026-09-02 DSH Discussion (Ideas): presentCall/presentResult on CommandDefinition (D-017 release). https://github.com/deepseek-ai/deepseek-harness/discussions/5462
- 2026-09-02 DSH Discussion (Ideas): ignorable marker for out-of-tree session event types (D-017 release). https://github.com/deepseek-ai/deepseek-harness/discussions/5463
- Status 2026-09-02 (later): no maintainer replies on any thread; one community reviewer corroborated all four DSH reports. Prior art they cited: session lock 5460 duplicates issues 1452 and 1333, community fix in PR 1550 (writer lease, unmerged); ignorable events 5463 is the sixth report after 1538, 1584, 1619, 2778, 3191; delete 5461 design notes (absent target succeeds, unlink must not follow the final component) already hold in roller. pi 9032 remains auto-closed pending maintainer review.
- 2026-09-03: the pi Editor frame/prefix change is being prepared on a fork branch (antst/pi, editor-frame-prefix) by the upstream lane, tests in pi style, no PR until a maintainer replies lgtm on issue 9032.
- 2026-09-03: pi Editor frame/prefix change ready on the fork: https://github.com/antst/pi/tree/editor-frame-prefix (commit c53792b, base upstream 4e69b0c); 52 changed lines in editor.ts plus a 103-line test file; all 920 pi-tui tests and the repo check pass. PR opens only after maintainer lgtm on issue 9032.
- 2026-09-03: fork branch editor-frame-prefix independently reviewed: PASS (scope, spec, byte identity, conventions; unrelated upstream failure confirmed pre-existing). PR-ready pending lgtm.
- Queued (not yet posted): DSH Discussion on two install hazards: (1) the `@deepseek-ai/dsh` CLI's caret ranges on its own packages resolve a mixed prerelease graph (alpha.5 CLI with rc.1 libraries fails to load); (2) nineteen packages (dsh-attachment, dsh-fs, dsh-shell, dsh-jobs, dsh-sandbox, dsh-compaction, dsh-session-persistence, dsh-session-query, dsh-settings, dsh-code-runtime, dsh-bash-local, dsh-workflow, dsh-spill, dsh-output-retention, dsh-session-telemetry, dsh-session-title-llm, dsh-authorization, dsh-anonymous-user-id, dsh-subagent-in-process-driver) are reached only as peer dependencies, so a user upgrading with an existing lockfile keeps stale versions that pnpm treats as satisfied (proven 2026-09-03: only a node_modules and lockfile wipe refreshed them); suggest a boot-time peer-version check or making them dependencies. Release to the lane when convenient.
- 2026-09-03: branch link posted on pi issue 9032: https://github.com/earendil-works/pi/issues/9032#issuecomment-5518628396

### B-002 Agent Sessions adapter in the dashi profile — status: backlog
Load the AS-owned adapter into the dashi profile so an interactive
dashi session is addressable as a peer: the adapter binds to
`ctx.tuiRoot.current()` and follows `tui/root-changed` on /new,
/resume, /fork, /rewind; decisions stay with the terminal user
(no preset override in the interactive profile). Needs the adapter to
expose the terminal-bound-root branch it already planned for; dashi
side is expected to be documentation and a fixture test of the host
contract (DESIGN.md section 11), no new mechanism. Opens after Phase C.
