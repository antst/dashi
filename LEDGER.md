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
### D-035 (2026-09-03) alpha.7 is cut after W-027; plugin management is W-034
Owner decision: when W-027 is accepted, the builder prepares the
release (bump all three manifests to 0.1.0-alpha.7, one CHANGELOG
section covering W-025, W-027, W-032) as a pull request against
develop; the architect merges develop to main and pushes the tag. No
new work item starts before the tag is pushed. Plugin management in
the session (Claude Code's /plugin and /mcp) is a real gap under rule
1 and becomes W-034, first item after the tag.
### D-036 (2026-09-03) Agent Sessions: one name, groups by launch flag
Owner ruling. For a DSH session the Agent Sessions name IS the DSH
session title: one fact, owned by DSH's title service. `dashi --name`
and `/rename` are therefore the only name surfaces; the comms plugin
reads the title and sets it when a wrapper passes a name through the
environment. Groups have no DSH-owned fact, so dashi exposes them as
`-g <group>` / `--group <group>`, repeatable, the same spelling as the
Agent Sessions launchers, implemented as the native
`/agent-sessions group <g>` command run at startup (the W-025 rule:
launch flags are the interactive commands applied before the first
prompt). The launcher stays a plain forwarder; no environment
synthesis. dashi-app bundles `@agent-sessions/dsh-comms` at an exact
published version (closes B-002).
### D-037 (2026-09-03) Second builder on dashi
Owner decision: roller-exec (peer codex-roller), idle since roller
W-010, also builds dashi items. Rules: its own checkout at
~/dtui-2 (never ~/dtui, which belongs to dsh-exec); one builder per
checkout; items assigned by the architect with disjoint code areas;
same handoff protocol, same gate, same squash-merge. Assignment
now: W-039 /config and W-041 /login and /logout to roller-exec;
W-037, W-038, W-040 stay with dsh-exec. Later items are assigned at
acceptance time.

### D-038 (2026-09-04) macOS builder peer
Owner decision: macOS is a primary target and mac behavior cannot be
fixed blind from Linux. A Codex peer on the owner's mac
(`mac-dashi`, host mbp-lan, checkout /Users/antst/work/ai/dashi)
joins as a builder under the same protocol as dsh-exec and
roller-exec: branches from develop, PRs against develop, hosted gate,
squash-merge by the operations peer. It owns mac items; W-066's
hosted macos-latest job stays the durable regression gate. Its first
job is the host gate on the mac plus a real-terminal check, reported
as a classified list before any code.

### D-039 (2026-09-05) Agent Sessions: launch token selects the lane profile; -g via environment; amends D-036
Owner rulings relayed through the Agent Sessions architect and the
accepted proposal (agent-sessions-dsh repo, docs/PROPOSAL.md,
73aafda). There is no --lane flag. Lane mode is the presence of
AGENTBUS_LAUNCH_TOKEN in the environment; the daemon runs
`dashi` with an empty argv. The dashi launcher does exactly two
things beyond forwarding: with the token present it spawns
`dsh --profile agentbus` (headless bundle + the plugin row with
mode: lane + session-controller and workspace rows), otherwise
`--profile dashi`; and it parses `-g/--group` (repeatable,
comma-splitting) into AGENTBUS_GROUPS as a JSON array string,
forwarding everything else untouched. The plugin never reads argv.
D-036's startup `/agent-sessions group` call is dropped: groups have
one source, the environment; the plugin's `/agent-sessions` command
is read-only in v1. The package is `@agentbus/dsh` (the
predecessor `dsh-comms` becomes a deprecated alias); dashi-app ships
it in peer mode by default at an exact npm pin; one connection per
root session; one name, the DSH title, re-announced in place on the
same connection. Cost recorded: the launcher is no longer a pure
forwarder (about 35 lines), and `dsh --profile dashi` without the
launcher has no -g.
Rename 2026-09-05: the bus product is agentbus; package @agentbus/dsh, kit @agentbus/kit, profile name `agentbus`, environment AGENTBUS_*.

### D-040 (2026-09-18) DSH 0.1.5-rc.2 minimum, 0.1.6-alpha.2 supported; sessionbus-dsh owned here
Owner rulings. dashi and the sessionbus plugin must work on DSH
0.1.5-rc.2 (minimum supported) and 0.1.6-alpha.2. Pins: DSH
packages stay peers, and the peer range is the disjunction of the
validated versions, `0.1.5-rc.2 || 0.1.6-alpha.2`, never a caret or
an open range; validated-dsh-versions.json lists both and the DSH
version gate accepts exactly one of them for the whole graph; the
container gate runs once per listed version. Ownership: the architect
now owns antst/sessionbus-dsh (implementation, package, DSH
compatibility) under this ledger and protocol; pdev keeps the daemon,
protocol, and @sessionbus/kit. Host updates: the dsh host is upgraded
by the architect's agents after the gate passes on the new version
(in place: `pnpm add --save-exact @deepseek-ai/dsh@<version>` in ~, then verify the lockfile holds no DSH package at another version, pruning only DSH entries if stale peers remain; never wipe ~/node_modules, which is shared with other tools; then rebuild the dashi profile); umka-dev1 by one pdev writer on the architect's
instructions; the mac when a mac peer exists. Install inventory
2026-09-18 on the dsh host: single home-level install
(dsh 0.1.2-rc.1, launcher alpha.17), no global copies, profiles
`dashi` and a stale `agent-sessions`.

### D-041 (2026-09-19) DSH compatibility is a floor, not an allowlist (supersedes the pin form of D-040)
Owner rulings 2026-09-19. Minimum supported DSH stays 0.1.5-rc.2.
Newer prereleases are admitted without an exact allowlist and without
an upper cutoff; a boundary is excluded only when a break is
demonstrated and named in this ledger. Encoding, verified empirically
with pnpm 10.28 (its peer check is yarn's satisfiesWithPrereleases:
build the range with includePrerelease, and if the strict test fails,
strip the prerelease tag from the version and from every comparator):
every `@deepseek-ai/*` peer range in dashi, the sessionbus plugin, and
roller is `>=0.1.5-rc.2`, which admits 0.1.6-alpha.1, 0.1.6-alpha.2,
0.1.7-alpha.1 and 0.2.0-alpha.1 without a warning and rejects 0.1.4
and 0.1.2-rc.1 (it also admits 0.1.5-rc.1 and 0.1.5-alpha.x, untested;
accepted, no check is added for it); `@deepseek-ai/cordis` `^4.0.2`,
loader `^1.0.3`; no peerDependenciesMeta. The same string as a
dependency range resolves to the `latest` dist-tag (0.1.5-rc.2 today),
never silently to an alpha. Exact versions live only in devDependencies,
the pnpm catalog, and lockfiles, for CI reproducibility.
validated-dsh-versions.json becomes `{"minimum": ..., "tested": [...]}`
consumed only by CI matrices and docs; tested is 0.1.5-rc.2,
0.1.6-alpha.1, 0.1.6-alpha.2. 0.1.6-alpha.1 is a third state, not a
midpoint: it already has `agent/created`, the ptc runtimes and the
`CommandSubmitAttachment` type, but has no dsh-plugin-manager, the old
`dsh plugin` CLI, no `session/writer-held`, and still carries
SessionQueuedItem (scratchpad report dsh-delta/alpha1.md). No runtime
version check remains anywhere beyond dashi's `dsh` versus `dsh-base`
mismatch warning. Uninstall and recovery never require a bootable DSH
or a particular pnpm version; `dsh plugin` itself never boots the
profile (dsh lib/bin.js:225-229 forwards to pnpm in the profile
directory), so the missing piece is a plugin uninstall, not a DSH fix.
Cold resume on rc.2 and later is quadratic in event count (DSH
token-meter, packages/llm/token-meter/src/breakdown-projection.ts:56-75,
introduced by upstream commit 6525195953 of 2026-09-07, live at HEAD,
unreported upstream; measured 10k 1.6 s, 50k 12 s, 100k 47 s, 200k
183 s on both rc.2 and alpha.2, rc.1 200k 2.3 s): the gate asserts the
50k fixture at the measured rc.2 bound and the 200k numbers stay
documented as a named DSH gap; a smaller gate is not a repaired
regression. The sessionbus daemon must not know `dsh --profile
sessionbus`: the plugin ships its own launcher bin that the daemon
invokes as a generic product command, and that bin selects the profile.

### D-042 (2026-09-20) The lane profile carries the host's selected provider
Found on the dsh host's own upgrade: a daemon-launched lane spawned and
was claimed, but its turn ended with DSH code NO_ADAPTER, "no adapter
registered for provider openai-codex". The host's global
$DSH_HOME/settings.yaml selects a provider that dsh-base does not
register (dsh-base carries llm-deepseek / deepseek-official only); the
dashi profile works because the owner added the provider plugin
packages there. The accepted lane profile definition ("dsh-base only")
is therefore amended: the sessionbus lane profile is dsh-base plus the
provider plugin packages the host's selected provider requires, at the
same exact DSH version as the host, added by the host install runbook
after reading the provider name from settings.yaml, and checked by one
headless boot that reports no NO_ADAPTER. Credentials are unchanged:
for deepseek-official a daemon-launched lane must reach
DEEPSEEK_API_KEY through the credentials-local order (process env,
$DSH_HOME/.credentials.yaml, cwd .env, $DSH_HOME/.env; rc.2
packages/credentials/credentials-local/src/index.ts:557-624); the
daemon's service environment does not inherit the login environment.
Neither the plugin nor the daemon changes.

### D-043 (2026-09-20) Host graph truth is the install anchor and the healed fallback, not the lockfile
Found on umka after the exact-pin repair: the lockfile was uniform at
0.1.5-rc.2 while the physical top-level ~/node_modules/@deepseek-ai
projection (hoisted install) still held unpacked 0.1.2-rc.1 copies and
the shared $DSH_HOME/profiles/node_modules fallback had links into a
removed rc.1 generation. Source (rc.2): DSH resolves from the executing
dsh package in the pnpm virtual store (INSTALL_ANCHOR,
apps/cli/src/profile-boot.ts:78,187-191,226-243), bundles from the
installation anchor first with dsh-base guaranteed from the running
install (packages/boot/app-boot/src/profile.ts:718-761), and on every
profile launch checks the expected fallback closure (dependency and
peer BFS from the anchor, :469-504) and replaces wrong, broken and
missing expected links (:507-528, :201-239, :552-577) without pruning
extras; rows import relative to the profile root (app-boot
index.ts:787-804; cordis-plugin-loader src/config/tree.ts:144-160). No
DSH path is anchored at top-level ~/node_modules. Rulings: (1) the
runbook's graph check is physical: top-level projection inventory
(one version for the host and the dashi profile) and the expected
fallback closure exact; the lockfile check alone proves nothing. (2)
After any host package change the required reconciliation is one
headless boot from the real launcher plus the closure check; stale
top-level copies on a hoisted install are cosmetic for DSH and a hazard
only for other code anchored at ~, and the proven optional cleanup is
`pnpm install --frozen-lockfile --force` (isolated hoisted
reproduction: 214 rc.1 to 231 rc.2, lockfile hash and unrelated
packages unchanged); never a node_modules deletion. (3) The dsh host
is an isolated-linker install and was physically uniform after the
pins (26/26 host, 231/231 fallback at rc.2).
Addendum 2026-09-20: the runbook revision at sessionbus-dsh 20628a7
asserted one version for the host's top-level projection, which
contradicts ruling (2) above and stopped umka's pre.7 re-pin on a
hoisted install. The host section's mandatory assertions are: the
lockfile uniform at the target; the executing install anchor at the
target (resolve @deepseek-ai/dsh/package.json from the realpath
directory of the launcher's dsh bin); headless boot exit 0 and the
shared fallback closure exact. The top-level projection is reported
(counts per version and the list), never asserted; the optional
`--force` cleanup stays optional. Profiles keep their physical
one-version assertion. Corrected in the W-088 runbook change.
Closing note 2026-09-21: both hosts finished the DSH 0.1.5-rc.2 move
under this ruling and the runbook at sessionbus-dsh main 101e234. dsh
host (dsh-exec): dashi profile dashi-app 0.1.0-alpha.21 exact,
launcher 0.1.0-alpha.21 exact, profile lock 21/21 at rc.2, executing
anchor rc.2, headless heal, closure 479 exact, `dashi --help` exit 0
with the alpha.21 banner, same-group roster row product=dashi seen and
gone after a clean exit; no installer run on the dashi profile;
dashi-app carries @sessionbus/dsh 0.1.0-pre.12 as its own exact pin;
pre-change snapshot ~/.local/state/dsh-host-dashi-alpha21/20260921T005310Z.
umka (pdev/dev1, root-sealed packet
/home/antst/sessionbus-evidence/dsh-umka-dashi-alpha21-dev1-20260921,
SHA256SUMS d71225ec, 84 payloads): the pre.7 installer-owned row
removed with provenance, dashi-app and launcher alpha.21 exact,
profile 11/11 at rc.2, executing anchor rc.2, headless heal, closure
479 exact, alpha.21 banner, same-group roster row product=dashi then
clean shutdown with no survivors; host/sessionbus/web profiles stay at
pre.11, daemon untouched. Independent checks: haiku verifier on the dsh
host (six checks), pdev root seal on umka. Remaining: the mac host
(unscheduled); alpha.19 and alpha.20 empty tarballs are the owner's
optional npm deprecate.
Addendum 2026-09-21: profiles are hoisted installs (app-boot index.js
:365-370 sets nodeLinker hoisted, autoInstallPeers false; `dsh plugin`
forwards its arguments to pnpm verbatim, bin.js:105-115,
plugin-*.js:101-113). When an in-place upgrade drops a nested
dependency edge, pnpm 10.28.1 leaves the previously nested physical
directory behind (found after dashi 0.1.1: node_modules/@antst/
dashi-app/node_modules/@antst/dsh-file-uploads-none at 0.1.0, absent
from the lock and from .modules.yaml); `pnpm prune` and
`pnpm install --frozen-lockfile --force` do not remove it, and Node
resolution from the dependent's real path picks it up, so it is
behavioral, not cosmetic. Ruling: the profile physical one-version
assertion covers nested node_modules directories; the repair is to
remove only a nested directory that both a version guard and a lock
grep prove untracked, followed by a frozen install that must be a
no-op; never a node_modules deletion. Runbook step added under W-098.
Umka 2026-09-21 (pdev/dev1, root-sealed packet 968472f1, 158
payloads): the same stale nested provider directory appeared under
dashi-app after the in-place 0.1.1 add, survived frozen `--force` and
`prune` on an isolated exact copy, and was removed with the
generation-bound targeted removal plus a no-op frozen install; dashi
0.1.1 and plugin pre.13 on all profiles, rc.2 anchor, closure 479,
lane and web replies exact, daemon unchanged. Both hosts are current.

### D-044 (2026-09-21) 0.1.0 is the first stable cut; stable is a dist-tag promise, not a DSH promise
Owner ruling 2026-09-21: cut a stable release. Facts: develop 41f86a9
carries the same production source as 0.1.0-alpha.21 (b01f293); the
only change since is W-096, test-only. release.yml derives the npm
dist-tag from the version string (release.yml:96-103): a version with
no prerelease suffix publishes under `latest` and creates a
non-prerelease GitHub release, so no workflow change is needed. On npm
`latest` still points at the first manual publish (alpha.5 for dashi,
dashi-app, dashi-launcher; alpha.18 for dsh-file-uploads-none, W-033).
Rulings: (1) The first stable dashi release is 0.1.0, cut from develop
41f86a9 with a version bump and changelog entry only (W-097); no source
change rides on the release commit. (2) Stable means dashi's own
contract: the `latest` dist-tag, the completeness bar of AGENTS.md rule
1 for the shipped feature set, and semver for dashi's four packages
from here on. It does not promise a stable DSH: the DSH floor stays
`>=0.1.5-rc.2` (D-041) and the tested matrix stays as published in
validated-dsh-versions.json; README states both. Prerelease upstreams
are admitted in a stable dashi only as an exact pin (@sessionbus/dsh
0.1.0-pre.12, W-091) or a floor (D-041). (3) Release mechanics are
unchanged (W-033, README Development): bump PR against develop titled
`Release X.Y.Z`, squash, fast-forward main, push tag `vX.Y.Z`; the
ops lane fast-forwards and tags, the builder never pushes to main.
(4) After 0.1.0, feature work targets 0.2.0 and its prereleases are
`0.2.0-alpha.N` under the `alpha` dist-tag; a fix-only release on the
0.1 line is `0.1.N`. (5) Acceptance evidence for a stable cut is the
release run green, `latest` at the new version on all four packages
with the packed file counts matching the last alpha (55/4/4/5 for
0.1.0), the GitHub release not marked prerelease, and one host smoke
on the dsh host (exact install, graph, closure, `dashi --help` banner,
roster). umka and the mac host follow at their owners' pace.

### D-045 (2026-09-21) A delivered peer message wakes an idle interactive session; `/sessionbus <text>` reaches the model
Owner report 2026-09-21 on umka (dashi 0.1.1, plugin pre.13): typing
`/sessionbus test messaging with dsh-architect@dsh` printed the `list`
JSON regardless of the text, and a message sent to that dashi over the
bus rendered only as `Context · ...` with no model turn until the human
typed again. Both were live gaps in the acceptance evidence: W-098's
web-peer step recorded "an idle web peer stages a delivered message and
answers it on its next turn" as expected, and the architect accepted
it. That reading is withdrawn; evidence that documents the absence of
either behaviour is a failure. Contract (pdev, Sessionbus v0.5.6
4d572a6, peers v0.5.2 a1af0c1): the DSH product requirement already
states "Agent.steer delivers ordinary inbound messages at the next
step boundary or starts work while idle"
(docs/designs/DSH-TUI-REQUIREMENTS.md:17-19); interactive wake is
product-owned (UNIVERSAL-SESSION-PROTOCOL.md:1965); `idle_message` is
LanePolicy only and the daemon never drives an interactive peer's
turns (protocol/types.go:85-95, daemon/session.go:279-292,
directory.go:446-461); receipts name the admission boundary, not model
completion: `injected` = native admission acknowledged on the
wake-capable path, `queued_for_next_turn` = demonstrated staging,
`written` = local write only (UNIVERSAL-SESSION-PROTOCOL.md:237-260,
handlers.go:375-389); the kit's connectPeer delivery callback returns
exactly one result and no further ack (bus/sdk/js/index.js:244-256);
the daemon owns trace copies and settled-delivery aggregation.
Slash command facts: the plugin registers `sessionbus` at
plugin.cjs:375-379 with no `input` hint and a handler that ignores
`invocation.rawInput` and always calls `list`; dashi forwards the whole
line to `ctx.commands.execute` (session-runtime.ts:388) and DSH hands
the trailing text over as `rawInput` (dsh-commands CommandInvocation),
so the drop is plugin-side only. Rulings: (1) The completeness bar is
Claude Code interactive mode and the DSH product contract above: an
idle interactive dashi starts a model turn on a delivered message
through DSH's own scheduler (Agent.steer or the API the builder
proves equivalent), a running session receives it at the next step
boundary, lanes keep the daemon's LanePolicy. The receipt settles at
native admission (`injected`), never at model completion; a failure
before submission is `rejected`; an uncertain submission is
ProtocolError -32603 with uncertainty data, never a generic error.
Enqueue and wake are serialised against active/idle transitions and
root disposal so concurrent messages cannot start duplicate turns or
land on a replacement root; no second scheduler, no timers, no
polling. The plugin manufactures no trace copies and no extra acks; a
reply is an ordinary send. (2) The plugin ships a DSH skill named
`sessionbus` carrying the canonical guidance (self_info, send fields,
dispositions, lane policies, ack discipline, trace) and no command:
DSH core already implements `/<skill> <free text>` by riding the typed
line as the user message and injecting the skill body as instructions
(dsh-skill index.d.ts:116-129, dsh-tool-skill index.js:168-201), dashi
already completes user-invocable skills as `/name`, and every other
product ships a skill only; the command is deleted because
ctx.commands.execute runs first and swallows the gesture. The `list`
shortcut is gone; the model lists. (3) Acceptance evidence for anything
sessionbus is a human-visible interaction in dashi against a live
daemon: a delivered message to an idle dashi yields an autonomous
reply over the bus with no keypress; `/sessionbus <text>` yields a
model turn containing the text. Receipts and dispositions are
diagnostics. (4) Every delivered message carries the shared
envelope (`<cross-session-message from= from-session=>`, a
`[sessionbus-metadata: ...]` line, the body, the closing tag;
opencode delivery.mjs:10-17 is the template, byte-identical to the
Claude wrapper), so the sender is visible to the human and usable by
the model as the reply target. (5) The completeness audit of
2026-09-21 (ten areas against the Claude, codex, opencode, qwen and
grok integrations) found the plugin MISSING on guidance, slash text,
idle wake, receipts and envelope, PARTIAL on completion pointers
(supports_message_run never advertised, so `idle_message: run` lanes
are rejected), presence (no reconnect retry after a failed connect),
trace (inherits the wake gap) and open.arguments, and broader than
every product on the tool grant. Items: W-099 skill, W-100 wake and
envelope, W-101 dashi PTY gates, W-102 the remainder. None is closed
by assertion.

Host note 2026-09-21 (dsh host, dsh-exec): daemon upgraded in place
to Sessionbus v0.5.7 (release 53c5f80, binary sha256 bcc5f564; unit,
socket, PRODUCTS and service.env unchanged; all 19 peers reconnected;
federation connected, no ForwardLost); sessionbus and web profiles at
plugin 0.1.0-pre.14 with kit 0.5.7 exact, 11/11 at rc.2, closure
479/479, no untracked nested directories; dashi profile left at
pre.13 until W-101. Installed acceptance on the permanent daemon,
issued from pdev's long-lived acceptance-controller (stable SDK
0.5.7) under its own identity: a lane spawned without idle_message
reported policy run, an idle delivery was injected and produced one
completed record `lane hello`; a web root reached from a same-group
observer answered `peer hello` autonomously with no prompt; rosters
clean afterwards. Finding on the way: the first spawn from the
builder's codex-peer broker returned -32002 not_connected; bound by
`go version -m` to that broker's SDK 69c1024 (2026-09-14), whose
closed LanePolicy schema rejects the `policy.trace` field the daemon
has returned since v0.5.5 (directory.go:297-299), so the caller closed
its own connection after Open committed; daemon and plugin exonerated
(v0.5.7 source: -32002 on spawn only when the caller's attachment is
gone). The three Codex peers on this host run that broker; pdev's
signed successor (revision 1989c52, SDK 0.5.7) is verified on the
host and installs at the owner's restart boundary.

Qualification (pdev review of the sealed packet, root 3b88ae96): the
schema-rejection mechanism is source-proven and reproduced for that
SDK revision and strongly supported here by the bound broker version
and the -32002 classification, but the journal and comms capture on
the dsh host lack the originating decode error itself; the evidence
is kept immutable with this qualification alongside.

Repository move 2026-09-22 (owner-directed, executed by pdev): the
Sessionbus repositories moved into the GitHub organisation:
github.com/sessionbus/sessionbus, github.com/sessionbus/sessionbus-peers
and github.com/sessionbus/sessionbus-dsh (same repository ids, refs and
releases byte-identical, old antst URLs redirect; the old names are
never recreated). dashi and roller stay under antst. Consequences:
plugin tags and releases stay on hold until the owner rebinds the npm
trusted publisher for @sessionbus/dsh to sessionbus/sessionbus-dsh
with workflow release.yml; dashi's daemon download URL and the
runbook's repository references are re-pinned to the organisation in
W-105; lane clones and remotes are updated to the new URL.

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

### W-025 Launch flags: permission, yolo, model, effort — status: accepted 2026-09-03 (PR #17 merged into develop)
Flags are the interactive commands applied before TUI bind: --model
(with --provider inferred for a unique catalog match, required when
several providers list the id), --effort, --permission <preset>, and
--yolo / --dangerously-skip-permissions as one alias for the
danger-full-access preset. DSH persists the model selection as its
default exactly as /model does; dashi stores and restores nothing
(session-only selection is a DSH gap, see Upstream reports). Unlisted
model ids bind because the DSH catalog is advisory; unknown preset,
provider, and effort relay DSH's own errors.
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

### W-026 Rewind flow per Claude Code — status: accepted 2026-09-03 (d4182dd, merged to main); owner hand check on alpha.4 confirmed 2026-09-03 ("much better")
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

### W-027 Collapse injected context cells — status: accepted 2026-09-03 (PR #20 merged into develop)
Fold classifies on plugin source fields only (DSH rc.1 ContextFormed
forms instructions, catalog, snapshot, notice, recall; relay
unchanged); collapsed row expands through existing card mode and the
history overlay; reducer unchanged; 28 production lines. Amendment
during review: "any" means context DSH injects; dashi's own shell
command messages keep their shell cell in durable history, since that
is output the user asked for.
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

### W-030 CI/CD on GitHub Actions for dashi — status: accepted 2026-09-03 (PR #5 merged into develop)
Hosted gate green; preview blocked only by the missing pkg.pr.new
app; release workflow publishes the three packages in order with
provenance and a prerelease dist-tag; two test-only readiness fixes
(screen server wait, launcher pack timeout).
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

### W-031 Exit arm expires after two seconds — status: accepted 2026-09-03 (PR #9 merged into develop)
One 2000 ms timer in the effect runner dispatching the existing
disarm action; PTY proves 250 ms exits and 2.5 s re-arms; also the
CI-only 3x ceiling for measured gates and observed waits (test-budget
module), with the decision-EOF test waiting on observed state. 13
production lines; 199 tests; hosted run green with previews.
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

### W-032 One container for the gate, locally and in CI — status: accepted 2026-09-03 (PR #13 merged into develop)
Dockerfile (node:22-bookworm-slim, git, procps, screen, tmux, bubblewrap;
drops to the host uid) and one `gate:docker` script that holds the three
outer-Docker allowances nested bubblewrap needs. ci.yml and release.yml
run only that script. The inner DSH bubblewrap policy stays under test;
no Docker-specific skips.
Owner: dsh-exec. Branch `w-032-gate-container`; PR against develop.
Owner request (2026-09-03): run CI in Docker. Scope, smallest form: a
single `Dockerfile` at the repo root on the official Node 22 image
with pnpm (from the packageManager field via corepack), tmux, GNU
screen, git, and a UTF-8 locale; `ci.yml` runs its gate job with
`container:` built from that Dockerfile (or the image built and
cached by the workflow, whichever is fewer lines); a `pnpm
gate:docker` script builds the image and runs `pnpm gate` inside it
with the workspace mounted, so the local and hosted gates are the
same environment. No compose, no multi-stage build, no registry
publish, no change to the gate itself. README "Development" gains one
sentence.
Acceptance evidence: PR CI green with the container; `pnpm
gate:docker` green locally with the same test count; zero production
source changes.

### W-033 Release on tag push — status: accepted 2026-09-03 (PR #11 merged into develop; 0.1.0-alpha.5)
Tag push gates, validates the tag against all three manifests,
creates the GitHub release from the CHANGELOG section, publishes the
three packages in order skipping versions already on npm. First npm
publish of dashi is manual (trusted publishing needs existing
packages); the alpha.6 tag is the OIDC proof.
Owner: dsh-exec. Branch `w-033-release-on-tag`; PR against develop.
Owner request (2026-09-03), mirroring roller W-010: `release.yml`
triggers on push of tags matching `v*`; jobs in order: gate, then
create the GitHub release for that tag with `gh release create` using
the CHANGELOG.md section for that version as notes (fallback:
auto-generated), `--prerelease` for prerelease versions,
`permissions: contents: write`; then the existing three-package npm
publish in dependency order with provenance and the version-derived
dist-tag. Idempotent on rerun. README release procedure: bump,
changelog, merge to main, push the tag.
Acceptance evidence: PR CI green; actionlint clean; the alpha.5 tag
exercises it; zero production source changes.
### W-034 Plugin management in the session — status: accepted 2026-09-03 (PR #24 squash-merged into develop)
Lookup showed `dsh plugin` is a pnpm passthrough with no enable/disable
verb and mcp-client keeps connection state private, so: /plugins reads
the DSH plugin-inventory Remote (dashi-app now mounts it) plus the
configured serverName for mcp-client rows, no health claim; /plugin
<args> forwards verbatim to `dsh plugin --profile <running profile>`
(name derived from ctx.baseUrl, shell-quoted) through the human shell,
which now overlays DSH_HOME via dsh-home-paths for `!` too; one
next-launch notice, no restart mechanism. Addendum: -h/--help with a
"dashi <v> on DSH <v>" header shared with /help; --version stays DSH's
root flag (the launcher does not rewrite argv). Enable/disable and MCP
status are DSH gaps in README and the queued upstream report. 59
production lines; 220 tests.
Claude Code has /plugin (install, remove, enable, disable) and /mcp
(server list with connection status). DSH manages plugins only from
the CLI (`dsh plugin --profile <name> add <pkg>`), MCP servers are
mcp-client plugin rows in the profile patch, and no roster or status
service exists (README names the /mcp gap). Scope, in order:
1. Bounded lookup first, reported before code: the exact `dsh plugin`
   verbs in rc.1 (add, remove, list, anything for the patch-row
   `disabled` flag), and whether mcp-client exposes any per-server
   connection state a list can read. Cite file:line.
2. `/plugins`: read-only list of what the running profile loaded,
   from the Cordis registry: row id, package name, version, fiber
   state; mcp-client rows in the same list with their server name and
   connection state when DSH exposes it. No separate /mcp; an MCP
   server is a plugin row in DSH.
3. `/plugin add <pkg>` and `/plugin remove <pkg>`: run DSH's own CLI
   for the current profile through the existing shell-command
   mechanism, show its output, then offer to exit so the launcher
   restarts the profile. dashi writes no files and owns no installer.
4. Enable/disable only if the DSH CLI has verbs for it; otherwise
   named as a DSH gap in README and queued as an upstream report, not
   patched by editing cordis.patch.yml from dashi.
Owner: dsh-exec. Branch `w-034-plugins`; PR against develop.
Acceptance evidence: PTY test listing the shipped profile's rows
(dashi, roller, at least one DSH row) with states; PTY test that
`/plugin add` of a packed tarball runs the DSH CLI and the restart
offer appears; unknown package relays the DSH CLI error; README and
/help updated; no new state in the reducer beyond the transient list.
### W-035 Parity audit against Claude Code — status: accepted 2026-09-03 (table committed as PARITY.md)
Cited table against the current Claude Code roster: ~20 done, ~25
doable over existing DSH services, ~30 DSH gaps with the missing
surface named. Spot-check of twelve citations by an independent
reader: ten exact, two partial (recordKeyFor is exported earlier in
auth.ts than cited; DSH's ShellExecutor has no interactive TTY, so an
$EDITOR launch must be dashi's own inherit-stdio child, see W-037).
Reversals: /login and /logout doable; /hooks a gap; whole-tool
--tools doable, pattern permission rules a gap. Work items W-037
onward are cut from the doable rows in daily-use order; gaps get one
README sentence each and join the upstream report queue.
No code. Walk Claude Code's interactive command and launch-flag
roster (current docs) against dashi and produce one table in the
handoff: item, dashi status (done / doable / DSH gap), and for every
doable item the DSH service or package that owns the fact, cited
file:line in the pinned rc.1 tree. Candidates known before the audit:
/memory (open the instruction files DSH loaded in $EDITOR), /diff
(git diff since session start or last turn), /hooks (list hooks DSH
loaded), /status or /config (effective settings, model, preset,
profile, workspace), /export (transcript to a named file on explicit
request), /init (AGENTS.md skeleton), and the likely gaps /login,
/logout, /add-dir, autocompact tuning. Anything the audit finds that
a developer uses daily in Claude Code is in scope; anything not about
driving DSH from a terminal is out. The architect turns doable rows
into W-036 onward in order of daily use; gaps are named in README and
queued as upstream reports.
Owner: dsh-exec. Branch none; handoff is the table, cited.
Acceptance evidence: every row cited or marked as a gap with the
missing DSH surface named; no row left as "unknown".
### W-036 sessionbus plugin in dashi-app, launcher token check, and -g — status: accepted 2026-09-19 (PR #139 squash-merged; @sessionbus/dsh 0.1.0-pre.2 exact)
Per D-036. Scope: dashi-app adds `@agentbus/dsh-comms` at exact
0.4.0 as a dependency and a patch row (sibling of dashi and roller;
activation is service-driven, row order is irrelevant); dashi parses
`-g <group>` / `--group <group>` repeatable and runs one
`/agent-sessions group <g> [<g> ...]` call with all names (additive,
one re-hello) before TUI bind, relaying
the DSH command result on error (unknown command means the comms
plugin is not loaded; say so verbatim). No name flag beyond the
existing `--name`; no env variables set by dashi or the launcher.
README: one paragraph on Agent Sessions presence (starts when the root
session exists; needs the Agent Sessions host daemon installed on the
machine; delivered messages arrive as ordinary input), groups, and
that the session title is the peer name. Verified with the Agent
Sessions architect 2026-09-03: all six design points confirmed.
Owner requirement (2026-09-03): with no daemon on the host nothing
breaks and dashi keeps working, messaging simply unavailable, and this
must not require complex machinery. Gate on the comms plugin (owned by
Agent Sessions, gated by the architect before dashi pins it):
activation never throws or blocks startup; no transcript error or
hello failure to dismiss, at most one log line; `/agent-sessions
group` while disconnected returns a plain command error; the tool
returns a plain error instead of hanging; reconnect is at most one
fixed-interval retry or absent.
Acceptance evidence: dashi starts and works normally with no daemon
present (the shipped-profile PTY tests run without one); PTY test with
the shipped profile showing the comms row in /plugins and the group
applied (assert through the plugin's own command output or its
exposed service, not by parsing logs); clean-install test still
passes with the added dependency; production source under 40 lines.
Builder note allowed on the exact 0.4.0 version once published.
Builder note: the published `@sessionbus/dsh@0.1.0-pre.2` depends on the
registry `@antst/dsh-file-uploads-none@0.1.0-alpha.18`, while dashi-app links
the workspace copy; the lock therefore contains both copies by design.
Accepted 2026-09-19 at 50588d9: dashi-app pins @sessionbus/dsh 0.1.0-pre.2
exactly and ships the sibling row `id: sessionbus`, `config: { product:
dashi }` (matches the plugin installer's peer row); the launcher selects
`--profile sessionbus` when SESSIONBUS_LAUNCH_TOKEN is present and
exports repeatable -g/--group names (all four spellings, comma lists) as
SESSIONBUS_GROUPS, rejecting a missing or dash-leading value; real-spawn
launcher tests, a shipped-profile PTY with the socket and token removed
from the child env proving the row active and a prompt completing with
no daemon; 296/296. The lane profile is created by the plugin installer,
not bundled.

### W-037 /memory — status: accepted 2026-09-03 (PR #35 squash-merged)
Defect found and fixed on the way: dashi-app had mirrored the web
app's disable list wholesale, including `agent-instructions`, so the
shipped profile loaded no AGENTS.md (the web app disables the row
because it injects its own). Cause it went unseen: W-027's fixture
hand-wrote source {kind:'plugin', plugin:'agent-instructions'} while
live rc.1 emits {kind:'agent-instructions'}; the fold now covers the
native shape and a PTY test proves a fixture AGENTS.md reaches the
model context in the shipped profile. profile-drift names this one
intentional divergence with a reason. /memory lists paths and scopes
from DSH's durable agent-instructions sources and opens the file via
the existing cooked-terminal editor path ($EDITOR, fallback vi, argv
not shell string). 49 production lines; 222 tests. Every alpha.7
install has the instructions defect: alpha.8 follows promptly.
List the instruction files DSH loaded for this session (paths and
scope from the agent-instructions rendered set, PARITY.md row
/memory), select one, open it in $EDITOR (fallback vi) as a child
with inherited stdio while the TUI is suspended, then resume and
redraw. DSH's skill watcher already reloads; instructions reload per
DSH's own rules, and the row says which. No file written by dashi.
Acceptance evidence: PTY test that /memory lists AGENTS.md from the
fixture cwd and that selecting it runs $EDITOR (a recording script)
on that exact path, terminal restored after; production source under
50 lines.

### W-038 /diff — status: accepted 2026-09-03 (PR #38 squash-merged)
/diff runs `git diff --no-ext-diff --no-color HEAD --` in the session
header cwd through ctx.shell under the session sandbox, read only,
stderr relayed verbatim; /diff turn slices DSH's log snapshot at the
last turn/start and renders DSH's recorded write/edit hunks through
the existing fold and presenters; the info overlay gained an optional
cells field and Ctrl+O inside overlays reuses toggle-tool-mode. 49
production lines; 224 tests. Note for W-040: the 64 KiB stdout cap in
diff-view.ts is a separate literal; share the human-shell constant.
Show the current git diff of the session cwd (via ctx.shell, read
only) and, with an argument `turn`, the write/edit hunks DSH recorded
in tool-result metadata for the last turn (PARITY.md row /diff),
rendered with the existing presenter/card mode. Acceptance: PTY test
with a fixture repo; production source under 50 lines.

### W-039 /config — status: accepted 2026-09-03 (PR #34 squash-merged; owner roller-exec)
/config lists namespaces with DSH-redacted value/base/user layers
(describe({redactSecrets:true})); `/config NS KEY=VALUE` parses a
JSON scalar with string fallback and calls the provider's validated
update, or mutate with path ops for dotted keys; DSH's own errors
verbatim; PTY test proves DSH persisted the change to settings.yaml.
34 production lines; 223 tests.
Show effective settings per namespace from SettingsProvider.describe
(value, base, user) and accept `key=value` edits through the
provider's validated update; errors relayed verbatim. Acceptance: PTY
test reading and changing one setting and seeing DSH persist it;
production source under 50 lines.

### W-040 Aliases and small launch flags — status: accepted 2026-09-04 (PR #42 squash-merged)
/quit, /reset, /continue, /branch are the existing definitions
re-registered under a second name; /effort reuses the model
activation with the current provider/model; -n, --agent, --session-id,
--fork-session pass through SessionCreateRequest and
SessionController.fork; diff-view uses the shared stream constant. 39
production lines; 232 tests. Note to both builders: line caps bound
mechanisms, not formatting; do not pack statements or type fields onto
one line to meet a cap, ask for a higher cap instead.
Registered aliases over existing behavior: /quit, /reset, /continue,
/branch (=/fork), /effort <e>; launch flags -n (=--name), --agent
<preset>, --session-id <uuid>, --fork-session with --resume/
--continue. Each is one registration or one parser line over the
cited DSH operation; no new mechanism. Acceptance: one PTY test per
alias; production source under 40 lines.

### W-041 /login and /logout — status: accepted 2026-09-04 (PR #41 squash-merged; owner roller-exec)
/login lists AuthorizationService flows and begins one, relaying
notice/text/secret/select steps through the existing decision
overlay (secret answers masked, including bracketed pastes); /logout
deletes the credential record by key without reading it. Review
found the typed secret surviving in pi-tui's Editor undo history
(setText pushes an undo snapshot; Ctrl+- is handled inside the
Editor); fix: the Editor instance is replaced synchronously when a
secret question resolves, so the old undo stack is unreachable; PTY
test presses Ctrl+- after submit and scans terminal output and
session.jsonl for the sentinel. dashi-app mounts dsh-authorization.
Cap raised to 70 lines for the fix; 70 production lines; 233 tests.
/login lists AuthorizationService flows and begins the chosen one,
relaying the provider-owned interactive steps; /logout deletes the
provider's credential record (PARITY.md rows). Acceptance: PTY test
with a fake flow from the replay provider or a fixture flow;
production source under 60 lines. Never print secrets.

### W-042 /init — status: accepted 2026-09-04 (PR #45 squash-merged)
Fixed template through ctx.fs.writeText createIfAbsent under the
session sandbox; DSH's existing-file error verbatim; README states
DSH reads the file in a new or resumed session (agent-instructions
composes its baseline at first request, no watcher). PTY test: create,
refusal on second run, fresh session shows the Context row. 19
production lines; 234 tests.
`/init` writes a starter AGENTS.md in the session cwd through ctx.fs
(atomic create, refuses to overwrite an existing file, DSH error
verbatim) with a short fixed template: project name from the cwd
basename, a "Working agreement" heading, and three placeholder
bullets; then reports the path. DSH's agent-instructions plugin
picks it up per its own rules; say which in README (next session or
live). Acceptance: PTY test in an empty fixture cwd, then a second
/init refused; production source under 30 lines.

### W-043 /copy N and code-block picker — status: accepted 2026-09-04 (PR #50 squash-merged)
One reducer action (copy-assistant) replaces copy-latest; /copy N
picks the Nth latest completed assistant cell; /copy code opens the
existing list overlay with fenced blocks (language and first line)
and selection reuses the OSC 52 copy effect. 36 production lines;
236 tests.
`/copy N` copies the Nth latest assistant message (1 = latest, the
existing /copy behavior); `/copy` with argument `code` opens the
existing list overlay with the fenced code blocks of the latest
assistant message (language and first line as label) and copies the
chosen block through the existing OSC 52 path. Source is the DSH log
via the existing fold; no new state beyond the transient list.
Acceptance: renderer test with a recorded log containing two code
blocks; PTY test for /copy 2; production source under 40 lines.

### W-044 /skills — status: accepted 2026-09-04 (PR #47 squash-merged; owner roller-exec)
Existing list overlay over ctx.skills.list/get for the agent scope
and cwd; substring filter on name and description; selection inserts
`/<name> ` into the composer; no cache. 35 production lines; 234
tests.
`/skills` lists the skills DSH resolved for this session from the
session skill catalog (name, description, invocation policy, source,
path; PARITY.md row /skills) in the existing list overlay; `/skills
TEXT` filters by substring on name and description; selecting a row
inserts `/<skill-name> ` into the composer (DSH human invocation is
first-class per tool-skill). Read only; no state beyond the transient
list; DSH's filesystem watcher already reloads skills, so no reload
command. Acceptance: PTY test with a fixture skill directory showing
the row and the filter; production source under 40 lines.

### W-045 --tools and --disallowedTools — status: accepted 2026-09-04 (PR #53 squash-merged; owner roller-exec)
Parser branch in index.ts; one ToolRuntime.restrict call in prepare()
so every root (fresh, resume, continue, fork) carries the mask, the
disposer owned by the binding; DSH's unknown-name error relayed with
exit 2; pattern rules named as a DSH gap. 32 production lines; 237
tests. Ships in alpha.10.
Launch flags `--tools a,b` (allow only these tool names) and
`--disallowedTools a,b` (deny these names) applied to the root agent
through ToolRuntime.restrict (agent-scoped allow/deny masks by whole
registered name; PARITY.md row --tools). Both flags also apply on
--resume/--continue. Unknown tool names: relay DSH's error if
restrict validates, otherwise list the unknown names against the
registered roster in one dashi error and exit 2. Pattern rules
(Bash(git *), paths) are a DSH gap: one README sentence; no dashi
matching. Acceptance: PTY test that a denied tool is absent from the
model's tool list (replay fixture records the tool roster) and that an
allowed-only list hides the rest; production source under 40 lines.

### W-046 /tasks management and /subtask — status: accepted 2026-09-04 (PR #55 squash-merged)
One handler for /tasks and /bashes: no argument opens the existing
details overlay, Enter on a job row opens JobRegistry.read output as
an info-overlay cell, `kill ID` calls JobRegistry.kill; /subtask TEXT
calls SubagentRuntime.startContinuable with the base profile's spawn
provider. jobs and subagents injected; dsh-jobs exact peer. 48
production lines; 237 tests. Ships in alpha.10.
`/tasks` (existing list) gains selection: Enter opens the job's
output through JobRegistry.read in the info overlay with cells;
`/tasks kill ID` calls JobRegistry.kill; `/bashes` is an alias of
/tasks. `/subtask TEXT` starts a continuable child through
SubagentRuntime with the text as its first prompt and reports the
child id; the existing subagent surface shows it. All owners are DSH
(PARITY.md rows). Acceptance: PTY tests for read, kill, and subtask
creation with the replay provider; production source under 50 lines.

### W-047 --system-prompt and --append-system-prompt — status: accepted 2026-09-04 (PR #59 squash-merged; owner roller-exec)
Four flags parsed in index.ts, file variants read once at launch
(missing file: LaunchArgumentError, exit 2); prepare() registers a
complete SystemPrompt section or an ordinary final section on the
root, disposers on the binding, so resume/continue/fork carry them.
PTY test inspects the recorded request's system prompt. 32
production lines; 239 tests. Ships in alpha.11.
Launch flags `--system-prompt TEXT`, `--system-prompt-file PATH`,
`--append-system-prompt TEXT`, `--append-system-prompt-file PATH`
(PARITY.md row). Replace variants register one SystemPrompt section
declared complete; append variants register one ordinary section
at the end; scope is the root agent, applied in prepare() like
W-045 so resume/continue/fork carry it. File variants read the file
once at launch through node:fs (a launch argument, not session
state); missing file is a launch error, exit 2. No dashi persistence.
Acceptance: PTY test with the replay provider proving the request's
system prompt content for replace and append; production source
under 40 lines.

### W-048 /loop — status: accepted 2026-09-04 (PR #61 squash-merged)
dashi-app mounts dsh-schedule; /loop INTERVAL TEXT, /loop, /loop stop
ID call the root agent's native schedule_create/list/delete tools
through ctx.tools.execute under the agent initiator; DSH errors
verbatim (five-minute floor is DSH's). PTY: create, list, 1m
rejection, stop; in-process fake-timer test drives the unmodified
DSH runtime through two firings and a stop. 45 production lines; 240
tests. Ships in alpha.11.
`/loop INTERVAL TEXT` (interval like 5m, 1h) schedules a fixed-rate
reminder through @deepseek-ai/dsh-schedule for the root agent whose
firing submits TEXT as a prompt; `/loop` lists active schedules;
`/loop stop ID` cancels. DSH owns the durable schedule records
(PARITY.md row /loop). Acceptance: PTY test with a short interval
showing two firings and a stop; production source under 50 lines.

### W-049 --verbose — status: accepted 2026-09-04 (PR #66 squash-merged)
Launch parser accepts --verbose and initializes the existing
toolMode to expanded; Ctrl+O cycle unchanged. PTY contrast test on a
resumed recorded Bash turn. 10 production lines; 242 tests. Ships in
alpha.11.
Launch flag `--verbose`: the initial presentation opens with every
tool card and context row expanded (the existing card mode set to
expanded at start) and stays a launch-scoped presentation choice;
Ctrl+O still toggles. No new state field beyond the existing tool
mode. Acceptance: PTY test that a resumed session shows an expanded
tool card on the first screen with --verbose and collapsed without;
production source under 15 lines.

### W-050 /usage — status: accepted 2026-09-04 (PR #67 squash-merged; owner roller-exec)
One snapshot of DSH's tokenUsage and sessionStats projections into
the info overlay (four token buckets, turns, steps, model, tool, and
measured wall time); dashi-app mounts dsh-session-stats like the web
app; per-model breakdown, tool-call count, plan limits and cost are
DSH gaps in README. 38 production lines; 242 tests. Ships in
alpha.11.
`/usage` shows session totals from DSH's token usage projection and
session stats (PARITY.md rows /usage, /cost, /stats): input, output,
cached tokens, turns, tool calls, wall time, per-model breakdown when
present; read only from DSH projections, rendered in the info overlay.
Plan limits and cost are a DSH gap (one README sentence). Acceptance:
PTY test after a replayed turn showing nonzero totals; production
source under 40 lines.

### W-051 /btw and /recap — status: accepted 2026-09-04 (PR #76 squash-merged)
One shared askAside: fork at DSH's latest completed boundary (no
atSeq, so a running source is accepted and its open tail excluded),
resolve and rename the child through the controller, steer one
prompt, follow to turn/end, fold the child suffix through the
existing fold into the info overlay titled with the boundary turn.
Both commands recordInput false; the root gains only its
command/run and command/done pair. Cold picker title for large forks
is the named DSH gap (upstream queue). 46 production lines; 246
tests. Ships in alpha.11.
Owner request 2026-09-04. Claude Code's /btw asks a side question
without touching the conversation; PARITY.md marks it a DSH gap
(no no-history model call). DSH-native shape instead: `/btw TEXT`
forks the current session at its latest completed turn
(SessionController.fork, cold-readable), titles the fork
`btw · <first words>`, submits TEXT as the fork's next prompt, waits
for its turn/end, and shows the assistant text in the info overlay
with cells (Ctrl+O expands). The main root is untouched; the fork
stays a normal DSH session (resumable from the sessions list; DSH
has no root-release, README says so). While the root is running, the
fork is taken at the previous completed turn boundary (fork is cold,
from the log) and the answer is labelled with that turn number, so
/btw works mid-turn without seeing the in-progress prompt; only if
SessionController.fork itself refuses a running source does dashi
relay that refusal (cite the check). `/recap` is `/btw` with the fixed prompt "Summarize this
conversation so far in ten lines: goal, decisions, open items." No
new state; the wait reuses the existing turn-end follow used by
executeAccepted. Acceptance: PTY test with the replay provider
proving the answer appears, the root's log gains only the command's
own command/run and command/done pair (DSH logs every command; use
recordInput false) and no turn/start, user/message, assistant/*,
tool/*, or turn/end, and the fork exists with the title; production source under 50 lines.

### W-053 /plugin fails under the sandbox — status: accepted 2026-09-04 (PR #72 squash-merged; owner roller-exec)
runHumanShell takes a defaulted useSessionSandbox flag; /plugin
passes false and resolves a per-call danger-full-access policy
(ShellExecRequest.sandboxPolicy is the resolved per-call policy,
rc.1 shell/types.ts:77-78); `!` unchanged. Default-preset PTY case
added. 6 production lines; 244 tests. Ships in alpha.11.
Defect, owner report 2026-09-04: `/plugin add <pkg>` in a normal
session fails with `EROFS: read-only file system` on
`~/.dsh/profiles/dashi/_tmp_...` because the nested `dsh plugin`
runs through the human shell under the session sandbox policy, which
mounts the profile directory read-only. W-034's PTY test launched with
--yolo, so the sandbox was off and the defect stayed hidden. Fix: the
/plugin passthrough runs the nested DSH CLI without the session
sandbox (it is DSH's own profile-management command, explicitly typed
by the user); human `!` commands keep the sandbox. Acceptance: PTY
test under the default permission preset (no --yolo) that
`/plugin add <packed tarball>` succeeds and the profile manifest
changes; the existing --yolo case stays. Production change under 10
lines. Ships in alpha.11.

### W-054 Overlays taller than the viewport — status: accepted 2026-09-04 (PR #83 squash-merged)
One pure window function in the renderer sizes list and info
overlays to the viewport, keeps the cursor row visible, and prints
exact "↑ N more" / "↓ N more" markers; info overlays scroll with
Up/Down/PageUp/PageDown through one optional scrollOffset, the limit
passed in the action from the renderer so the reducer never reads
the terminal; a one-line isOverlayFocused override stops pi-tui's
alternate screen from consuming PageUp/PageDown while a dashi overlay
is open. 49 production lines; 252 tests. Ships in alpha.12.
Defect, owner report 2026-09-04: a list overlay with more rows than
the screen (e.g. /model with a long catalog) draws all rows, the tail
is off screen and unreachable, while up/down keep moving the cursor
through the invisible part. Fix in the renderer only: a list overlay
draws a window of rows sized to the available viewport height
(minus title and frame) that always contains the cursor, with a
one-line marker for hidden rows above and below (e.g. "↑ 12 more"
and "↓ 30 more"); an info overlay taller than the viewport scrolls
with up/down and PageUp/PageDown, cursor-free, with the same
markers. Windowing is pure presentation computed at render from the
overlay cursor and the terminal size; no new reducer state beyond an
info-overlay scroll offset if one is needed. Both inline and
full-screen modes. Acceptance: renderer tests at 24 rows with a
60-row list (cursor at 0, middle, end) and a 60-line info overlay;
PTY test that /model on a small terminal shows the markers and that
the last row is reachable and selectable; production source under
50 lines. Ships in alpha.11.

### W-055 Markdown rendering of assistant text — status: accepted 2026-09-04 (PR #86 squash-merged)
Completed, non-accessible assistant cells render through pi-tui's
Markdown component with one dashi theme (headings, emphasis, code
spans, fenced blocks, lists, quotes) inside the existing cell cache;
streaming cells and accessible mode stay plain; /copy keeps the raw
text. PAGE_CELLS exported and reused for info paging. 28 production
lines; 256 tests. Ships in alpha.12.
Survey 2026-09-04 (dsh-tui/dsh-tui, ccch1mneyyy/dsh-TUI; ideas only,
the second repo admits leaked-source ports, never adapt its code).
dashi renders assistant text plain; Claude Code renders markdown.
Render completed assistant cells through pi-tui's own Markdown
component (headings, emphasis, code spans, fenced blocks, lists), no
new dependency; streaming chunks stay plain until the cell completes;
/copy and /copy code keep the raw text. Accessible mode stays plain.
Acceptance: renderer tests with a recorded log containing each
construct at 80 columns in inline and full-screen modes; production
source under 40 lines.

### W-056 Persistent status line — status: accepted 2026-09-04 (PR #84 squash-merged; owner roller-exec)
One line above the composer from live projection snapshots
(modelSelection, permissions, tokenUsage, contextPressure) read at
render, plus the git branch via ctx.shell under an explicit
read-only policy at launch and on turn/end only, kept as the single
branch field on the binding and redrawn only on change; hidden in
accessible mode and under the exit arm; truncates branch then cache
rate at the right. 49 production lines; 257 tests. Ships in alpha.12.
One always-visible line above the composer (Claude Code has one):
model, permission preset, context tokens used with the model's
limit when the projection exposes it, cache-hit rate from
tokenUsage, and the git branch of the session cwd read once at
launch and on each turn end through ctx.shell (read only). Built
only from projections dashi already reads for /status and /usage;
no new state beyond the last shell result; hidden in accessible
mode; the existing exit-arm text keeps priority. Acceptance: renderer
tests at 80 and 120 columns; PTY test that the branch and model
appear; production source under 50 lines.

### W-057 MCP server stderr corrupts the terminal — status: accepted 2026-09-04 (PR #88 squash-merged; production source 0)
Confirmed DSH gap: mcp-client builds StdioClientTransport without a
stderr option (rc.1 packages/mcp/mcp-client/src/transport.ts:31-39)
and the MCP SDK spawns with stderr inherited (stdio.js:48-75); the
terminal guard wraps only pi-tui's terminal, not fd 2. A
shipped-profile PTY fixture asserts today's broken behavior so a DSH
fix flips it. README names the gap; no dashi workaround.
Bounded lookup, then report. Third-party TUIs document that
@deepseek-ai/dsh-mcp-client spawns stdio servers with stderr
inherited, so server logs write to fd 2 and corrupt rendering. (1)
Confirm in the pinned rc.1 tree (mcp-client transport options) and
with a fixture MCP server under the shipped profile whether the
terminal guard already absorbs it; cite file:line. (2) If DSH
inherits stderr: no dashi workaround (no spawn patching, no idle
repaint timer); README names the gap and the upstream lane posts the
report. (3) Search deepseek-harness issues and discussions for an
existing report first and link it instead of duplicating.
Acceptance: the handoff is the cited finding and, if a gap, the
ledger upstream entry with the search result; production source 0.
Builder note: confirmed against pinned rc.1 commit a66e470: mcp-client
omits the transport's stderr option (packages/mcp/mcp-client/src/transport.ts:31-39),
while the resolved MCP SDK defaults it to inherited fd 2 (stdio.js:48-75).
The shipped-profile PTY fixture proves a post-handshake stderr line appears
inside the active alternate screen. No exact upstream report exists; Discussion
4465 is nearest, with related 1241 and 5129 and third-party dsh-TUI issue 17.

### W-052 /clear NAME and /agents authoring — status: accepted 2026-09-04 (PR #77 squash-merged; owner roller-exec)
/clear NAME, /reset NAME, /new NAME rename the current root through
SessionController.rename, await the store flush, then create the
fresh root as before; /agents new (copy of the selected preset or
defaultId, then the W-037 editor path on the DSH-resolved
composition path), copy, and delete call agentPresets copy/remove;
one new action forwards to the existing open-file effect. DSH errors
verbatim. 34 production lines; 247 tests. Ships in alpha.11.
Last two PARITY.md doable rows. (a) `/clear NAME` (and `/reset NAME`,
`/new NAME`): rename the current root to NAME through the title
service, then create the fresh root as today, so the old
conversation is findable by name. (b) `/agents` gains `new NAME`,
`copy SRC DEST`, `delete NAME` over the DSH agent-presets authoring
API (read, copy, delete cited in PARITY.md); `new` opens the created
preset file in $EDITOR through the W-037 editor path. DSH owns the
files; dashi writes nothing itself. Acceptance: PTY tests for
/clear NAME (old session listed by name) and for copy and delete;
production source under 50 lines.

### W-058 Command and shell history recall — status: accepted 2026-09-04 (PR #93 squash-merged)
Ruling during the item: /history stays the transcript cell browser
(it already shows command and shell cells); only the Up/Down input
fold widened. One pure projection (historyInput) recovers, in log
order, human prompts, `/<name><args>` from command/run events that
carry args, and `!<command>` from dashi's durable shell notice first
line; recordInput-false commands (/login, /btw, /recap) stay absent,
README says so. The rewind picker is untouched. 19 production lines;
265 tests. Ships in alpha.13.
Owner report 2026-09-04: in Claude Code, up/down recall cycles through
everything typed, including /commands and !shell lines; in dashi they
are invisible to history, which recalls human prompts only. Both are
already durable DSH facts: every resolved command appends command/run
with its recorded input (unless the definition set recordInput false),
and `!` lines are dashi's durable shell notices. Scope: the history
fold that feeds up/down and /history includes, in log order, (a)
`/<name> <args>` reconstructed from command/run events that carry
input, and (b) `!<command>` from shell notices; commands that record
no input (/login, /btw, /recap) stay absent by design and README says
so; /history search covers the same set. No new state; the fold stays
pure. Acceptance: renderer/state tests with a recorded log mixing
prompts, two commands, and a shell line proving the recall order and
that a recordInput-false command is skipped; PTY test that up recalls
the last `/model` line; production source under 30 lines.

### W-059 Rewind picker lists the same entries as recall — status: accepted 2026-09-04 (PR #102 squash-merged)
The rewind boundary fold uses W-058's historyInput for every
sequenced event, so prompts, recorded slash commands, and shell
notices share one picker projection; each maps to the latest earlier
turn/end, session-start fallback, second screen, and composer
prefill unchanged; mid-turn marking stays for human prompts only.
11 production lines added, 12 removed; 269 tests. Ships in alpha.13.
Owner correction 2026-09-04: in Claude Code the rewind picker
("Rewind to a prompt") lists the same entries as Up/Down recall,
commands and shell lines included; dashi's picker lists human
prompts only. Scope: the rewind picker uses W-058's historyInput
projection (one list, one owner); each entry keeps its event seq;
choosing a command or shell entry rewinds to the latest completed
turn boundary before that seq exactly as a prompt entry does, and the
existing second screen (conversation, code, both) and composer
prefill apply unchanged, so a recalled `/model ...` or `!ls` can be
re-run after the rewind. Entries with no preceding boundary (before
the first turn) map to session start as today. No new state.
Acceptance: rewind tests with the W-058 mixed recorded log proving
the picker rows and the boundary each maps to; PTY test rewinding to
a `!` entry; production source under 30 lines.

### W-060 Completion for /plugin arguments — status: accepted 2026-09-04 (PR #100 squash-merged; owner roller-exec)
First word from the fixed pnpm verb list; after exec, the running
profile's node_modules/.bin; after remove/update/why, the profile's
direct dependencies; both reread at completion time from the profile
directory (ctx.baseUrl), no cache; later words free text. README and
the post-success notice carry the W-061 wording (bundles load next
launch; plain plugins need a patch row that DSH live-reloads). 38
production lines; 268 tests. Ships in alpha.13.
Owner request 2026-09-04. `/plugin` forwards to pnpm, so complete
its vocabulary through the existing live completion trigger: first
word from the fixed list add, remove, update, outdated, list, why,
exec, licenses; second word for `exec` from the binaries in the
running profile's node_modules/.bin, and for remove, update, why from
the direct dependencies in the profile's package.json (both read
only, from the profile directory DSH resolved in W-034, no caching,
read at completion time). Anything after those words stays free
text. Acceptance: completion tests with a fixture profile dir; PTY
test that `/plugin ex<Tab>` completes to exec and `/plugin exec
<Tab>` lists a fixture binary; production source under 40 lines.

### W-061 Live plugin activation after /plugin add — status: closed 2026-09-04 (lookup; production source 0)
Finding (rc.1, vendor/loader/src/config/tree.ts:97-155,
packages/boot/app-boot/src/index.ts:785-787, apps/cli/src/plugin.ts:59-91,
apps/cli/src/profile-boot.ts:279-286): the running loader exposes
create/update/remove and imports with fresh resolution from the
profile directory, so live activation is mechanically possible; but
`dsh plugin add` composes no row for a plain plugin package (only
bundle packages are appended to dsh.profile.bundles), so such a
package never loads until a patch row is written by hand, and DSH's
default live patch reload then applies it without restart, while
bundle additions need a restart. Ruling: no dashi mechanism
(composing bundle rows duplicates loadProfile; writing patch rows
makes dashi the writer of a DSH-owned file). README states the two
cases (W-060); two upstream entries below.
Owner question 2026-09-04: must dashi restart after `/plugin add`?
Bounded lookup first, reported before any code: (1) in the pinned
rc.1 tree and the vendored Cordis loader, does the running loader
(ctx.loader, the tree DSH boots from) expose a supported operation
to insert or enable an entry at runtime (cite the API, and how the
web app or the disabled `hmr` row uses it, if they do); (2) after
`dsh plugin --profile <p> add <pkg>` succeeds, can the running
process resolve the freshly installed package from the profile
node_modules (module resolution from the profile root, pnpm hoisted
linker) without restart; (3) what `dsh plugin add` writes
(package.json, dsh.profile.bundles, cordis.patch.yml) and whether a
runtime insert would diverge from what the next boot composes. If
all three hold: propose the smallest follow-up so `/plugin add`
ends with a live activation through the loader (no dashi-owned
registry, no reconciliation loop) and the next-launch notice only
when activation fails. If any fails: name the DSH gap, README
sentence, upstream queue entry; production source 0.

### W-062 Live `!` lines missing from recall — status: accepted 2026-09-04 (PR #107 squash-merged)
Cause: DSH records an injected shell notice durably first as an
agent/inbox/spliced event (rc.1 core/agent/src/inbox.ts:176-187) and
promotes it to user/message only at a later step (agent-loop
agent.ts:291-293), so the live projection never saw a message.
Fix: historyInput reads the splice event (type-level exclusion of
the promoted message, so no duplicates on cold bind); the live `!`
submit records through the existing prompt-recorded action and the
follower skips the splice with one condition. PTY test types
`!printf hi` and recalls it. 12 production lines; 270 tests. Ships in
alpha.14.
Defect, owner report 2026-09-04 on alpha.13: `/command` lines typed
in a running session are recalled with Up, `!command` lines are not,
although the recorded-log tests of W-058/W-059 pass. Find the live
cause (candidates: the reducer appends the composer text to the
recall list only on the prompt submit path and not on the `!` path;
or the live shell notice event's first line differs from the
fixture's `$ command` form; or the live per-event projection does
not see the notice because it is injected through maintenance after
the fold ran) and fix it within the W-058 mechanism, no new state.
Acceptance: a shipped-profile PTY test that types `!printf hi`,
waits for the output cell, presses Up, and sees `!printf hi` in the
composer; fixture shapes corrected to match the live event if they
differed (the W-037 lesson); production source under 15 lines.
Ships in alpha.14.

### W-063 Model shown twice — status: accepted 2026-09-04 (PR #110 squash-merged; owner roller-exec)
Grew into the HUD row by owner addenda: one values-only line
`<model> · <effort> · <preset> · ctx <used>/<limit> <pct>% · cache
<pct>% · <total> tok · <n> agents · <n> jobs · <title> ·
<repo>/<branch>`, effort/agents/jobs only when present or nonzero,
drop from the right in that order; model and title from DSH's
selection and title projections, tokens summed over the four
token-meter buckets (DSH has no total), repo root and branch from one
read-only shell call at launch and turn/end kept as the latest
result; the hint line keeps the model only in accessible mode. 39
production lines; 272 tests. Ships in alpha.14.
Owner report 2026-09-04 on alpha.13: the W-056 status row shows
`model <provider/model> · permission <preset>` above the composer
and the pre-existing hint line below it still shows `idle ·
<model> · Enter send · cards collapsed`. Remove the model from the
hint line (it keeps state, send mode, card mode, and the exit-arm
text); the status row is the single place for model and preset.
Accessible mode, where the status row is hidden, keeps the model in
the hint line so the fact stays visible there. Acceptance: renderer
tests for both modes; production source under 10 lines. Ships in
alpha.14.

### W-064 Rewind fails without a durable model selection — status: accepted 2026-09-04 (PR #115 squash-merged)
One carry rule (projection next, else lastUsed, else none); the
fresh-root rewind path calls selectModel only when DSH recorded a
selection, otherwise the new root takes DSH's default. A session is
headerless when its prompt turn ended or was interrupted before
request assembly emitted request/header and it started on the
default model; that was the sole throw of this kind. Regression:
headerless persisted log resumed through the shipped profile, both
restore choices, plus a unit test. 14 production lines; 274 tests.
Ships in alpha.15.
Defect, owner report 2026-09-04 on alpha.14: rewinding to the very
first prompt ended with "Error · the current session has no durable
model selection". The message is dashi's, raised on the rewind path
that creates a fresh root (first-prompt case, D-032) when it tries
to reapply the session's model selection and the log has no
model/selection event because the session ran on DSH's default.
Fix: carry a selection over only when the source session has one
(modelSelection projection next or lastUsed); otherwise the fresh
root takes DSH's default and nothing is selected; the same rule for
any other place dashi requires a durable selection (audit the throw
sites). Acceptance: PTY test in the shipped profile: start without
--model, one turn, /rewind to the first prompt with "conversation"
and with "code and conversation", both succeed; production source
under 15 lines. Ships in alpha.15.

### W-065 Drag-and-drop files into the composer — status: accepted 2026-09-04 (PR #123 squash-merged; owner roller-exec)
A complete bracketed paste whose shell-decoded tokens (bare,
single-quoted, backslash-escaped) all exist becomes attachments for
image paths through the existing attach effect and `@` mentions for
the rest through DSH's file-reference grammar, relative inside the
bound root's cwd and absolute outside; any other paste is inserted
unchanged; one stat per token; insert at the editor cursor. Review
fix: resolve against the bound session's cwd, not the launch cwd.
39 production lines; 280 tests. Ships in alpha.16.
Owner request 2026-09-04. In a terminal a drop arrives as a paste of
one or more file paths, shell-escaped (single quotes, backslash
spaces, or bare). Claude Code turns them into references. Scope: when
a bracketed paste, after unescaping, consists only of whitespace-
separated paths that exist on disk, dashi does not insert the raw
text; image files (by extension DSH's attachment service accepts)
become attachments exactly as `--image PATH` does, other files become
`@<path relative to cwd, or absolute when outside>` references in the
composer with a trailing space, through the existing @ reference
path. Any paste that is not entirely existing paths is inserted
unchanged. Pure input handling, no new state; the existence check is
one stat per path at paste time. Acceptance: input tests for the
three escape forms and a mixed non-path paste; PTY test dropping one
image and one text file (pasted with bracketed paste) shows an
attachment row and an @ reference; production source under 40 lines.

### W-066 macOS gate on hosted runners — status: accepted 2026-09-04 (PR #121 squash-merged; production source 0)
Non-blocking macos-latest host-gate job in ci.yml. First two hosted
runs: setup, typecheck, build, lint, and all unit files pass; the
runner then receives an external shutdown about 200 s into the
clean-install PTY test (profile-pty.spec.ts:1191), both times at the
same point. Audit: no test signals a process group or kills by name.
Zero dashi assertions, Linux-only assumptions, or DSH gaps observed
before the cut. Follow-up decided by the mac peer's local host-gate
result (D-038). The job stays non-blocking until green.
Owner decision 2026-09-04: macOS is a primary target and nothing has
run there. Scope: a `macos-latest` job in ci.yml running the host
gate (`pnpm gate`, not the container; brew-installed tmux and screen)
on pull requests and develop, `continue-on-error: true` until it is
green, so it never blocks merges; release.yml unchanged. First run:
classify every failure as (a) a dashi defect on mac (fix in a
follow-up item), (b) a test-harness assumption (Linux-only helper,
bubblewrap, xclip) to skip on mac with a one-line reason next to the
skip, never a silent pass, or (c) a DSH gap on mac (README, upstream
queue). Handoff is the job plus the classified list; when the job is
green, a second PR removes continue-on-error. Production source 0.

### W-067 macOS test harness — status: accepted 2026-09-04 (PR #126 squash-merged; owner mac-dashi; production source 0)
All nine mac failures fixed in the harness: line endings normalized;
tty compare on icanon/echo/isig/opost; realpath on both sides of
path assertions; screen socket dir under /tmp everywhere with
screen >= 4.1 required and the binary printed; clipboard fixture
fakes the platform helper production invokes (pngpaste on Darwin,
wl-paste/xclip on Linux); hermetic git config in every fixture and
pane; the worker-killing stdin case fixed at its cause (macOS bash
3.2 leaves BASHPID empty, so pid 0 signalled the process group; the
fixture now uses /bin/sh $$); turn and resize waits on observed
idle markers and the synchronized-render close. No Darwin skips.
Mac gate 274/274; hosted macos-gate green for the first time.
Mac peer's first host-gate run 2026-09-04 (macOS 27 arm64, Node 22,
pnpm 11, tmux 3.7, brew screen 5.0): non-PTY suites 164/164 pass;
PTY suite 100 pass, 9 fail, all harness assumptions, no DSH gap:
CRLF in the --version assertion; Darwin's PENDIN bit breaks exact
stty -g comparison (/memory, /agents editor, Ctrl+G); /private/var
temp paths wrap /init and /skills assertions; GNU screen socket path
over the Darwin limit (2); the clipboard fixture hardcodes wl-paste
and xclip; plus fixture git commits inheriting the user's signing
config, /var vs /private/var cwd assertions, system screen 4.0
lacking -Logfile, and the stdin-close-during-decision test killing
the Vitest worker on Darwin. Scope: one PR of test and fixture
changes only (production source 0): normalize line endings; compare
the tty mode fields that matter instead of the raw stty -g string;
realpath both sides of path assertions; short screen socket dir on
every platform; pbpaste/pbcopy fixture helpers selected by platform;
hermetic git config (GIT_CONFIG_GLOBAL and GIT_CONFIG_SYSTEM) in
fixtures; screen >= 4.1 required with the found binary printed and a
README mac note; the worker-killing case fixed at its cause or
skipped on Darwin only with the reason beside the skip. Acceptance:
`pnpm gate` green on the mac and the hosted Linux gate green; the
hosted macos-latest job (W-066) reported on after the change.

### W-068 Ctrl+D exits immediately during a turn — status: accepted 2026-09-04 (PR #131 squash-merged)
One shared exitChord (arm on first press, exit on the second within
the window); Ctrl+C keeps its interrupt and draft-clear steps before
it, Ctrl+D enters it after the nonempty-composer check regardless of
root status or attachments. Reducer tests for running root and
pending attachments; PTY test arms mid-turn with the child alive,
then exits on the second press. 9 production lines; 281 tests. Ships
in alpha.17.
Defect, owner report 2026-09-04 on alpha.16, Linux and mac: pressing
Ctrl+D while a turn is running exits at once, no arm, no second
press; between turns it arms correctly. Cause: state.ts:501 routes
ctrl-d straight to exit when the root is not idle or attachments are
present. Fix: Ctrl+D always uses the shared arm (first press arms
with the hint, second press within the window exits) regardless of
root status or attachments; a running turn is not interrupted by
Ctrl+D (Ctrl+C keeps that role). Acceptance: reducer tests for
running root and for pending attachments; PTY test pressing Ctrl+D
once mid-turn and seeing the arm hint with the process still alive,
then a second press exiting; production source under 10 lines.
Ships in alpha.17.

### W-069 Tolerate an open trailing turn (DSH turn/end loss) — status: accepted 2026-09-07 (PR #143 squash-merged)
One pure projection, latestCompletedTurn, treats any real turn/end
(completed or aborted) as a boundary and ignores only the synthetic
`interrupted` end DSH's repair appends on reload (rc.1
core/session/src/repair.ts:128-134; the loop never emits it,
types.ts:207-210). Rewind rows, /btw (explicit atSeq), and /diff turn
use that boundary and label a trailing open turn; the transcript
keeps the open cells and drops the synthetic outcome; HUD and hint
follow agent/status. README names the gap. Fixture tail turn/start,
step/start, user/message, request/header, request/context, step/end
resumed through the shipped profile. 27 production lines; 287 tests.
Ships in alpha.18.
Found 2026-09-06 through the sessionbus lane cells and reproduced
offline: DSH rc.1 loses turn/end when a turn is cancelled while the
LLM fetch awaits response headers (undici mutates the cancel-cause
object, Session.append rejects it; upstream queue, HIGH). The agent
goes idle normally; only the log keeps an open turn. dashi must not
mislead on such a log: HUD and transcript state follow agent status,
never the log tail; rewind, /btw, and /diff turn use the latest
completed boundary and say so when the trailing turn is open;
/history renders the open turn without a spinner; README names the
gap in one sentence. Acceptance: recorded-log fixture with an open
trailing turn (step/end last); renderer and reducer tests; one PTY
test with the replay provider stalling before headers plus Ctrl+C;
production source under 30 lines.

### W-070 dashi on DSH 0.1.5-rc.2 — status: accepted 2026-09-19 (PR #148 squash-merged)
Bump every DSH peer to `0.1.5-rc.2`, cordis and loader to what rc.2
ships, validated-dsh-versions.json to rc.2, fresh lockfile, run the
full gate, and classify every failure: API change (cite old and new
file:line), removed API (replacement), test-harness assumption,
or DSH regression (upstream). Fix API changes within the existing
mechanisms; no new state. The delta report in the architect's
scratchpad (dsh-delta/REPORT.md) is the map. Acceptance: gate green
on rc.2; README and DESIGN version references updated.

Added 2026-09-19 (D-041): owner ruling on the cold-resume failure: the
gate asserts the 50k fixture at the measured rc.2 bound; the 200k result
is documented as a named DSH gap with the file:line and upstream commit.
The test-only sessionPersistence provider stub for the rc.2 schedule
harness is accepted. Acceptance is conditional on roller 0.1.3 (W-011
in roller) removing the three rc.1 peer islands from the lockfile; no
overrides or packageExtensions.
Accepted 2026-09-19 at 2c3a21d: 290/290 tests, 233 DSH packages uniform at
0.1.5-rc.2, @antst/roller 0.1.3, no rc.1 islands. Cold-resume gate is the
50k fixture (measured 11,879 ms, bound 15,000 ms); the 200k curve is in
README Known DSH gaps. Streaming debounce stays 34 ms; the PTY frame-rate
measurement now counts intervals over their span (26.3 fps under the 30
cap). Rewind test asserts the exact V3 order. Test-only sessionPersistence
stub for the schedule harness. /btw and /recap refuse while the source
runs. Peer-only closure adds 18 exact devDependencies.

### W-071 sessionbus-dsh on DSH 0.1.5-rc.2 and 0.1.6-alpha.2 — status: accepted 2026-09-18 (sessionbus-dsh PR #2 squash-merged; owner roller-exec)
Peers `0.1.5-rc.2 || 0.1.6-alpha.2`, cordis 4.0.2, loader 1.0.3, kit
0.1.0-pre.3 exact; @antst/dsh-file-uploads-none as a preview
dependency until its npm publish (README marks it). Installer writes
only profile-local rows: the base-backed `sessionbus` lane profile by
default (dsh-base, persona, title job disabled, workspace,
session-controller, file-uploads-none, plugin row mode: lane), a peer
row plus file-uploads-none for named non-web profiles, existing
sessionbus rows left alone; the global home-patch row and the
all-profile scan are deleted (rc.2 composes the home patch after every
profile layer, so a global row collided with dashi's and the lane's).
Dispose releases tool and command registrations for alpha.2's runtime
unload (enable-disable-enable test); session/writer-held relayed as a
plain open failure; docs/LANE-WITHOUT-TUI.md. 38 tests; real-DSH
proofs on both versions (lane hello, web boot, dashi co-install,
packed install). Version stays 0.1.0-pre.1 until the publish commit.
In the plugin repo (branch from main 9a4b7d4): peer range
`0.1.5-rc.2 || 0.1.6-alpha.2` for every @deepseek-ai/dsh-* peer,
cordis and loader to what those DSH versions ship, kit exact; the
plugin's node tests plus a real-DSH proof per version: base-only
`sessionbus` lane profile boots with no CLI task, `dsh --profile web`
with the home-patch peer row loads the plugin, and the installer's
all-profile suppression (mergedProfilesHaveSessionbus) does not
leave a selected non-dashi profile without the row when dashi is
co-installed (fix if it does). A short docs/LANE-WITHOUT-TUI.md:
how the daemon uses the lane profile with no dashi (exec
`dsh --profile sessionbus` with the token). Acceptance: tests green
on both versions; a packed tarball installs into a fresh profile on
each.

### W-072 Gate matrix over validated DSH versions — status: accepted 2026-09-19 (PR #162 squash-merged)
ci.yml and release.yml run the container gate once per version in
validated-dsh-versions.json (matrix), the DSH-versions check
accepting the matrix entry; local `pnpm gate` takes an optional
version and defaults to the first. Production source 0.

Added 2026-09-19 (D-041): scope is now encoding D-041 in dashi. Peer
ranges `>=0.1.5-rc.2` in all three manifests (after roller 0.1.3);
scripts/gate.mjs drops the one-validated-version rule (:68) and the
peers-must-equal-validated rule (:97-103) and keeps catalog and
lockfile convergence (:72-81); validated-dsh-versions.json takes the
{minimum, tested} shape; ci.yml and release.yml run the container gate
once per `tested` entry (three legs); the "not validated" runtime
warning in packages/dashi/src/index.ts (:24, :157-159) is deleted, the
`dsh` versus `dsh-base` mismatch warning stays; README install line
rewritten. Owner roller-exec after W-011. Production source: the
deleted warning only.
Accepted 2026-09-19 at 816b390: peers `>=0.1.5-rc.2` in all three
manifests (dashi-app dependencies too, per D-041); catalog and lockfile
exact rc.2; validated-dsh-versions.json = {minimum, tested} consumed by
CI, gate script and docs only, no longer shipped; gate.mjs asserts the
leg is in tested and the graph is uniform; the default leg installs the
committed workspace with --frozen-lockfile, other legs rewrite into a
temp workspace via catalog rewrite plus a readPackage hook and assert
uniformity; ci.yml/release.yml derive three container legs with
fromJSON; the 'not validated' runtime warning is gone (production -4).
Hosted run 35448781487: rc.2 233, alpha.1 238, alpha.2 252 packages,
290/290 each. A first-attempt alpha.1 failure was the pre-existing '@'
image PTY race (W-080).

### W-073 dashi on DSH 0.1.6-alpha.2 — status: accepted 2026-09-19 (PR #161 squash-merged)
Second matrix entry: gate green on alpha.2 with the same code;
failures classified as in W-070; alpha-only differences (runtime
dependency resolution/unload, multi-instance Session API) handled
without branching dashi's code by version unless unavoidable, and
then named in the ledger.

Added 2026-09-19 (D-041): covers 0.1.6-alpha.1 as well as alpha.2.
`agent/session-start` and `agent/created` are both handled by the same
fold; no dependency on dsh-plugin-manager or
dsh-code-runtime-worker-thread; both alpha legs of the matrix green.

Builder note: dashi consumes only the stable `agent/status` projection
(`packages/dashi/src/session-runtime.ts:1214-1218`); the renamed startup
event is DSH-internal, so alpha compatibility needs no version branch.
Accepted 2026-09-19 at 3f0909d: zero production source lines. dashi
never consumed agent/session-start or agent/created; its one lifecycle
fold is the agent/status listener (session-runtime.ts:1214-1218), so
the rename is DSH-internal and there is no version branch. dashi-app
drops its dsh-code-runtime-worker-thread insert (unreachable: dashi
never sets ptc tools mode; the package is gone on the alphas) and the
rc.2 workflow-worker-thread disable (row absent from the alpha base;
its consumers stay disabled). Test harness pins every @deepseek-ai/dsh*
package per leg and asserts a uniform graph before boot; the MCP
fixture answers unknown methods with -32601 for alpha.2's client.
Local gates: rc.2 290/290 (233 packages), alpha.1 290/290 (238),
alpha.2 290/290 (252). CI runs only rc.2 until W-072 ships the tested
matrix and the reshaped validated-dsh-versions.json.

### W-074 fileUploads provider for non-web profiles — status: accepted 2026-09-18 (PR #149 squash-merged, standalone)
packages/file-uploads-none: one plugin providing `fileUploads` with
DSH's own four-no-op test-stub shape (rc.2 session-controller
tests/test-remote.ts:269-276), no runtime or type dependency on the
web package (which did not exist at rc.1); dashi-app row and exact
workspace pin; fourth package in ci.yml previews, release.yml
publish order, Dockerfile, and the clean-install test; README names
the DSH gap. 12 production lines; 288 tests on rc.1. The
FILE_NOT_STAGED relay proof runs on rc.2 in W-070 (fixture command
dashi-file-fixture is in place).
DSH 0.1.5-rc.2 and 0.1.6-alpha.2 make dsh-api-session-controller
hard-inject `fileUploads` (packages/api/session-controller/src/index.ts:92,
used at :125-129 and commands.ts:351,362,477), provided only by the
web client's @deepseek-ai/dsh-client-file-upload (needs `connection`);
DSH's own acp/headless/sdk bundles never mount session-controller, so
every non-web profile that does (dashi, the sessionbus lane) fails to
activate. Fix: new package packages/file-uploads-none published as
@antst/dsh-file-uploads-none, one plugin providing `fileUploads` with
DSH's own test stub semantics (session-controller/tests/test-remote.ts:269-276):
registerAgentResolver returns a disposer, resolve returns undefined,
bindPrompt returns a no-op Disposable, retirePrompt no-op; a prompt
with a file part fails with DSH's own FILE_NOT_STAGED error. dashi-app
depends on it exactly and inserts row file-uploads-none; release.yml
and the manifest check gain the fourth package; the sessionbus lane
profile inserts the same row (W-071). README names the DSH gap.
Acceptance: shipped profile boots on rc.2 and runs a prompt; a file
part relays FILE_NOT_STAGED; production source under 25 lines.

### W-075 Gate and release workflows for sessionbus-dsh — status: accepted 2026-09-18 (sessionbus-dsh PR #3 squash-merged; owner roller-exec; production source 0)
ci.yml: matrix over the peer disjunction (hardcoded; must move with the
peers), each cell a home-level install of that DSH in an isolated
DSH_HOME, npm test, and the packed real-DSH proof (profile rows, exact
versions, lane hello over a fake socket, web boot, dashi-row
coexistence); an aggregator job `gate` requires every cell and then
publishes pkg.pr.new previews; the standalone preview workflow is
gone. release.yml on v* tags mirrors dashi's (matrix gate, tag =
version, prerelease dist-tag, GitHub release from CHANGELOG,
idempotent publish with provenance). Hosted run green on both
versions. The ops merge rule for the plugin repo is now: `gate`
SUCCESS on the exact head.
The plugin repo has no gate check (GitGuardian only). Add ci.yml: on
pull requests and pushes to main, `npm test` plus the packed-tarball
install proof, once per DSH version in the peer disjunction (matrix
over 0.1.5-rc.2 and 0.1.6-alpha.2, each in an isolated DSH_HOME with
a home-level install), plus pkg.pr.new previews; and release.yml
modeled on dashi's (tag push v*, gate, GitHub release from the
changelog, npm publish with provenance, skipping already-published
versions) for use after the owner's manual first publish. Production
source 0. The operations peer's merge rule for that repo becomes: the
`gate` check SUCCESS on the exact head.

### W-076 sessionbus-dsh peer floor and tested matrix — status: accepted 2026-09-19 (sessionbus-dsh PR #4 squash-merged)
package.json peers per D-041 (`>=0.1.5-rc.2` for every `@deepseek-ai/*`
peer, cordis `^4.0.2`, loader `^1.0.3`); package.test.cjs asserts the
floor form instead of the frozen disjunction; ci.yml matrix becomes the
tested list (0.1.5-rc.2, 0.1.6-alpha.1, 0.1.6-alpha.2); README
compatibility line states minimum and tested. Production source 0.

Added 2026-09-19 (pdev clarification): the `>=0.1.5-rc.2` floor applies
to DSH-versioned packages only; `@deepseek-ai/cordis` and the loader
keep their own caret ranges. The pnpm peer-check behavior is evidence
for pnpm 10, not a semver guarantee, so the gate exercises the ordinary
paths on the installed pnpm without pinning it: install into a profile
at 0.1.5-rc.2, at a newer prerelease (0.1.6-alpha.2), and at a
below-floor version (0.1.2-rc.1: unmet-peer warning, install still
completes, plugin reports the incompatibility on load), and remove
after each.
Accepted 2026-09-19 at e1fd53c: peers `>=0.1.5-rc.2`, cordis `^4.0.2`,
loader `^1.0.3`; CI legs rc.2, alpha.1, alpha.2 install and boot; a
0.1.2-rc.1 leg installs, asserts the unmet-peer reports, and does not
boot (rc.1 happened to boot on 2026-09-19; recorded as an observation,
never an obligation). CI pins pnpm 10.28.1 via action-setup; proof
scripts stay pnpm-agnostic. README states the uniform-version rule.
Production source 0. The pkg.pr.new dependency on
@antst/dsh-file-uploads-none is replaced by the exact npm version once
alpha.18 publishes it (W-077).

### W-077 sessionbus-dsh package-owned launcher — status: accepted 2026-09-19 (sessionbus-dsh PR #5 squash-merged)
A `sessionbus-dsh` bin in @sessionbus/dsh: when SESSIONBUS_LAUNCH_TOKEN
is present it execs `dsh --profile sessionbus` with argv appended,
otherwise `dsh` with argv unchanged; resolves `dsh` from the same
install the way dashi-launcher/bin/dashi.js does, mirrors signals and
exit code, has no options of its own, about twenty lines. The daemon
registers the product command as this bin; nothing on the daemon side
names a profile. prove-packed-install.sh invokes the bin (with the
token and SESSIONBUS_GROUPS set) instead of `dsh --profile sessionbus`;
docs/LANE-WITHOUT-TUI.md and docs/PROPOSAL.md launcher sections are
corrected to this wiring. dashi's own launcher keeps its token check
(W-036) for the dashi product.

Added 2026-09-19 (pdev daemon contract, cade269 launch.go:48 and
directory.go:227-236): the daemon resolves the product command with
LookPath(product) and claims the worker only when hello.product equals
the launched product exactly; there is no alias mapping. The plugin
therefore stops hardcoding `product: dashi`: the product name is a
required field of the plugin's profile row (`product: dashi` in the
dashi profile, `product: sessionbus-dsh` in the sessionbus profile),
used in both the lane hello and the peer identity, hard error when
missing. The fake daemon in the tests rejects a hello whose product
differs from the product it launched, and both paths are proven: the
dashi launcher (product dashi) and the new bin (product sessionbus-dsh).
Accepted 2026-09-19 at 6a2d748: `sessionbus-dsh` bin (26 lines, mirrors
dashi-launcher: dsh from PATH, SIGINT/SIGTERM and exit mirrored; the
copy is noted in the file); `product` is a required row field written
and repaired in place by install.mjs (`--product`, grammar
^[a-z0-9][a-z0-9-]{0,31}$; lane profile fixed to sessionbus-dsh, any
other value rejected); plugin uses it in peer identity and lane hello
and exits once with the repair command when missing; the fake daemon
rejects a mismatched product; both launch paths proven on rc.2,
alpha.1, alpha.2. The daemon finds the bin on PATH, so a lane host
installs @sessionbus/dsh alongside dsh at the host level in addition
to the per-profile install (README). Production source +103/-14.

### W-078 sessionbus-dsh uninstall — status: accepted 2026-09-19 (sessionbus-dsh PR #6 squash-merged)
`install.mjs --remove <profile>` (same script, one flag) removes the
plugin rows it added from the profile's plugin configuration and runs
`pnpm remove @sessionbus/dsh` in the profile directory; it never boots
DSH, never checks the DSH or pnpm version, and succeeds when the
profile cannot boot. Test: install into a throwaway profile, replace
the DSH packages with a version the plugin cannot load, remove, assert
no plugin row and no package remain. docs/PROPOSAL.md's "missing row is
a hard boot failure" claim (written against 0.1.2-rc.1) is corrected
per version: on 0.1.6-alpha.2 only the core plugin set is fatal
(dsh-app-boot lib/index.js:2469-2477, 2642-2653); rc.2 and alpha.1
behavior checked and stated.
Accepted 2026-09-19 at 7668f00: `--remove <profile>` runs `pnpm remove
@sessionbus/dsh` in the profile directory, then strips only the
installer's own rows (sessionbus, file-uploads-none), ignores product,
never boots DSH or imports plugin code; proven with a corrupted
plugin.cjs and byte-identical unrelated rows; install+remove exercised
on rc.2, alpha.1, alpha.2 and below-floor rc.1. README leads with the
dsh-free invocation. PROPOSAL missing-row facts corrected per version
(rc.2 rejects any enabled unresolved row; alpha.1/alpha.2 reject only
the core set and warn otherwise).

### W-079 sessionbus-dsh groups from the environment, proven — status: accepted 2026-09-19 (sessionbus-dsh PR #8 squash-merged)
Peer-mode proof outside dashi: a profile without config groups, with
SESSIONBUS_GROUPS set to a JSON array, against the fake daemon; the
test asserts the recorded hello carries exactly that array (labeled a
configuration proof). Lane mode, per pdev from the published kit 0.1.0-pre.3 and daemon
cade269: the lane hello forbids groups whenever a launch token exists
(sdk/go/protocol/session.schema.json:26; kit rejects before sending),
the daemon does not export SESSIONBUS_GROUPS (launch.go:55 overlays only
the token and socket), and authoritative lane groups arrive in the
daemon's session.open params (lane.go:43). So the lane-side
SESSIONBUS_GROUPS read in plugin.cjs is deleted: the variable means
peer identity only; a stale or malformed inherited value never blocks
a lane launch; the lane test asserts the hello carries no groups and
that the session.open groups are the ones applied. The umka handoff
includes a real-daemon peer check with groups supplied only by the
environment.
Accepted 2026-09-19 at deedb38 (PR #7 was closed by GitHub when its
stacked base branch was deleted; PR #8 carries the identical patch-id):
lane mode never reads SESSIONBUS_GROUPS and its hello carries no groups
key; session.open carrying the daemon's groups succeeds and the plugin
does not consume them (membership is the daemon's; pdev contract
clearance 2026-09-19). Peer mode: config.groups, else SESSIONBUS_GROUPS,
else none; configuration proof through the real kit against a
Unix-socket fake daemon with no config groups. Real-daemon env-only
peer check remains part of the umka acceptance.

### W-080 PTY flake audit and a blocking macOS gate — status: accepted 2026-09-19 (PR #166 squash-merged)
Three shipped-profile PTY tests failed once each on hosted runners on
2026-09-19 with no code cause: 'completes cwd-bounded paths, attaches an
@ image, and stashes the image draft' (Linux alpha.1 leg, run
35448781487 attempt 1: expected the frame not to contain '[image 1]'
after 64 s), 'keeps the selected row reachable in a model picker taller
than the terminal' (macOS, timed out at profile-pty.spec.ts:2884 after
the W-073 wait fix), and 'interrupts a running stream, restores the
terminal, and resumes the root' (macOS, terminal-mode capture missing).
Scope: for each, find the assertion that races observed state (a
negative assertion on a frame that has not repainted, a wait keyed on
bytes instead of parsed frames, a ceiling too small for the mac
runner), fix the wait; never add sleeps or raw escapes, never widen an
assertion. Then remove continue-on-error from macos-gate in ci.yml so
it blocks. Production source 0. Acceptance: each test 20/20 locally
under load, three consecutive green hosted runs including macOS,
macos-gate required.
Accepted 2026-09-19 at 8f24ac5, production source 0. Causes: the image
stash asserted only a negative on a frame that had not been proven
repainted (now a positive sentinel establishes the frame first); the
tall model picker's inner waits were CI-scaled but the outer test
timeout was a fixed 30 s (now testCeiling); prepareShell waited for the
mode marker then slept 30 ms, so macOS could show the marker before the
stty output (now a shared waitForTerminalMode polls a complete parsed
mode line). Evidence: each test 20/20 under load beside a full gate;
run 35450886839 green on three consecutive attempts including macOS;
macos-gate blocks from now on.

### W-081 sessionbus-dsh: the comms tool is permitted by default — status: accepted 2026-09-19 (sessionbus-dsh PR #15 squash-merged)
Owner directive 2026-09-19 (relayed by the daemon owner): peers and
lanes must have permission to use comms by default, for every product,
with no global bypass of anything else. For the DSH plugin: the
`sessionbus` tool runs without an approval prompt in all three
compositions (dashi profile row, sessionbus lane profile, plain web or
custom peer profile), granted through DSH's own permission mechanism
(the plugin peers on dsh-permission-presets), scoped to that one tool,
unconditionally (owner: no opt-out; a session without comms is an
ordinary launch without the plugin), and nothing else in the sandbox
or approval flow changed. If the narrow grant cannot be established on
a DSH version, the plugin fails the launch truthfully with one line,
never silently disables the tool. Deliverables: a source note with
file:line of the mechanism per tested DSH version and why the plugin
may set it (or, if DSH has no per-tool default grant a plugin can
declare, that fact with file:line and the smallest honest alternative
proposed before implementing); the implementation; packed-matrix proofs
on each DSH leg that a replayed model turn calls the sessionbus tool
with no approval event for the lane profile, the dashi row and the web
peer. Production source small.
Accepted 2026-09-19 at 539c81e, production +7/-1 in plugin.cjs: a
prepended tools/pre-execute waterfall decision registered before the
tool, {kind:'allow'} for the tool named exactly sessionbus, next() for
every other tool; DSH still applies its guard reasons after allow
(rc.2 core/tools/src/index.ts:144, :1464-1478; alpha.1/alpha.2 :146,
:1481-1497; DSH's own interception tests use the pattern). The grant is
an override no later policy can deny, as directed; no opt-out. It
relies on the waterfall present since the 0.1.5-rc.2 floor; the
failure branch covers registration errors only, no feature detection.
Evidence, all fake-daemon replay (distinct from the umka real-daemon
acceptance): unit negative control with an appended ask-all policy
(sessionbus allowed, dummy tool asked); packed proofs on rc.2, alpha.1
and alpha.2 for the lane profile, the dashi row and a web peer, each
with zero approval events for the sessionbus call and exactly one for
the dummy tool; launch_token, no-groups hello and daemon-groups
session.open assertions restored; the alpha.1 pin hook is applied on
that leg only.

### W-082 Release publish job installs the workspace — status: accepted 2026-09-19 (PR #172 squash-merged)
Release run 35458291047 for 0.1.0-alpha.19 failed at 'Publish
@antst/dashi-app' with ERR_PNPM_CANNOT_RESOLVE_WORKSPACE_PROTOCOL for
`@antst/dashi` (workspace:^): W-072 moved `pnpm gate:docker` out of the
publish job into the verify matrix, and no step installs the workspace
on the publish runner any more, so pnpm publish cannot resolve
`workspace:` dependencies. alpha.19 is therefore partial on npm
(@antst/dsh-file-uploads-none and @antst/dashi only; dashi-app and
dashi-launcher never published); it stays as is and 0.1.0-alpha.20
supersedes it. Scope: one step `pnpm install --frozen-lockfile` in the
publish job before the first publish, nothing else; the PR names the
step that left node_modules present in the alpha.18 run 35443532702;
proof by a dry-run publish of dashi-app from a fresh clone of the
alpha.19 tag after that install. Production source 0.
Accepted 2026-09-19 at 3be6e1d: one line, `pnpm install --frozen-lockfile`
in the publish job after setup-node. In the alpha.18 run the
`pnpm gate:docker` step had done a host-side workspace install before
invoking Docker (549 packages), which W-072 removed from the publish
job. Proof: fresh clone of the alpha.19 tag, install, dashi-app dry-run
publish resolves the workspace dependencies.

### W-083 sessionbus-dsh: kit bump for the LanePolicy.trace response field — status: accepted 2026-09-19 (sessionbus-dsh PR #17 squash-merged; released as 0.1.0-pre.4)
The daemon side plans an optional response-only `policy.trace` on
successful spawn/resume (bus candidate c936873, unreleased). Kit
0.1.0-pre.3, which the plugin pins exactly (package.json:16), validates
every result frame against closed schemas (LaneSpawnResult
session.schema.json:273, LanePolicy :405, no `trace`) and closes the
whole connection on an invalid frame (connection.js:74); the plugin
passes every kit action through generically (plugin.cjs:12,325) in
both modes (peer caller plugin.cjs:288-314; lane agents reach the same
surface via worker.caller at :307), so both modes would lose the
connection. Scope, when the daemon side names the compatible published
kit version: bump the pin, add one round-trip test that a spawn
response carrying policy.trace decodes, release the plugin. No input
schema rewrite, no plugin logic change. No daemon carrying the field is
rolled to a DSH host before that release.
Accepted 2026-09-19 (sessionbus-dsh PR #17): @sessionbus/kit pinned exactly
to the registry 0.5.5 (gitHead 326bc81, verified by the daemon owner);
one fake-daemon Unix-socket round-trip test proves a lane.spawn result
carrying policy.trace reaches the tool result unchanged through both
the peer caller and a lane agent's worker.caller; the manifest test
asserts the kit spec stays an exact version. No plugin logic or input
schema change; 49 tests; three DSH legs green. Released as 0.1.0-pre.4
together with W-081 (0.1.0-pre.3 was tagged but never published).

### W-084 sessionbus-dsh: dashi as the single registered product for lanes — status: accepted 2026-09-20 (sessionbus-dsh PR #21 squash-merged; released as 0.1.0-pre.5)
Owner ruling 2026-09-20: a host with dashi installed registers one
product, `dashi`, for peers and lanes. The daemon claims a lane only
when the hello product equals the launched command, and the product
comes from the profile row, so the lane profile's row must be able to
say `product: dashi` when the dashi launcher is the registered command
(the launcher already turns the launch token into `dsh --profile
sessionbus`). Scope: `sessionbus-dsh-install` accepts `--product dashi`
for the lane profile (W-077's rejection is narrowed to: the lane
product must be either `sessionbus-dsh` or `dashi`); the row repair
path keeps working; README and docs/HOST-INSTALL.md gain the
one-product variant (register `dashi`; no `sessionbus-dsh` in
SESSIONBUS_PRODUCTS; the drop-in PATH still needs the bin directory so
`dashi` resolves `dsh`) beside the existing two-product form. Proof in
the packed matrix on each DSH leg: the fake daemon launches
`@antst/dashi-launcher`'s `dashi` bin with the launch token and asserts
hello.product === 'dashi' and a completed lane turn, using the
published launcher 0.1.0-alpha.20 (or newer exact) in the throwaway
prefix; the `sessionbus-dsh` path stays proven. Production source
small (installer only).
Accepted 2026-09-20 at 80263dc, installer-only production change (+5/-4):
the lane profile's product defaults to sessionbus-dsh and accepts
`--product dashi`, any other value rejected; row repair works both
ways; tests for both values. Packed proof on rc.2, alpha.1 and alpha.2
installs the published @antst/dashi-launcher 0.1.0-alpha.20 and has the
fake daemon launch its dashi bin with the launch token, asserting
hello.product === 'dashi' and a completed replay turn; the
sessionbus-dsh lane path stays proven. README and docs/HOST-INSTALL.md
carry the one-product form as a variant beside the two-product
procedure. No dashi launcher change. The runbook (PR #20, dc29d87) now
holds the proven graph repair as one helper (exact pins of stale
peer-only records, frozen install, checker; zero DSH records is
coherent for lane and web profiles) with the hook removed.

### W-085 sessionbus-dsh: release job needs npm 11.5+ for trusted publishing — status: accepted 2026-09-20 (sessionbus-dsh PR #23 squash-merged)
Release run 35530075138 (0.1.0-pre.5) signed provenance but published
unauthenticated and got E404: the publish step ran node 22's bundled
npm 10.9.8, and npm's trusted publishing (OIDC token exchange with the
registry) exists only from npm 11.5.1. dashi's workflow is unaffected
because it publishes through pnpm. Scope: one step in the publish job,
`npm install -g npm@^11.5.1` on the runner before the publish, with the
version printed; nothing else. 0.1.0-pre.5 stays a GitHub-only tag
(never on npm, like pre.3); the next release publishes unattended.
Accepted 2026-09-20 at 1fd1c21: one publish-job step, `npm install -g
npm@^11.5.1 && npm --version`, after setup-node (npm trusted publishing
requires CLI 11.5.1+, docs.npmjs.com/trusted-publishers). Released as
0.1.0-pre.6 together with W-084; 0.1.0-pre.3 and 0.1.0-pre.5 remain
GitHub-only tags.

### W-086 sessionbus-dsh: a turn that fails before the input commit ends the run as failed, not unavailable — status: accepted 2026-09-20 (sessionbus-dsh PR #27 squash-merged)
Found on the dsh host's section 5: DSH threw at turn start in the lane
composition (turn/end reason error, code UNKNOWN, "Cannot read
properties of undefined (reading 'get')") before committing the
user/message for the run. The plugin (0.1.0-pre.4) binds a run to its
turn only after the user/message commit, so it ignored that turn/end
and, when the agent went idle, retired the run as
state unavailable, reason "DSH reached idle without turn/end", with no
result. The caller thus lost the DSH error. Scope: when a turn/end with
reason error arrives for the turn opened by the run's input before any
user/message commit (or the agent goes idle after such a turn/end), the
run terminates as done with result.outcome failed and
native_stop_reason error carrying DSH's code and message; unavailable
stays reserved for the case where no turn/end exists at all. Unit
test with a replayed turn/end error before the commit; packed proof on
each DSH leg with a fixture plugin that throws at turn start. Production
source small (plugin.cjs). The DSH-side crash is diagnosed separately.
Accepted 2026-09-20 at 7097f3b (sessionbus-dsh PR #27): a turn/end with reason
error for the run's opened turn before any user/message commit, or idle
right after it, ends the run done with result.outcome failed,
native_stop_reason 'error' and result '<code>: <message>' verbatim from
DSH; unavailable only when no turn/end exists; bound-turn behavior
unchanged. Unit test with a replayed pre-commit turn/end error; packed
proof on rc.2, alpha.1 and alpha.2 with a fixture plugin that throws at
turn start. Released as 0.1.0-pre.7 with W-087.

### W-087 sessionbus-dsh: user message text is a string, proven in the durable log — status: accepted 2026-09-20 (sessionbus-dsh PR #26 squash-merged)
Found live on the dsh host once the provider plugin was fixed: the
lane's turn completed but the durable user/message carried
content[0].text as a nested object ({text: "..."}) and the model
answered "I received '[object Object]'". The plugin (plugin.cjs:158-160)
builds the message with createUserMessage({content:[{type:'text',
text: body}]}), which rc.2 nests. Scope: cite rc.2's createUserMessage
signature and the user/message content schema (and alpha.1/alpha.2),
fix every message-construction site in plugin.cjs to the exact shape;
unit test on the emitted content; packed proof on every DSH leg reads
the durable session log after the replayed turn and asserts
content[0].type === 'text' and content[0].text equals the input string
exactly, and that the replay provider's captured request contains it.
This assertion was missing from the W-071 proofs and let the defect
through. Production source small. Released together with W-086 as
0.1.0-pre.7; the host runbook re-pins to it.
Accepted 2026-09-20 at 11c770a, plugin.cjs +6/-1: the run seed is
unwrapped per the kit contract (string; {text}; {delivery.body}), any
other shape fails the run naming it; the seed is never stringified;
delivery-backed runs report the injected receipt only after DSH has
spliced the message. The shape has been the same since kit pre.3, so
the defect dates from W-071; the missing text assertion hid it. Proofs:
six unit cases; packed proof on rc.2, alpha.1 and alpha.2 runs an
ordinary and a delivery-backed turn and asserts the exact text in the
durable user/message and in the replay provider's captured request.

### W-088 sessionbus-dsh: the installer merges into an existing profile manifest — status: accepted 2026-09-20 (sessionbus-dsh PR #29 squash-merged; released as 0.1.0-pre.8)
Found on the dsh host's pre.7 re-pin: running the installer for the
existing sessionbus lane profile rewrote the profile's package.json
(dependencies and bundles) to only @sessionbus/dsh and dsh-base,
dropping the provider plugin dsh-codex 0.3.0 that the parity step had
added, so the Codex adapter no longer registered there; the patch file
itself was repaired correctly. Scope: `sessionbus-dsh-install` adds or
repairs only its own dependency entry and its own rows and bundle
entries; every other dependency, bundle and field of an existing
profile manifest is preserved byte-for-byte; unit test with a profile
manifest carrying an extra dependency and an extra bundle; packed proof
on each DSH leg installs into a pre-populated lane profile and asserts
the extra entries survive and the provider still registers. Also the
runbook: any check loop stops at the first failing profile. Production
source small (install.mjs). Manual repair on an affected host: re-add
the provider package to the profile with exact saving.
Accepted 2026-09-20 at c74bf32, install.mjs +/- small: an existing
sessionbus manifest is merged (the plugin entry, its rows and the
dsh-base bundle added or repaired), never rebuilt; other dependencies,
bundles and fields survive byte-for-byte (unit regression with an extra
dependency, bundle and custom fields; packed proof on rc.2, alpha.1 and
alpha.2 with a pre-populated lane profile). Runbook: check loops stop
at the first failure; the host assertions are lock uniformity, the
executing package beside the realpath dsh bin at the target, headless
boot and exact closure, with the hoisted top-level projection reported
only (D-043 addendum).

### W-089 sessionbus-dsh: peer re-hello keeps a valid identity against the real daemon — status: accepted 2026-09-20 (sessionbus-dsh PR #31 squash-merged; released as 0.1.0-pre.9)
Found on the dsh host at 0.1.0-pre.7 with the real daemon: the web
profile launched as a peer (launch token absent, groups only from
SESSIONBUS_GROUPS) bound its native session after the first prompt,
the plugin's title-triggered re-hello was refused with
"sessionbus: invalid rehello identity", and the peer never appeared in
the roster, so no discovery or reply was possible. The lane path is
unaffected. The plugin's fake daemon accepts any re-hello, which is why
the W-079 configuration proof passed. Scope: (1) record the exact
identity difference between the first hello and the re-hello
(session_id, name, product, groups, info) and the daemon's rule for
what may change on one connection (from the daemon owner, source
cited); (2) make the peer path conform: a re-hello changes only what
the daemon allows, and a native session id that becomes known after
the first hello is handled the way the daemon requires (re-hello with
the id if allowed, otherwise a new connection); (3) the fake daemon
enforces the real rule and a failing test is written first; (4) packed
proof on each DSH leg: a web peer launched with env-only groups
appears in list with the native session id, groups and product, and
answers a message from another peer. Production source small
(plugin.cjs). Released as 0.1.0-pre.9; the runbook's web step is
re-run on both hosts.
Accepted 2026-09-20 at 4e35bea (sessionbus-dsh PR #31), plugin.cjs +11/-5: the
peer is published only once the authoritative native session id
exists (no provisional identity); title changes call the kit's
rehello(undefined, name, info) with an omitted name when the title is
empty; a changed durable session id goes through replace(fullIdentity)
with product and groups unchanged. The failure text "invalid rehello
identity" was thrown locally by the kit (sdk/js/index.js:222) because
the plugin passed one object to rehello(signal, name, info); the
signature was the same at kit pre.3, so the defect dates from W-071 and
the fake daemon's unconditional acceptance hid it. The fake daemon now
enforces schema-valid identities, immutable product and ordered-groups
equality, serves the admitted peer in list and delivers a message from
a second peer; unit mocks expose the real kit signature; packed proof
on rc.2, alpha.1 and alpha.2 shows a web peer with env-only groups in
list with its native id, a surviving title change, and an answered
message. 54 tests. Released as 0.1.0-pre.9.

### W-090 sessionbus-dsh: the installer refuses a profile whose bundle already provides the row — status: accepted 2026-09-20 (sessionbus-dsh PR #33 squash-merged; released as 0.1.0-pre.10)
Found on the dsh host: dashi-app 0.1.0-alpha.20 ships the sessionbus
row (product dashi, W-036) inside dashi-app, and the host runbook's
section 4 still ran the installer on the dashi profile, which added a
second row with the same id; `dashi` and `dashi --help` then failed
with "plugin tree failed to load: duplicate loader entry id:
sessionbus". Repair: `sessionbus-dsh-install --remove dashi`, which
removes only the installer's rows and the profile-level package;
dashi-app's own dependency and row stay. Scope: the installer detects a
row id it would add that is already provided by one of the profile's
bundles (read the bundle's patch as DSH composes it) and refuses with a
one-line message naming the bundle, exit 2, no change; unit test with a
bundle fixture carrying the row; packed proof on each DSH leg against
a profile whose bundle provides the row. Runbook: the dashi profile
needs no installer run from dashi-app 0.1.0-alpha.20 on (the product
row and the plugin dependency ship with dashi-app; until dashi re-pins,
the dashi product runs the plugin version dashi-app pins). Production
source small (install.mjs).
Accepted 2026-09-20 at 437498b, install.mjs +70/-14 and bin.mjs +1/-1
(exit code): before any mutation the installer resolves the target
profile's bundles in DSH's order (executing install first, then
profile; rc.2 app-boot profile.ts:751-803) and refuses with exit 2 and
one line naming profile, bundle and row when a bundle already provides
the sessionbus or no-uploads row; every row it writes carries the
comment `# sessionbus-dsh-install owned`, re-runs mark older
installer rows, and `--remove` deletes only marked rows, refusing an
unmarked matching id before pnpm runs. 57 tests; packed proof on
rc.2, alpha.1 and alpha.2 with a real bundle fixture (refusal without
change, then the bundle-composed profile boots and completes the
existing proof). Docs: no installer run on the dashi profile from
dashi-app 0.1.0-alpha.20 on; dashi-app owns its row and plugin pin.

### W-091 dashi-app pins the fixed plugin release — status: accepted 2026-09-21 (PR #208 squash-merged; released with 0.1.0-alpha.21)
dashi-app 0.1.0-alpha.20 pins @sessionbus/dsh 0.1.0-pre.2 (W-036), so
the dashi product runs a plugin without W-081 (default tool grant),
W-083 (kit 0.5.5), W-086/W-087 (run result and text), W-088 (installer
merge) and W-089 (peer re-hello), while lane and web profiles on the
same host run the current release. Scope: bump the exact pin in
packages/dashi-app/package.json to the release carrying W-089 and
W-090, regenerate the lock, keep the sibling row `product: dashi`, run
the gate (the shipped-profile PTY proves the row active and the
launcher token and -g paths), and release dashi 0.1.0-alpha.21. The
host runbook then re-pins dashi-app on both hosts (profile add of the
exact dashi-app version, graph check, boot heal, closure check, dashi
roster check). Production source 0 beyond the manifest.
Accepted 2026-09-20 at ab1ef27 (PR #208): packages/dashi-app pins
@sessionbus/dsh 0.1.0-pre.12 exactly (W-081 default tool grant, W-083
kit 0.5.5, W-086/W-087 run result and text, W-088 installer merge,
W-089 peer re-hello, W-090 bundle-row refusal, W-093 global root
observation and socket discovery); the sibling row `product: dashi`
unchanged; the shipped-profile PTY proves the row active and the
launcher token and -g paths; no test hardcodes the plugin version.
Released with 0.1.0-alpha.21; both hosts re-pin dashi-app.

### W-092 Release publish job builds and verifies tarball contents — status: accepted 2026-09-20 (PR #195 squash-merged; released as 0.1.0-alpha.21)
Found on the dsh host after the alpha.20 install: the dashi profile
fails to boot with "Cannot find module .../@antst/dashi/lib/index.js";
npm confirms @antst/dashi@0.1.0-alpha.20 has dist.fileCount 3 (no lib/)
against 56 for alpha.18, and @antst/dsh-file-uploads-none@0.1.0-alpha.20
likewise 3. Cause: W-072 moved `pnpm gate:docker` out of the publish
job (the step that had built lib/ on the runner) and W-082 restored only
the frozen install, so alpha.19 (partial) and alpha.20 were published
without compiled output; the umka-dev1 host installed alpha.20 and is
broken the same way. Scope: the publish job runs `pnpm build` after
the frozen install, and a guard before the first publish runs a dry-run
pack in each of the four packages and fails the job unless the file
list contains the package's entry files (lib/index.js for dashi and
dsh-file-uploads-none; the shipped entry files for dashi-app and
dashi-launcher); nothing else. Proof: alpha.18 vs alpha.20 file counts
from `npm view`, and the guard run on a fresh clone of the alpha.20 tag
failing before build and passing after. Released as 0.1.0-alpha.21;
0.1.0-alpha.20 is deprecated on npm with the reason; both hosts re-pin
dashi-app to alpha.21.
Accepted 2026-09-20 at 8ed83b3: release.yml's publish job runs `pnpm
build` after the frozen install and a guard that dry-run-packs all
four packages and requires lib/index.js (dashi, file-uploads-none),
cordis.patch.yml (dashi-app) and bin/dashi.js (dashi-launcher) before
the release and the publishes. Proof: alpha.18 vs alpha.20 fileCount 56
vs 3 (dashi) and 5 vs 3 (file-uploads-none); on a fresh alpha.20 tag
clone the guard fails before build and passes after; in the alpha.18
run the `pnpm gate:docker` step had installed and built on the
runner, which W-072 removed from the publish job.

### W-093 sessionbus-dsh: a web-client root publishes the peer — status: accepted 2026-09-20 (sessionbus-dsh PR #35 squash-merged; released as 0.1.0-pre.11)
Found on the dsh host at 0.1.0-pre.9 with the real daemon: the web
profile launched as a peer (token absent, groups from
SESSIONBUS_GROUPS, SESSIONBUS_SOCKET set) connects, creates a native
root through the web client, completes model turns, yet sends no hello
and never appears in the roster. The W-079 packed proof created its
root by another path and passed. Scope: identify the peer-mode
publication trigger after W-089 and why a root created through the
web client's session-controller path (possibly before the plugin's
listener attaches, possibly untitled, possibly several roots) does not
trigger it; state the design (first root publishes, or one identity
per root) with the reason; reproduce in a unit test with a root
created the web client's way; fix; packed proof on each DSH leg
creates the root through the web client path and asserts the peer in
list with its native session id, product and env-only groups, and an
answered message. Also record the presence socket rule: whether the
plugin's default socket path must follow the daemon's canonical
location (a plugin fix) or the runbook exports SESSIONBUS_SOCKET for
peer launches (a docs line), per the daemon owner's answer. Production
source small (plugin.cjs). Released as 0.1.0-pre.11; W-091 pins that
release.
Accepted 2026-09-20 at b4d444c (sessionbus-dsh PR #35): two causes,
both from source. (1) DSH emits agent/created and agent/disposed through
the agent scope carrier (rc.2 core/agent/src/index.ts:415-423,
451-479, 533-555) and the plugin's listeners were not global, so a root
created by the web client after readiness (session-controller
commands.ts:87-109 -> agent.ts:473-487) was never seen; the startup
scan had already run. (2) present() treated the synchronous return of
the kit's connectPeer as publication while the kit connects and sends
hello asynchronously (sdk/js/index.js:200-213, 239-249), so a failed
connect or rejected hello was silent and later title events were
suppressed by the published flag. Fix: root create/dispose observed
globally with one peer per root and the startup scan retained; every
identity, socket or hello failure prints one sanitized sessionbus: line
per root and drops the root's peer record, so the next real change
(a title event) publishes it again; no retry loop. Socket
discovery follows the daemon's rule (explicit socket made absolute,
else XDG_RUNTIME_DIR/sessionbus/presence.sock, else
/tmp/sessionbus-<uid>/presence.sock; no scanning); the runbook exports
no socket. 60 tests including the scope-accurate regression that
failed before the fix; packed proof on rc.2, alpha.1 and alpha.2 creates
the root through the real web session/create RPC (no rename crutch) and
asserts the peer in list with product dsh, env-only groups and an
answered message; the rc.2 leg launches without SESSIONBUS_SOCKET. The
pre.9 live failure's transport error text is unrecoverable (it was
discarded); a recurrence is now visible. Released as 0.1.0-pre.11.

### W-094 PTY: jobs-and-subtask case races observed state on the alpha.1 leg — status: accepted 2026-09-20 (PR #202 squash-merged)
The 0.1.0-alpha.21 release gate (run 35537837198) failed once on the
0.1.6-alpha.1 leg: profile-pty.spec.ts:3977 'reads and kills jobs and
starts a continuable subtask through DSH', "expected false to be
true"; 295 others passed; rc.2 and alpha.2 legs green. Not one of the
three W-080 cases. Scope: diagnose from the failed log and the test
source without re-running; if the assertion reads state before the
frame that carries it, fix the wait on observed state (no sleeps, no
raw escapes, no widened assertion); if alpha.1 behaves differently,
name the DSH file:line first. Evidence: the test 20/20 under load on
rc.2 and alpha.1 through the version seam, five checks green. The
alpha.21 release PR is rebased on the fix and re-gated; no re-run of
a failed gate without a fix.
Builder note: the same macOS run exposed a W-080 frame-helper defect: once
the 12-row picker scrolled the dashi header off screen, `slice(-1)` made the
observed-state wait inspect only the footer. The fallback now returns all
visible rows when no header is present.
The third hosted run exposed the W-080 image input ordering race: the attachment
can render before its completion overlay relinquishes input. The test now proves
composer ownership by typing and observing its prompt before sending Ctrl+S.
Accepted 2026-09-20 at 55f4f35 (PR #202), production source 0. Three
test defects of one family: (1) the jobs-and-subtask case read the
child's durable user/message synchronously after the parent's
"Subagent" repaint; it now waits on the child's durable log. (2) The
W-080 frame helper used `slice(-1)` when the dashi header had scrolled
off the 12-row picker, so the observed-state wait saw only the footer
on the slower macOS runner; the fallback now returns all visible rows.
(3) The image-stash case sent Ctrl+S while the completion overlay
could still own input after rendering the attachment chip, so the
stash was consumed outside the composer; the test now types and
observes the prompt beside the attachment (composer ownership) before
Ctrl+S, waits for both to leave, and for both to return on restore.
Each case 20/20 under load on rc.2 and alpha.1 (alpha.1 through the
version seam, 315/315 with the case expanded); three consecutive green
hosted runs including macOS on this head. Not alpha.1 behavior
differences. The alpha.21 release PR was rebased on it and re-gated;
the audit of the whole family is W-096.

### W-095 sessionbus-dsh: a live web root reaches the publication gate — status: accepted 2026-09-20 (sessionbus-dsh PR #37 squash-merged; released as 0.1.0-pre.12)
At 0.1.0-pre.11 on the dsh host against the real daemon, the web
profile launched as a peer (token and socket unset, groups from the
environment) created a native root through the web RPC (durable log:
header, permission/preset, sandbox/mode, approval/policy, no title)
and still published nothing: no row, no connection attempt, and no
`sessionbus:` stderr line, so present() was never reached; the W-093
packed proof passes against the fake daemon, so it does not exercise
the live path. Scope: reproduce live on the dsh host in a throwaway
profile against the real daemon, creating the root the same way; add
an env-gated trace (SESSIONBUS_DSH_TRACE=1, stderr, one line per
event: mode, ready transitions, every agent/created and agent/disposed
with scope, roots() membership at present(), the early-return reason)
kept in the product, off by default; find the failing gate with
plugin.cjs and DSH source citations; fix; make the packed proof fail
without the fix by matching the live path (the RPC used, --port 0 and
--host, app-ready ordering in the web bundle, the row's position);
hand off with the live trace. Production source small. Released as
0.1.0-pre.12; W-091 pins that release; the alpha.21 dashi release
ships without W-091.
Amended 2026-09-20: re-scoped to hardening. The live reproduction on
the dsh host (exact launch and HTTP session/create path, env-gated
trace) shows the pre.11 plugin publishing correctly: agent/created
seen globally, present, connect to the daemon's runtime socket,
connected, and the row visible to an observer peer in the same group.
The reported absence came from a caller in another group (`list` shows
only peers sharing a group with the caller) and the "no connection"
claim was an observation error. Scope now: keep the env-gated trace
(off by default, documented); the packed proof and the runbook's
web-peer step assert presence from a same-group observer and state the
visibility rule; no behavior change. W-091 pins 0.1.0-pre.11.
Accepted 2026-09-20 at 718c89b (sessionbus-dsh PR #37), hardening only:
SESSIONBUS_DSH_TRACE=1 prints one stderr line per event (mode and
readiness, global agent lifecycle, root membership and the publication
gate's reason, socket connection), off by default and documented; the
packed web proof asserts observer and subject share a group; the
runbook's web step requires a same-group observer, states that list
shows only peers sharing a group with the caller, and drives the idle
peer with one session/prompt before asserting its reply. Live trace on
the dsh host: ready, agent/created global, present reason=publish,
connect to the runtime socket, connected. 61 tests; three DSH legs
green. Released as 0.1.0-pre.12. dsh host web peer PASS at pre.11 with
a same-group observer and an answered message.

### W-096 PTY suite: every negative assertion is region-scoped and follows an observed positive state — status: accepted 2026-09-21 (PR #212 squash-merged)
The alpha.21 release gate failed three times in three different PTY
cases on different legs (W-094: jobs-and-subtask read before the child
log; the tall model picker's frame helper kept only the footer once
the header scrolled; the image-stash negative assertion matched the
stash notice in the whole frame). Each was a test defect of the same
family: an assertion on the whole frame, or a negative assertion made
before the positive state that must precede it was observed. Scope:
audit every `not.toContain` / negative expectation and every
frame-level assertion in packages/dashi/tests/profile-pty.spec.ts and
the other PTY specs; for each, either scope it to the region it means
(composer, transcript, picker, status line) using the parsed frame,
or precede it by a wait for the positive state that proves the repaint
happened; no sleeps, no raw escapes, no widened or removed assertions;
list every changed assertion with its reason in the handoff. Evidence:
the full suite 3/3 green on all three DSH legs and macOS on the same
head, and each changed case 20/20 under load. Production source 0.
Accepted 2026-09-21 (PR #212, squash 48d4467). Test-only: one
parsed-frame helper (header, transcript, overlay, composer,
attachments, status regions) and 27 whole-frame or premature
expectations rewritten as region-scoped assertions that follow an
observed positive state; the exit-arm case's fixed 2500 ms sleep
replaced by a wait on the status region; negatives 62 before and after,
expects 315 to 316, none removed, no raw escapes, production source 0.
Evidence: run 35552192096 green on rc.2, alpha.1, alpha.2 and macOS in
three attempts on head 378bddb; eight changed cases 20/20 under a
concurrent full gate. Verifier: independent seven-point review.

### W-097 Release 0.1.0 — status: accepted 2026-09-21 (PR #215 squash-merged; released as 0.1.0)
Per D-044. Branch release/0.1.0 from develop 41f86a9. Changes: the
four package.json versions to 0.1.0 (dashi, dashi-app, dashi-launcher,
file-uploads-none; internal ranges stay workspace ranges); CHANGELOG
entry `## 0.1.0 — 2026-09-21` stating: first stable release, same
production source as 0.1.0-alpha.21, W-096 test hardening, DSH floor
0.1.5-rc.2 with the tested matrix, alpha.19 and alpha.20 deprecated as
empty tarballs; README install text checked so a plain
`@antst/dashi-launcher` install (now `latest`) matches the documented
DSH floor, and one sentence that dashi is stable while DSH is a
prerelease. Explain the three `0.1.0-alpha.18` references in
pnpm-lock.yaml (lines 372, 4329, 7522 on develop): if they resolve an
@antst package from the registry instead of the workspace, fix the
range so the workspace link is used; if they are legitimate, say why
in the handoff and leave them. Nothing else changes; production source
0 lines. PR against develop titled `Release 0.1.0`; all five required
checks green; handoff with the diff summary and the lockfile finding.
After ACCEPT the ops lane squash-merges, fast-forwards main, pushes
tag v0.1.0, and reports run id, dist-tags for all four packages
(latest=0.1.0, alpha unchanged at 0.1.0-alpha.21), fileCounts
55/4/4/5, and the GitHub release prerelease flag false. Then dsh-exec
runs the dsh-host smoke of D-044 ruling (5) with exact 0.1.0 pins and
reports expected vs actual. Acceptance: all of the above observed.
Accepted 2026-09-21 (PR #215, squash 8b40e3d; main and tag v0.1.0 at
the same SHA). Release run 35581614333 success; all four packages at
0.1.0 under `latest` with fileCounts 55/4/4/5, `alpha` unchanged at
0.1.0-alpha.21, GitHub release not prerelease. The ops lane's first
npm query returned 404 about one minute after the publish log line;
the packument carried 0.1.0 at 09:19:27Z, so release verification
re-queries the registry directly for up to four minutes before a
mismatch is declared. dsh-host smoke PASS: exact pins, profile 21/21
at rc.2, anchor rc.2, closure 479 exact, banner `dashi 0.1.0 on DSH
0.1.5-rc.2`, roster row product=dashi seen and gone after a clean
exit; snapshot ~/.local/state/dsh-host-dashi-0.1.0/20260921T092253Z.
Lockfile finding: the three 0.1.0-alpha.18 records are owned by
@sessionbus/dsh 0.1.0-pre.12's exact dependency on
@antst/dsh-file-uploads-none, so a stable host holds two copies and
the shared fallback projection is the alpha.18 one; W-098 removes the
duplicate. Verifiers: haiku seven-point PR review, haiku host check.

### W-098 sessionbus-dsh: one copy of dsh-file-uploads-none on a stable host — status: accepted 2026-09-21 (sessionbus-dsh PR #40 and #41, dashi PR #217; released as plugin 0.1.0-pre.13 and dashi 0.1.1)
Found in the W-097 handoff: @sessionbus/dsh 0.1.0-pre.12 declares
`@antst/dsh-file-uploads-none` as an exact dependency at
0.1.0-alpha.18, so a host with dashi-app 0.1.0 (which pins 0.1.0) and
the plugin carries two copies of the package; on the dsh host after
0.1.0 the profile-root symlink node_modules/@antst/dsh-file-uploads-none
is the alpha.18 copy with 0.1.0 nested under dashi-app, and rows import
relative to the profile root (D-043), so the stable provider is
shadowed by the plugin's copy. Scope: in antst/sessionbus-dsh,
change that dependency to `^0.1.0`, bump the plugin to 0.1.0-pre.13,
changelog line, and re-pin docs/HOST-INSTALL.md to dashi 0.1.0 (launcher,
dashi-app) and plugin pre.13; nothing else; the plugin's lane profile
row and the installer are unchanged. Then dashi-app pins @sessionbus/dsh
0.1.0-pre.13 exact (same shape as W-091) as a fix-only 0.1.1 release
of dashi under D-044 ruling (4). Evidence: plugin gate green; dashi
five checks green; on the dsh host after the 0.1.1 install the dashi
profile's physical inventory shows exactly one
@antst/dsh-file-uploads-none at 0.1.0, `require.resolve` of its
package.json from the profile root reports 0.1.0, and the lane profile
still boots with the sessionbus row (offline registration check of the
runbook).
Production source 0 lines in dashi; one manifest line in the plugin.
Accepted 2026-09-21. Part 1: sessionbus-dsh PR #40 (main f024b49,
released as 0.1.0-pre.13 with `@antst/dsh-file-uploads-none` at
`^0.1.0`, runbook re-pinned). Part 2: dashi PR #217 (squash a920589,
main and tag v0.1.1, run 35587549819; all four packages 0.1.1 under
`latest`, fileCounts 55/4/4/5, alpha unchanged; dashi-app pins
pre.13 exact; the three alpha.18 lock records gone). Correction to the
scope text: the single copy is at 0.1.1, not 0.1.0, because all four
packages move together. dsh-host evidence: dashi profile 0.1.1 exact,
21/21 at rc.2, closure 479 exact, banner `dashi 0.1.1 on DSH
0.1.5-rc.2`, roster row seen and gone; exactly one physical provider
at 0.1.1 after the guarded removal of a stale nested 0.1.0 directory
(D-043 addendum 2026-09-21), with resolution from the profile root and
from dashi-app's real path landing on the same realpath. sessionbus and
web profiles moved from pre.11 to pre.13: 11/11 at rc.2 each, closure
479 exact, one provider 0.1.1, offline provider registration
openai-codex on both, a real lane turn returned `lane hello`, and an
idle web peer in group dsh answered a staged message on its next turn.
Daemon, PRODUCTS and units unchanged. Runbook step for untracked
nested directories: sessionbus-dsh PR #41 (main 2923235).
Verifiers: haiku PR reviews (#40, #217), haiku host end-state check.

### W-099 sessionbus-dsh: the sessionbus skill replaces the list command — status: accepted 2026-09-21 (sessionbus-dsh PR #42 squash-merged, released as 0.1.0-pre.14)
Per D-045 ruling (2). In antst/sessionbus-dsh: delete the `sessionbus`
command (plugin.cjs:375-379) and register a DSH skill with
`ctx.skills.register({ name: "sessionbus", description, content,
invocation })` (dsh-skill lib/types/index.d.ts:80-86,100) so that
`/sessionbus <text>` rides the text as the user's message with the
skill body injected as instructions by DSH core (dsh-skill
index.d.ts:116-129; dsh-tool-skill index.js:168-201, gesture :373).
Content: the canonical guidance adapted to the DSH tool, derived from
the opencode and Claude SKILL.md files installed locally (cite the
source file and plugin version); it keeps self_info, the send field
set including "there is no summary field", the dispositions and their
limits, lane policy independence, ack/done/unavailable/running
discipline, trace, and the envelope reply idiom (copy `from` as the
target). Lengthen the tool description (plugin.cjs:370, 179 chars) to
one paragraph naming the action enum and the skill. Bump to
0.1.0-pre.14, changelog. Evidence: unit tests that the skill registers
with that name and user invocation, that no command named sessionbus
remains, and that the content contains the required sections; packed
install on the three DSH legs; the dashi PTY case is W-101. Production
source in dashi 0.

Accepted 2026-09-21 (sessionbus-dsh PR #42, squash 27d224b; not yet
released, pre.14 is tagged only after W-100 merges). The command is
gone; one runtime skill `sessionbus` (source runtime, model- and
user-invocable, content from skills/sessionbus.md) registers through
dsh-skill's SkillRegistration and is disposed on close; the tool
description names all thirteen actions and the skill; peer
dsh-commands replaced by dsh-skill at the floor. Skill text covers
self_info, the send field set with no summary field, dispositions and
limits, ack discipline, lane policies, trace, and the envelope reply
idiom; the reviewer noted that idiom is not yet true at this commit
because deliver() passes the raw body, which W-100 fixes before the
release. Evidence: unit 61/61, packed rc.2/alpha.1/alpha.2, run
35630154316 green. Verifier: sonnet eight-point review.

### W-100 sessionbus-dsh: a delivered message wakes an idle interactive dashi — status: accepted 2026-09-21 (sessionbus-dsh PR #43 squash-merged, released as 0.1.0-pre.14)
Per D-045 ruling (1); supersedes the W-086 and W-098 readings that an
idle interactive session stages a delivered message until the next human
turn. Found: NativeSession.deliver (plugin.cjs:248-262) calls
`agent.steer(message)` only when `agent.status === "running"`; when idle
it calls `agent.session.append("user/message", ...)`, a log write that
opens no turn, and returns `injected` for both branches; the plugin's
own test "delivery appends while idle and waits for steer receipt while
running" (plugin.test.cjs:658) encodes that. DSH rc.2 Agent (dsh-agent
runtime-types.d.ts:186-209): `steer` "an idle driver starts a turn; a
running driver consumes it at its next step boundary", `followup` always
starts a turn, `inject` never wakes; DSH's own session/prompt RPC uses
steer/followup, never append (dsh-api-session-controller
index.js:736-786). Codex's wrapper calls turn/start when idle and
turn/steer when active; opencode submits a new message when idle; qwen
stages, the same gap. Scope: remove the idle/running branch and call
`agent.steer(message)` for every interactive delivery (the contract's
own verb, one call for both states); settle the receipt from the steer
admission receipt in both states; flip the test above to assert the idle
turn; wrap the body in the shared envelope of D-045 ruling (4) built
from the daemon's delivery fields (from, from-session, fromProduct,
messageId, groups), never from the text, escaping a closing tag inside
the body as the other wrappers do, rendered once (plugin.cjs:161-163
today passes the raw body). Return `injected` when the native API
acknowledges admission, `rejected` on failure before submission or an
observed native refusal, and ProtocolError -32603 with uncertainty data
when submission may have happened without acknowledgment; the callback
returns exactly one result, no extra ack, no trace copies. Serialise
enqueue/wake against active/idle transitions and root disposal (D-045:
no duplicate turns, no delivery to a replacement root, no second
scheduler, no timers). Lanes keep LanePolicy. Bump to the next
pre-release with a changelog line. Evidence: unit tests for idle
interactive (turn starts), running interactive (next boundary), lane
(unchanged), concurrent delivery during an idle→active transition, and
delivery during root disposal (rejected or ProtocolError, never a turn
on the new root); packed install on the three DSH legs; and the live
proof on the dsh host: send from a same-group observer to an idle dashi
and, with no keypress, observe the model turn and the autonomous reply
arriving at the observer over the bus, plus the running-turn case. The
dashi PTY case against a real daemon is W-101's second half. dashi's
rendering of relay messages (W-027, transcript.ts:208-215) is untouched
here; sender visibility in the rendered cell is W-101's finding.
Production source in dashi 0.

Amendment 2026-09-21: pdev reports the daemon's lane `stage` default
(Sept 9, PR 48) was never owner-authorised and is being reversed to
wake; the owner's rule is that a message wakes from the beginning.
Item (a) of W-102 moves here: hello advertises
`supports_message_run` (plugin.cjs:387; kit index.js:56,94 rejects
`idle_message: run` with -32008 without it) and the lane path honours
a daemon message-triggered run exactly like an explicit run (W-087
seed rules, one terminal record, no duplicate turn while a run is in
flight). Unit test: the lane hello carries the flag; a
message-triggered run on an idle lane yields one completed record.
Live proof on the dsh host: spawn sessionbus-dsh with `idle_message:
run`, send while idle, collect the completed record. W-102 keeps
(b)-(e).

Amendment 2 (2026-09-21, pdev rule): lane path only. An ordinary
deliver without run_id that crosses an active→idle boundary checks,
immediately before the native steer and under the lock protecting the
native active turn, whether that turn has ended with nothing admitted;
if so it returns ProtocolError(-32004, NotRunning) and does not steer,
so the daemon keeps the delivery RPC pending and seeds a fresh managed
Run after turn.ready and the run record stays daemon-owned; no
product-local FIFO, no reliance on DSH's post-turn/end new-turn
behaviour for lanes. If the native steer already admitted it, the
truthful receipt is returned, never NotRunning, never replay.
Interactive peers steer directly while idle; no NotRunning, no
reseed. Also found (dsh-exec): DSH rc.2 strands a steer that lands
between the inbox check after turn/end (agent-loop agent.ts:344) and
the idle transition (:232-235) because wakeDriver returns while the
phase is still running (:188-196); no event boundary exists there,
so the plugin adds no workaround; the two observable boundaries are
tested and the gap goes upstream as a report on the owner's go.

Amendment 3 (2026-09-21, corrected): the steer-strand window is
reachable only from a queued promise reaction. turn() reads
inbox.hasPending at agent-loop agent.ts:344, kick() resumes across
`await this.turn()` (:227) and settles idle synchronously at
:232-235; that promise-reaction boundary is the only suspension
point. No public wake-only primitive exists (Agent: cancel,
whenIdle, runMaintenance, send, followup, steer, inject; wakeDriver
private); pending state is observable through agent.inbox; a
re-steer would duplicate the durable splice. The kit invokes the
plugin's deliver callback from a queued microtask (kit index.js:82
queueMicrotask; Peer._handle :254 Promise.resolve().then), so a
synchronous block inside the callback is itself a microtask reaction
and can interleave with DSH's idle transition (pdev). Ruling: the
builder traces the real ordering; if reachable, deliver() defers the
check-and-steer by one macrotask hop (setImmediate, a task boundary,
not a timer or polling) and then runs the lane NotRunning check and
agent.steer as one synchronous block, so DSH's microtasks drain
before the steer; the receipt stays one result from the callback
promise, FIFO order across deferred deliveries holds, and root
disposal between deferral and steer is caught by the synchronous
check. Tests: the strand reproduced without the deferral and absent
with it, FIFO, disposal. No replay. The residual, if any, is
DSH-internal and reported upstream as such.
Accepted 2026-09-21 (sessionbus-dsh PR #43, squash cde945a; not yet
released, pre.14 waits for the published successor kit). Every
interactive delivery is steered; injected is returned only on the
agent/inbox/spliced event correlated by message id and session,
rejected before submission, ProtocolError -32603 with message_id when
admission is lost; admission is deferred exactly one setImmediate hop
then runs as one synchronous check-and-steer, FIFO, with root
liveness checked inside the block; the envelope is byte-identical to
the opencode template and built from daemon fields; hello advertises
supports_message_run and the lane path returns -32004 before steering
when the run has ended with nothing admitted. Evidence: unit 68/68;
packed proof on rc.2, alpha.1, alpha.2 including an ordinary idle
delivery after turn/end (injected, exactly two turn/start, envelope,
autonomous reply, no second prompt) and a strand reproduction against
the installed production AgentLoop (microtask steer stranded at idle;
one hop consumed in turn 2); run 35641343549 green; private proof on
pdev's 0074 daemon (SOURCE 0074469, packet root 84f5a8ae, binary sha
55a6691d): lane with no idle_message ran on an idle send, legacy
stage record resumed as run, an idle dashi answered two observer
messages autonomously. Recorded limits: D1 published kit 0.5.5 folds
every ProtocolError except -32603 into a rejected receipt (kit
index.js:179-182), so -32004 is observable only on the successor kit;
D2 CI never passes candidate_kit (ci.yml:38, release.yml:38), so the
-32004 wire evidence exists only in the manual candidate run until
the re-pin PR makes the boundary steps unconditional; D5 the
admission wait is bounded only by the caller's cancel signal, a
deliberate dependency on daemon cancellation, not a timer. Verifiers:
opus contract review of 2e7da64, sonnet delta review of 2fecabd.

### W-101 dashi: PTY gates for the sessionbus integration — status: accepted 2026-09-22 (PR #231 squash-merged; released as 0.1.2)
Per D-045 ruling (3). dashi-app pins the plugin release that carries
W-099 and W-100 (exact, same shape as W-091), version 0.1.2, changelog.
New PTY fixture: a real sessionbus daemon started per test on a
private socket (SESSIONBUS_SOCKET) with dashi registered as its only
product, the shipped profile, the recorded model, and a kit observer in
the same group. Cases: (a) type `/sessionbus reply with exactly: slash
ok`; observe the skill-invocation context cell and a model turn whose
output contains `slash ok`; (b) with dashi idle, the observer sends
`reply over the bus with exactly: pong`; with no keypress observe the
delivered cell showing the observer's name from the envelope, a model
turn, and `pong` arriving at the observer; (c) during a running turn
the observer sends a message; observe it consumed at a step boundary
and answered; (d) the user's own prior text and a peer message are
visually distinct (sender line present on the peer cell only).
Waits are on observed state, no sleeps, no raw escapes; the daemon
binary path comes from the environment with the case skipped only by
an explicit CI marker that fails the gate on the DSH legs where the
daemon is provisioned (state how it is provisioned in the handoff).
Evidence: 3/3 green on all three DSH legs and macOS, each new case
20/20 under load. Production source 0 unless the sender line needs a
render change, in which case it is one transcript rule stated in the
handoff.

Accepted 2026-09-21 (PR #231, squash 608c30f; released as 0.1.2, main
and tag v0.1.2 at the same SHA, run 35670745586). dashi-app pins
@sessionbus/dsh 0.1.0-pre.14 exact; the test harness pins
@sessionbus/kit 0.5.7 exact; lockfile moves pre.13→pre.14, kit
0.5.5→0.5.7 and the plugin's peer edge dsh-commands→dsh-skill, nothing
else. scripts/provision-sessionbus.mjs downloads the v0.5.7 release
archive per platform, verifies it against the published SHA256SUMS and a
pinned checksum, and fails the gate on any failure; CI, release
verification and the version-gate container all require it.
sessionbus-harness.ts runs a private v0.5.7 daemon per test with dashi
as the only product and a kit 0.5.7 observer in the same group.
profile-pty.spec.ts proves the four cases: `/sessionbus <text>` renders
the skill invocation and the model turn carries the text; an idle dashi
answers an observer's message with no keypress and the reply reaches the
observer; a message during a running turn is consumed at the next step
boundary; human input and the sender envelope render as distinct cells.
The old "at most one sessionbus line" assertion was replaced by a
positive check that every diagnostic for an absent private socket is
connect ENOENT, because W-102 made presence retry. Production source 0.
Evidence: gate 26 files / 300 tests, five changed cases 20/20 under
load, run 35666991525 green on rc.2, alpha.1, alpha.2 and macOS in three
attempts; the first head's review sent back two under-asserting cases
(composer echo satisfying the slash wait; running-turn injection
unasserted), fixed at 6104009 with a durable assistant event and a
step-indexed user/message inside turn 1. Verifiers: opus nine-point
review of 4fcfcb0, sonnet delta review of 6104009. The dsh host's dashi
profile then moves to 0.1.2 and the owner's two commands from the
morning are the final acceptance.

Host note 2026-09-22 (dsh host, dsh-exec): dashi profile at
dashi-app 0.1.2 and launcher 0.1.2 exact, one copy each of
@sessionbus/dsh 0.1.0-pre.14, kit 0.5.7 and dsh-file-uploads-none
0.1.2, DSH 21/21 at rc.2, closure 479 exact, banner `dashi 0.1.2 on
DSH 0.1.5-rc.2`. Human-visible acceptance on the permanent v0.5.7
daemon with a native launch in group dsh: a typed `/sessionbus ...
slash ok` produced the skill invocation, a model turn and an injected
bus send that reached the observer; a request sent to the idle dashi
by pdev's controller produced an unprompted turn, the rendered sender
envelope and an injected reply that reached the observer with no PTY
input; clean exit. Two detours on the way, both recorded: the first
profile add hit registry tarball lag on dashi-0.1.2.tgz (404 for
about six minutes after publish), recovered by a byte-for-byte
manifest and lock restore, one frozen relink, one no-op frozen
install and a graph recheck before the retry; and the architect's
brief named the controller as the receiving observer although it
rejects deliveries by design (controller_not_a_model), so the receiver
became the builder's persistent codex session. Both are runbook rules
under W-104. Packet
/home/antst/sessionbus-evidence/dsh-host-dashi-012-acceptance-20260922,
SHA256(SHA256SUMS) 90ae5f59, 15 members, re-verified by the architect.
umka follows at dev1's pace after its daemon upgrade.
### W-102 sessionbus-dsh: parity remainder from the audit — status: accepted 2026-09-21 (sessionbus-dsh PR #44 squash-merged, released as 0.1.0-pre.14)
Per D-045 ruling (5), the audit items not covered by W-099 to W-101:
(a) advertise `supports_message_run` in hello so `idle_message: run`
lanes are accepted (kit index.js:94 rejects with -32008 today; plugin
hello at plugin.cjs:387) and honour it in the lane path; (b) presence
retry: a failed connect at start deletes the peer and never retries
(plugin.cjs:300-310); use the kit's reconnect path so the session
publishes once the daemon is reachable, with one line per failure;
(c) `open.arguments` accepted by the schema (plugin.cjs:21) but not
passed to the product; pass it or reject it, not ignore it; (d) the
default tool grant (plugin.cjs:365-366) is an unconditional allow;
narrow it to the `sessionbus` tool only if it is not already, and
document that native policy still applies; (e) trace envelopes: once
W-100 lands, prove a `trace: content` copy delivered to a dashi parent
wakes it and renders with its envelope. One PR, one pre-release,
changelog per item, unit tests per item, packed legs. Evidence on the
dsh host: a lane spawned with `idle_message: run` accepts a message
while idle and runs; dashi started with the daemon stopped publishes
within one reconnect after the daemon starts.
Accepted 2026-09-21 (sessionbus-dsh PR #44, squash 6185ff0; ships in
the unreleased 0.1.0-pre.14 with W-099 and W-100). (b) A failed
socket attempt at start logs one line and leaves the peer record and
the kit's reconnect loop in control (kit index.js:200-213, 239-249);
unit proof observes two failures then admission on the next attempt;
the packed web proof starts DSH before the daemon and publishes on
the first reconnect on all three legs. (c) A non-empty open.arguments
is rejected before any DSH call; never ignored. (d) The pre-execute
grant allows only the sessionbus tool and delegates every other tool;
README states native policy still applies. (e) A daemon-shaped trace
copy delivered to an idle dashi is steered with the ordinary envelope
and answered autonomously on rc.2, alpha.1, alpha.2. Manifest pre.14,
kit 0.5.5 by ruling. Evidence: unit 70/70, peer floor, packed legs,
run 35644397701 green. Verifier: sonnet eight-point review.

### W-103 sessionbus-dsh: pin the successor kit and make the lane boundary proof unconditional — status: accepted 2026-09-21 (sessionbus-dsh PR #45 squash-merged; released as 0.1.0-pre.14)
Per W-100 limits D1 and D2. The published kit 0.5.5 folds every
ProtocolError except -32603 into a rejected receipt, so the lane
NotRunning rule (-32004) is invisible at the wire, and CI never passes
the candidate kit, so the boundary steps never run there. Scope, on
pdev's registry binding (exact version and integrity): package.json
pins @sessionbus/kit at that version exactly, lockfile updated, the
installed manifest and the registry integrity stated in the handoff;
ci.yml and release.yml drop the candidate_kit parameter and
prove-packed-install.sh runs the -32004 boundary steps
unconditionally with the pinned kit; the lane ended-run unit test
asserts -32004 reaches the kit reply as an RPC error, not a rejected
disposition; one changelog line under the unreleased pre.14 entry.
Evidence: unit, peer floor, packed legs, hosted run green. After
ACCEPT the ops lane tags v0.1.0-pre.14 (trusted publish) and verifies
on the registry: version present, dependencies kit == the pinned
version and dsh-file-uploads-none ^0.1.0. Then the dsh-host installed
acceptance on the permanent daemon after pdev's rollout: sessionbus
and web profiles at pre.14 exact, a native dashi launch, an observer
message answered with no keypress, `/sessionbus <text>` producing a
model turn; umka at dev1's pace. W-101 follows on dashi.
Accepted 2026-09-21 (sessionbus-dsh PR #45, squash df6f73b;
released as 0.1.0-pre.14 with W-099, W-100 and W-102). @sessionbus/kit
pinned exactly 0.5.7 (pdev root-verified: sha1 95360370, tarball
sha256 3bb208a1, source tag 53c5f80; lockfile integrity equals the
registry sha512); the candidate_kit override is gone and the packed
proof runs the lane boundary steps unconditionally on rc.2, alpha.1,
alpha.2; a serveWorker wire test shows the cut: kit 0.5.5 answered
{disposition: rejected, reason: not_running}, kit 0.5.7 answers
JSON-RPC error -32004. Evidence: unit 71/71, peer floor, packed legs,
hosted run 35648568129 green. Release: tag v0.1.0-pre.14, run 35649085157,
registry version present with dependencies kit 0.5.7 and
dsh-file-uploads-none ^0.1.0. Verifier: sonnet review.

### W-104 sessionbus-dsh: runbook re-pin to dashi 0.1.2 and plugin pre.14 — status: accepted 2026-09-22 (sessionbus-dsh PR #46 squash-merged, docs only)
docs/HOST-INSTALL.md (sessionbus-dsh main) still pins dashi 0.1.0
and plugin 0.1.0-pre.13 with kit 0.5.5 and daemon v0.5.5. Update the
active pins to dashi-launcher 0.1.2, dashi-app 0.1.2, @sessionbus/dsh
0.1.0-pre.14, kit 0.5.7, daemon v0.5.7 (release 53c5f80), and add
the two facts learned on 2026-09-21: the lane and interactive wake
contract (a message delivered to an idle session starts a turn; the
`/sessionbus <text>` skill), and the originating-caller requirement
(spawns must come from a caller on SDK 0.5.7 or later; an older
closed-schema SDK surfaces -32002 not_connected after Open commits).
Keep the installed-acceptance steps aligned with what was actually
run on the dsh host (controller-issued lane and web cells, native
dashi launch for the two human-visible checks). Docs only; grep for
stale `0.1.0`, `pre.13`, `0.5.5`, `alpha.21` literals must return
nothing outside the changelog-style history section. PR against
main, gate green, handoff.

Accepted 2026-09-22 (sessionbus-dsh PR #46, squash 018a493; docs
only). Active pins are dashi 0.1.2 (launcher, app, dashi,
file-uploads-none), plugin 0.1.0-pre.14, kit 0.5.7, daemon v0.5.7 at
53c5f80; the four-tarball HEAD-until-200 gate and the failed-add
recovery sequence are written down; the wake contract and the
`/sessionbus <text>` skill are described; the originating-caller
requirement (SDK 0.5.7+, persistent identity, the -32002 symptom of
an older closed-schema caller) is stated; lane, web and dashi
acceptance steps match what was run on the dsh host with a long-lived
controller, never the one-shot client. Stale-literal audit empty
outside the labelled history paragraph. Gate: unit 71/71, packed
legs, peer floor, run 35674637293 green. Verifier: haiku six-point
review.

### W-105 dashi and sessionbus-dsh: repository references follow the organisation move — status: open (owner dsh-exec, after the trusted publisher is rebound)
Per the D-045 repository-move note. dashi (develop): the daemon
download base in scripts/provision-sessionbus.mjs and any workflow or
README reference to github.com/antst/sessionbus point at
github.com/sessionbus/sessionbus; pinned checksums unchanged; the
gate must pass without relying on the redirect (verify with the
new URL only). sessionbus-dsh (main): README, docs/HOST-INSTALL.md
and package.json repository/bugs/homepage fields point at
github.com/sessionbus/sessionbus-dsh and the daemon release at
github.com/sessionbus/sessionbus; no version bump in the plugin (docs
and metadata only) unless the owner tags a release afterwards. One
PR per repository; gates green; handoffs. Evidence: grep for
`github.com/antst/sessionbus` returns nothing in either repository
outside labelled history text.

### W-106 PTY: the resized inline decision case reads the frame before the overlay repaint — status: open (owner dsh-exec, W-096 family)
Seen on the W-105 dashi PR (macos-gate, head db4e586): the case
"keeps a resized decision answerable in inline mode"
(profile-pty.spec.ts:1901) found transcript in the frame after the
resize where the approval overlay was expected; the diff under test
was a one-line URL change that cannot reach that path, so this is the
W-096 assertion family again: a frame read after a resize without a
wait for the positive state that proves the repaint. Scope: after the
resize, wait for the overlay's own marker in the parsed overlay
region before asserting the decision is answerable; scope the
assertion to that region; no sleeps, no raw escapes, no widened or
removed assertions; then audit the other resize-then-assert cases in
the PTY specs for the same shape and fix them in the same PR, listing
each changed assertion with its reason. Evidence: the saved failing
frame and job log from the W-105 run attached to the handoff; the
changed cases 20/20 under load; 3/3 green on the three DSH legs and
macOS on the same head. Production source 0.
## Backlog

### B-003 Remaining doable parity rows — status: backlog
From PARITY.md, to be cut into work items in this order (W-042, W-043,
W-047..W-052 cut 2026-09-04): none left. Remaining parity rows are
DSH gaps; see PARITY.md and the upstream report queue.

### B-001 Workspace restore plugin (Claude Code style file rewind) — status: closed 2026-09-04, satisfied by @antst/roller 0.1.2 (bundled in dashi-app since D-033; rewind offers conversation, code, or both since D-032)
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
- Queued (not yet posted): DSH Discussion (Ideas): session-scoped model/effort selection. rc.1 selectModel always calls agentDefaultModel.saveSelection (packages/api/session-controller/src/commands.ts:119-145) and neither SessionCreateRequest, resolveAgent, nor AgentPreset carries a model or effort, so a launch flag like `--model` cannot avoid moving the deployment default (W-025). Release to the lane with the install-hazards report.
- Queued (not yet posted): DSH Discussion: cold session list never shows a title for a seeded (forked) session whose inherited log exceeds coldBlankProbeMaxBytes; ApiSessionList refuses projection-cache rows for cold seeded sessions (packages/api/session-controller/src/list.ts:327-336) and probes the log only under the size bound (list.ts:164-205), so a durable session/title event is ignored in the picker until the session is opened (W-051). Suggest honoring a projection-cache title row, or probing the tail of the log for the latest title event.
- Queued (not yet posted): DSH Discussion: @deepseek-ai/dsh-mcp-client spawns stdio MCP servers with stderr inherited (transport.ts:31-39 passes no stderr option; the MCP SDK defaults to 'inherit', stdio.js:48-75), so server logs write straight to the host terminal and corrupt any TUI frame; suggest piping stderr into DSH's logger or a diagnostics channel. Nearest existing thread: Discussion 4465 (silent stdio spawn failures); related 1241, 5129; third-party reproduction ccch1mneyyy/dsh-TUI issue 17 (W-057).
- Queued (not yet posted): DSH Discussion: `dsh plugin add` of a plugin package without a bundle manifest installs it and warns, but composes no loader row, so it never loads; suggest adding an insert row to the profile patch (or a `dsh plugin enable <pkg>` verb) and making the warning say what is missing (apps/cli/src/plugin.ts:59-91) (W-061).
- Queued (not yet posted): DSH Discussion: live patch reload (patchReload: live) applies cordis.patch.yml edits at runtime but not dsh.profile.bundles additions, and nothing documents the asymmetry; suggest either reloading bundle layers live or stating the restart requirement in the profile docs (apps/cli/src/profile-boot.ts:279-286, packages/boot/app-boot/src/index.ts:236-267) (W-061).
- Queued (not yet posted): DSH Discussion: with `pnpm install -g @deepseek-ai/dsh@0.1.2-rc.1` under pnpm 11 on macOS, every profile fails to boot, including DSH's own `dsh --profile web`, with missing @deepseek-ai/dsh-llm (and others). Cause: healProfilesModuleFallback (packages/boot/app-boot/src/profile.ts:578-592) walks the CLI's dependency closure with require.resolve.paths from the CLI package's own location, but pnpm 11's global layout keeps the CLI package under store/v11/links with its dependencies hoisted into the global instance's .pnpm/node_modules, which that walk does not reach; the healed $DSH_HOME/profiles/node_modules ends up with 68 of the packages and no dsh-llm. Reproduced 2026-09-04 on macOS 27 arm64, pnpm 11.7. Suggest resolving the closure from the pnpm virtual-store instance (the realpath's .pnpm/node_modules sibling) or documenting that global pnpm installs are unsupported and npx/local installs are the path.
- Queued (not yet posted): DSH Discussion: session-only model selection, restated for the Agent Sessions lane case: SessionSelectModelRequest carries sessionId but selectModel always calls agentDefaultModel.saveSelection (packages/api/session-controller/src/commands.ts:119-145), so a headless lane opened with a model moves the deployment default for every later session in that DSH home (D-039; duplicates the W-025 entry's ask with the second motivating case).
- Queued (not yet posted): DSH Discussion (Ideas): ctx.launchEnvironment (packages/util/launch-environment/src/index.ts) is an immutable snapshot, so a plugin that consumes a one-time secret from the environment (the agentbus launch token) cannot remove it and it stays readable to every plugin for the process lifetime; suggest a take-once accessor (read and delete) on the snapshot. Raised by the agentbus plugin work 2026-09-06.
- Queued (not yet posted), HIGH: DSH Discussion (Bug): in @deepseek-ai/dsh-agent-loop 0.1.2-rc.1 a turn cancelled while the LLM fetch is still awaiting response headers (the ordinary "cancel during time-to-first-token" case) never gets its turn/end. ReactLoopAgent.turn() logs `{kind:'aborted', reason: signal.reason}` (packages/core/agent-loop/src/agent.ts:313, appended at :328); signal.reason is the caller's cancel-cause object, which every fetch-based adapter hands to fetch via AbortSignal.any (packages/llm/llm-deepseek/src/adapter.ts:473-476,643-648); Node/undici installs a non-enumerable `stack` accessor on that object when a pre-header fetch is aborted, Session.append rejects it as non-serializable (dsh-session lib/index.js:1409 via dsh-util-values enumerableStringKeys), the append throws inside the finally and is rerouted to agent/error, and the log keeps step/end as its last event with the turn open forever; mid-body aborts are unaffected. Adapter and loop otherwise honor the abort (adapter settles in 3 ms). Reproduced 2026-09-06 on rc.1 with Node 25.9 against a local endpoint that accepts the socket and never sends headers; invisible to DSH's own tests because the replay provider never calls fetch. Suggested fix: log a detached snapshot of the cause (captured in cancel()) or rebuild the closed AgentCancelCause union at :313, never the object handed to platform code. Consumers folding turn/start..turn/end (dashi, sessionQuery) show the turn running indefinitely. Found via sessionbus lane cells 6 and 8.
- Queued (not yet posted): DSH Discussion (Bug): since 0.1.5-rc.2, @deepseek-ai/dsh-api-session-controller hard-injects `fileUploads` (src/index.ts:92; calls at :125-129, commands.ts:351,362,477), a service provided only by the web client plugin @deepseek-ai/dsh-client-file-upload (which itself needs `connection`), so any non-web composition that mounts the session controller (a TUI, a headless controller) cannot activate; DSH's own non-web bundles avoid it only by not mounting session-controller at all. Suggest making fileUploads optional (ctx.get with null-safe bindPrompt/retirePrompt/resolve paths) or splitting a fileUploads service definition with a no-op default. Found 2026-09-18 (W-074).
- Queued (not yet posted): DSH Discussion (Bug): since 0.1.5-rc.2, SessionController.fork of a RUNNING source (atSeq at the last completed turn/end) advances the cut to the next turn/start and so seeds the child with the agent/inbox/spliced item of the in-progress prompt (packages/api/session-controller/src/commands.ts:227-245); the child Agent is published and wakes on that item before fork returns, so the caller cannot clear it (cancel after resolveAgent is too late). A side-question fork therefore answers the source's open prompt too. Suggest a fork option to exclude post-boundary inbox splices, or excluding them when the source is running. Found 2026-09-18 (W-070); dashi now refuses /btw while a turn runs.
- Queued (not yet posted), HIGH: DSH Discussion (Bug): cold resume of a large session regressed from ~2.3 s (0.1.2-rc.1) to over 120 s (0.1.5-rc.2) for a 200k-event log, stalling before the first UI frame inside agent-loop session open (packages/core/agent-loop/src/index.ts:878-899: whole-log V3 read-validate plus interruptedTurnClosers). Scaling numbers, profile, and the 0.1.6-alpha.2 result to be attached (W-070).
- Update 2026-09-19 to the cold-resume entry above: localized by the rc.2 50k CPU profile to @deepseek-ai/dsh-token-meter, packages/llm/token-meter/src/breakdown-projection.ts:56-75 (`contextBreakdownProjectionDefinition.apply` / `commitSurfaceTokens` clones state.nodes and findLast-scans it per surface event), not the agent-loop open path; introduced by upstream commit 6525195953 ("fix(token-meter): classify surviving prompts in surface order", 2026-09-07), still live at HEAD. Timings on the same fixture: rc.2 10k 1,629 ms, 50k 11,879 ms, 100k 47,246 ms, 200k 183,088 ms; 0.1.6-alpha.2 50k 11,764 ms, 200k 183,216 ms; rc.1 200k 2.3 s. Related but distinct: Discussions #928 and #4416 (fixed by 0c5aa8110f, already in rc.1). Upstream has issues disabled; post as a Discussion (Bug). No existing report found.
- Posted 2026-09-19 (draft 13): DSH Discussion (General): Token-meter projection makes cold resume quadratic in session event count https://github.com/deepseek-ai/deepseek-harness/discussions/7171
- Posted 2026-09-19 (draft 10): DSH Discussion (General): turn/end is lost when a pre-header LLM request is cancelled https://github.com/deepseek-ai/deepseek-harness/discussions/7172
- Posted 2026-09-19 (draft 11): DSH Discussion (General): Session controller cannot activate without the web-only fileUploads service https://github.com/deepseek-ai/deepseek-harness/discussions/7174
- Posted 2026-09-19 (draft 12): DSH Discussion (General): Forking a running session replays its pending prompt in the child https://github.com/deepseek-ai/deepseek-harness/discussions/7175
- Posted 2026-09-19 (draft 01): DSH Discussion (General): Two install hazards: mixed prerelease graphs and stale peer dependencies https://github.com/deepseek-ai/deepseek-harness/discussions/7177
- Posted 2026-09-19 (draft 02): DSH Discussion (Ideas): Session-scoped model and effort selection https://github.com/deepseek-ai/deepseek-harness/discussions/7179
- Posted 2026-09-19 (draft 03): DSH Discussion (General): Cold seeded sessions lose their title in the session list https://github.com/deepseek-ai/deepseek-harness/discussions/7180
- Posted 2026-09-19 (draft 04): DSH Discussion (General): Stdio MCP server stderr inherits the host terminal https://github.com/deepseek-ai/deepseek-harness/discussions/7182
- Posted 2026-09-19 (draft 05): DSH Discussion (General): Plain plugin packages installed by dsh plugin add never load https://github.com/deepseek-ai/deepseek-harness/discussions/7183
- Posted 2026-09-19 (draft 06): DSH Discussion (General): Live patch reload excludes bundle additions https://github.com/deepseek-ai/deepseek-harness/discussions/7184
- Posted 2026-09-19 (draft 07): DSH Discussion (General): pnpm global installs produce profiles with missing DSH packages https://github.com/deepseek-ai/deepseek-harness/discussions/7185
- Posted 2026-09-19 (draft 08): DSH Discussion (General): Session-only model selection for Agent Sessions lanes https://github.com/deepseek-ai/deepseek-harness/discussions/7186
- Posted 2026-09-19 (draft 09): DSH Discussion (Ideas): Take-once access for launchEnvironment secrets https://github.com/deepseek-ai/deepseek-harness/discussions/7187
