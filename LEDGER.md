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

Amendment 2026-10-10 (DSH 0.2): the physical fallback heal is gone.
dsh-app-boot 0.2.1-alpha.2 builds an immutable in-memory runtime
resolution (lib/index.js:748-784, installed before profile mounts at
the CLI's profile-boot :271-275; README:67,137-144 states runtime
resolution creates no fallback links); only the legacy per-profile
module-fallback cleanup remains (:615-631). Found on the dsh host
after the first proper DSH 0.2.1-alpha.2 install: `dsh --profile
headless --help` left the shared $DSH_HOME/profiles/node_modules at
its rc.2 links (closure expected 578, current 380) because nothing
heals it any more. Ruling for DSH 0.2 hosts: the host assertion is
(a) the lockfile uniform at the target and the executing anchor at
the target, (b) exactly one version per cordis companion at the
executing CLI's minima, and (c) a runtime-resolution assertion: boot
the profile by its ordinary launch and query ctx.pluginPackages.
packageOf for dsh-base, cordis and the companions, asserting they
resolve to the new installation's manifests and versions. The old
shared physical links are reported as legacy extras, never asserted
and never hand-linked; DSH's own legacy cleanup is the only cleanup.
The physical one-version assertion for profiles (nested directories,
2026-09-21 addendum) still applies to the profile trees themselves.
Runbook change in the W-115 successor PR.

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

### D-046 (2026-10-10) Plugin repository writes outside the ledger are recorded, and announced from now on
Found on 2026-10-10 while checking state with pdev: four merges
landed on sessionbus/sessionbus-dsh between 2026-09-29 and 2026-10-07
without passing this ledger: PR #51 "Follow the removal of the
unreleased idle_message policy field" (d36a9e3) and PR #52 "release
0.1.0-pre.15" on kit 0.5.9 (5d82dcb), both 2026-09-29; PR #53 "docs:
require consequence analysis, KISS and RCA for every change"
(c448175, 2026-09-30), which added a root AGENTS.md carrying the
owner's verbatim rule of 2026-09-30 ("ANY change require extensive
analysis of edge cases and consequences ... record also in AGENTS.md
in ALL repos. Also add to it KISS, RCA etc."); and PR #54 "Prepare
pre.16 with kit 0.5.12 interrupt and peer fixes" (e37fb8b, 2026-10-07)
released as 0.1.0-pre.16 under dist-tag `pre`. All four were merged
by pdev's root/astra operations through the owner's GitHub
credentials on pdev, with merge commits rather than squashes; #53 and
#54 carry retained owner authority on pdev
(owner-rules-root-20260930/CHANGE-ANALYSIS.md;
dsh-pre16-root-20261007/AUTHORITY.md, owner selection "pre.16 on kit
0.5.12, then Dashi pin"); #51 and #52 are attributed by pdev to the
owner's release-alignment rule with no verbatim approval recovered,
and are recorded here exactly so. Rulings: (1) The plugin repository's
root AGENTS.md is the owner's standing instruction and binds every
change there (analysis of edge cases and consequences before the
change, KISS, root-cause analysis, preservation and proof, one
coordinated writer, bot review read in full at the reviewed head,
merge pinned to that head); this ledger's handoff protocol continues
to apply on top of it; the same owner rule is added to dashi's
AGENTS.md by W-112. (2) Any write to sessionbus/sessionbus-dsh by a
party other than this ledger's lanes is announced to the architect
before merge and recorded here the same day; the architect does not
re-review pdev's work, only records provenance. (3) The owner's word
for a dashi release is taken in the owner's own window with the
architect; a relayed authorization is recorded as a relay and
confirmed directly before any release. (4) pre.15 and pre.16 are the
current published plugin line; dashi's pin moves to pre.16 under
W-110 on the owner's direct confirmation; the W-101 PTY gate's daemon
moves to the sessionbus release whose kit the plugin pins.

### D-047 (2026-10-10) dashi 0.2 follows DSH 0.2; one DSH line per dashi line
W-111 step 1 (report /tmp/w111-eval-aCawKJzz/REPORT.md, scratch only)
showed that DSH 0.2.0-rc.2 and 0.2.1-alpha.2 install as uniform
graphs once our stale references are adapted, that roller passes with
test-only changes, and that dashi and the plugin need code changes
whose causes are all ours: the agent-presets package is published
singular (dsh-agent-preset, registry list/resolve/readDocument only;
AgentPreset.path and registry copy/remove are gone); ShellExecutor.run
became resolve then execute; the jobs surface (SessionJob, jobs
frames, SubagentRuntime.remoteExportList, JobRead.text/snapshot) was
removed and controller calls take a SessionId; startContinuable is
gone on alpha.2 with the session/wait change; session format v4
requires a producer-owned source kind (the union includes tool, user,
model, system-prompt, model-selection, user-approval,
skill-invocation, ptc-mode, tool-registry, compact-checkpoint,
plan-mode, agent-message, subagent-settled, user-question-reply,
agent-instructions) and retires source.kind "plugin", which dashi's
shell notice and the plugin's relay message use; the content block
kind tool-result and ContentBlock.content/isError are gone; the
cordis family moved to ~ ranges (4.0.4 on 0.2.0, 4.0.5-alpha.1 on
0.2.1); the model id deepseek-v4-flash is gone. No new DSH defect was
proved; #7172 is fixed upstream; the fileUploads injection and the
steer strand persist. Rulings: (1) Under D-030 the next dashi line
targets the newest DSH: the 0.2 line of dashi (0.2.0-alpha.1 per
D-044) sets the floor to `>=0.2.0-rc.2` and the tested matrix to
0.2.0-rc.2 and 0.2.1-alpha.2, extended as DSH publishes; the 0.1
line of dashi stays on the 0.1.5-rc.2 floor for fixes only. No shim
supports two DSH API generations in one dashi; one DSH line per
dashi line. (2) Source kinds come from the v4 union, chosen by the
builder with the schema and DSH's own producers as evidence and
stated in the handoff before code; the plugin's relay message keeps
its sender envelope and rendering (D-045) under the chosen kind;
recorded v3 fixtures are migrated with DSH's own v3-to-v4 migration,
never hand-edited. (3) Where DSH removed a capability dashi exposed
(preset copy and remove; the jobs list; the tool-result block), dashi
follows DSH's replacement when one exists and otherwise removes the
exposure and names the gap in this ledger; DSH owns durable facts, so
dashi does not reimplement file operations or job tracking. (4) The
cordis family is declared as a floor at the version the DSH floor
resolves (D-041 form), and every harness derives its cordis pins from
the tested CLI (the W-109 helper); no hard-coded cordis pins remain
in any proof script. (5) The plugin follows on its own version
(pre.17) with the v4 source kind and the derived pins; roller drops
the unavailable dev dependency and provides the working-directory
fixture, production unchanged. (6) Work proceeds design-first under
D-046: W-114 opens with a handoff that maps every error group to its
chosen replacement with file:line evidence, reviewed before code;
items W-114 to W-117. The owner's two asks are answered by this
line: what was solved is recorded in W-111; whether the profile and
plugins work is proven by the gates and the host acceptance on the
new floor.

Amendment 2026-10-10 (W-114 design review): (a) the dashi 0.2 floor
is `>=0.2.1-alpha.2` and the tested matrix is 0.2.1-alpha.2 plus
newer as published; 0.2.0-rc.2 is dropped because its schedule tools
live in dsh-schedule while alpha.2 moved them to dsh-tool-schedule,
which has no rc.2 release, so one composition cannot serve both and
a conditional row would be a shim; under D-048 the newest DSH is the
target. (b) Ruling (2) reads: source kinds are producer-owned per
the v4 contract; a kind declared through dsh-llm's merge-extensible
MessageSourceMap, as DSH's own schedule, compaction and subagent
producers do, is producer-owned, and the kinds are those DSH's own
v3-to-v4 migration assigns (`plugin:dashi` for dashi's shell notice,
`plugin:sessionbus-dsh` for the plugin's relay message). (c) Presets:
dashi-app keeps dsh-base's host agent rows (DSH states base keeps
them for the TUI) and declares one `standard` preset with no plugins
of its own through the native registry; nothing is copied; custom
presets can add tools but not remove host-level ones; preset
authoring inside dashi (new, copy, delete) and the web-only presets
are named DSH gaps with an upstream report on package-relative
bundle patches. (d) Recorded v3 fixtures are migrated with
dsh-session-format-catalog's own catalog, an exact dev dependency.
(e) The cordis family floors follow the alpha.2 CLI (cordis
>=4.0.5-alpha.1, loader >=1.0.6-alpha.1, include >=1.0.10-alpha.1,
timer >=1.1.7-alpha.1, schemastery >=3.18.5-alpha.1); pnpm admits
prerelease floors. (f) The plugin's pre.17 (W-115) takes the same
floor and the `plugin:sessionbus-dsh` kind.

Amendment 2 (2026-10-10, phase 1b review): ruling (c)'s "no plugins
of its own" would have dropped, on alpha.2, the persona prefix (dsh-base
sets it empty; dsh-headless restates it), dsh-tool-ask-user (dashi's
question UI), dsh-tool-present, dsh-tool-ralph, time-context and
subagent model selection, which dsh-tool-subagent allows only inside a
preset scope. Corrected: dashi's `standard` preset is dashi's own
terminal composition and declares exactly the rows the completeness
bar needs that dsh-base's host rows do not supply: the persona prefix
in dashi's words, the ask-user, present and ralph tools, time-context,
and the subagent tool row in preset scope with model selection on;
each row carries its reason in the handoff; rows base already
supplies stay host-level; dsh-tool-schedule stays host-level and the
record names that child agents see and are refused those tools. This
is declared need, not a copy of the web preset; the gap list keeps
preset authoring inside dashi.

### D-048 (2026-10-10) The DSH 0.1.5 line is closed; everyone moves to the newest DSH as soon as possible
Owner, 2026-10-10: "no point to waste token releasing dashi and
sessionbus for 0.1.5, nobody uses it anymore" and "this is AI world!
everyone move to newer one ASAP". Rulings: (1) dashi 0.1.3 (plugin
pre.16, kit 0.5.12) is the last release of the 0.1 line; no further
0.1.x release, no host acceptance packet for it (the dsh host keeps
its 0.1.3 install until 0.2 lands; the W-110 acceptance was stopped
mid-run, see W-110), no umka install of it. (2) The plugin's next
release, pre.17 (W-115), drops the DSH 0.1.5 legs and moves its peer
floor to `>=0.2.0-rc.2` with the v4 source kind; no dual-format
support. (3) W-113 is cancelled; the runbook re-pin folds into
pre.17's runbook update. (4) D-030 is restated as the owner's
standing rule: the newest published DSH is the target the moment it
appears; evaluation (as in W-111) decides how, never whether. (5) The
dashi 0.2 migration (W-114) is the lead item; the host and umka move
to dashi 0.2 with plugin pre.17 when it is accepted.

### D-049 (2026-10-10) The real host is the test bed; no scratch installs stand in for it
Owner, 2026-10-10, on learning that DSH 0.2 existed only in scratch
installs: "you know what will happen? as it ALWAYS happen when you,
instead of doing proper install, start to fiddle with temp installs?"
The day's evidence agrees: the plugin's packed proof reached a
uniform graph only through a .pnpmfile hook that a real host does
not have, and the hook-less measurement showed a retained direct
cordis pin leaving two physical copies that the runbook's checker
missed (W-115). Rulings: (1) The newest DSH is installed on the
dsh host properly, in the home install under the user's pnpm
convention, as soon as it is the target (D-048), with the D-043
repair, the companion pins derived from the executing CLI, the
headless boot and the closure check; what that breaks on the host
until the products follow is stated in the ledger, not avoided.
(2) Evaluation and gating of dashi, roller and the plugin against a
DSH version run on that host install as well as in CI; scratch
installs may answer a narrow read-only question but never stand as
acceptance evidence. (3) umka follows at dev1's pace after the dsh
host and the products are proven. Applied today: DSH 0.2.1-alpha.2
goes onto the dsh host now; dashi 0.1.3 and the pre.16 profiles are
known broken there until plugin pre.17 (W-115, releasing) and dashi
0.2.0-alpha.1 (W-114) land.
(4) Owner, same day: "we will need to release yet another version of
everything, as it will turn out that it does not work with properly
installed". So: no tag and no publish of dashi, roller or the plugin
before the packed candidate from the merged head is installed on the
dsh host's real DSH graph through the ordinary install path and the
acceptance passes there on the permanent daemon; merge may precede
the proof, publication may not. The pre.17 tag is held under this
rule until the host proof.

Amendment 2026-10-10 (owner: "it is not only dashi but roller and
whatever else we have"): the host-proof rule covers every artefact
this ledger owns and every host it installs on. Products: @antst/dashi,
@antst/dashi-app, @antst/dashi-launcher, @antst/dsh-file-uploads-none
(one release train), @antst/roller, @sessionbus/dsh (with its bins
sessionbus-dsh and sessionbus-dsh-install), and the runbook
docs/HOST-INSTALL.md. Host surfaces: the dsh host's home DSH install
and its three profiles (dashi, sessionbus, web), umka's equivalents
at dev1's pace, the mac host when scheduled. roller 0.1.4 (W-116)
was published on the 0.2 floor from scratch legs before this rule
existed and has not run on a properly installed DSH 0.2; W-118 proves
it on the dsh host before any further roller release, and dashi
0.2.0-alpha.1 pins it only after that proof.

Amendment 2026-10-10 (multi-package products). dashi is four packages
with exact internal pins, so a file: tarball install of dashi-app
cannot resolve its siblings before they exist on npm, and a hand-built
profile with local overrides is exactly the fiddling this decision
forbids. For such products the install vehicle for the host proof is
the ordinary prerelease publish: tag the candidate, let the release
workflow publish all packages under a prerelease dist-tag (`alpha`;
`latest` untouched), then `dsh plugin --profile dashi add
@antst/dashi-app@<version>` on the dsh host exactly as a user would,
then the proof packet. A failed proof is answered by the next
prerelease number, never by a host patch or a moved dist-tag. Only
after the packet is accepted may a dist-tag or an announcement move.
Single-package products (the sessionbus plugin, roller) keep the
packed-tarball proof before the tag.

### D-050 (2026-10-11) Install docs and checks are universal: any DSH install, no host layout
Owner, 2026-10-11, after the mac, pdev and umka upgrades: "DSH itself
can be installed locally and globally without dances. As absolute
majority of packages. Why we ended up with some kind fo fucked up
hardcoded stuff?"; "global is recommended by DSH! so, this is mjority
of users"; "user might have both, global and local installs"; "ok. fix
docs and checks"; "make them universal". Cause, recorded: the dsh and
umka hosts keep DSH as a dependency of a long-lived pnpm project in
the home directory and upgrade it in place; pnpm then leaves peer-only
DSH packages on the old version, and every resulting failure since
D-043 was answered with one more check, pin or repair step until the
host runbook passed 2,200 lines and the product READMEs inherited its
assumptions (home path, pnpm only, one install, companion pins). The
architect approved each step and did not apply rule 3. The same day's
evidence: a global install is a fresh resolution and came out uniform
with no repair (mac, 289 records); a plain profile add boots and
passes the runtime check without companion pins (pdev, dsh). Rulings:
(1) The install documentation of dashi and of @sessionbus/dsh is what
an ordinary DSH user does with whatever DSH install they have: global
(npm, pnpm, npx) first because DSH recommends it, a project install
second, both present at once stated plainly. No home path, no
package-manager assumption beyond what DSH itself requires, no link to
the host runbook as the way to install. (2) Every command sequence the
documentation gives is run by a hosted leg on a clean machine, per
package manager and per supported OS; a sequence without a leg is not
documented. (3) Checks, in the installer, the launcher, CI and the
runbook, assert runtime facts through DSH's own resolution from the
DSH that is actually executing (one DSH version, the floor, one copy
of each of our packages, the plugin's peers resolved), never a layout
(a path under the home directory, the number of DSH installs, pins
present in a profile lock, a particular package manager). (4) The host
runbook is an operations procedure for upgrading a project install in
place; D-043's repair, companion pins and lock-uniformity rules apply
inside that procedure only. D-049 is unchanged: the real host remains
the proof. (5) What cannot be made to work for a layout is named with
its owner (DSH, pnpm, a third-party plugin) and the exact remedy,
never patched around silently. (6) Whether our own hosts move to a
global install is a separate owner decision, not taken here.

### D-051 (2026-10-11) Plain versions; every publish goes to latest
Owner, 2026-10-11, on learning that `latest` of @sessionbus/dsh still
points at 0.1.0-pre.2 while pre.20 is current: "why this one need
manual action and not automatically points to lates
released/published? because of pre? but then stop using pre, as it
always brings headache". Cause: npm moves `latest` only when a
publish names no other tag, and our release workflows publish a
prerelease version under its own tag (`pre`, `alpha`), so `latest`
stayed where the last plain publish left it (plugin 0.1.0-pre.2,
dashi 0.1.3). Rulings: (1) Our packages are published with plain
versions only, and every publish goes to `latest`: no prerelease
version strings and no extra dist-tags for dashi, the plugin or
roller. (2) Next versions: @sessionbus/dsh 0.1.0, in place of
0.1.0-pre.21, and the four dashi packages 0.2.0, in place of
0.2.0-alpha.3; both sort above every published prerelease. (3) D-049
stands and its multi-package clause changes: the proof before a
publish is the packed candidate installed on the real host, the
bytes to be published and hash-checked, not a prerelease publish.
After the publish the literal registry install is checked on the
same hosts; a failure there is answered by a patch release, never by
moving a tag. (4) Exact pins between our own packages stay. DSH's
own prerelease versions and tags are upstream's and are named
exactly in our documents, as now. (5) The stale `pre` and `alpha`
tags are left for the owner to remove or keep; nothing of ours reads
them.

### D-052 (2026-10-12) A release tag carries the hashes of the proven archives
D-049 and D-051 require that the bytes published are the bytes proven
on real hosts. For the plugin this was checked after the publish (the
workflow re-packs; the registry archive equalled the proven one for
pre.20 and 0.1.0). dashi publishes four packages and the check moves
before the publish. Ruling: the annotated release tag's own message
carries one line per package, `<sha256> <archive file name>`, written
by ops from the accepted host-proof packets. The release workflow
packs, runs `sha256sum -c` against the tag message before any GitHub
or npm step, and publishes exactly those archive files. A tag without
the lines, or with a mismatch, fails before anything is published. No
artifact carried between runs, no approval manifest, no extra workflow
input, no credential or scope change. A version already on the
registry is not skipped blindly: its integrity must equal the expected
archive, else the run stops; a network or auth error is never read as
absence. The plain-version rule of D-051 is one small script the
workflow calls first, tested directly. Applies to dashi from 0.2.0 and
to the plugin from 0.1.1.

### D-053 (2026-10-13) The owner's installations carry nothing unpublished
Under D-051 nothing is published before its proof, and dashi's four
packages pin each other exactly, so an unpublished candidate can be
installed only with temporary wiring between its archives. Asked
where the 0.2.0 candidate should be proven before the tag, the owner
chose proof profiles over his own profile. Rulings: (1) that wiring
never goes into the owner's own profiles or into the launcher of his
home project; (2) before the tag the candidate is proven on the real
DSH installation, the pnpm on PATH and the permanent daemon, in
places that are not his: a new user's first run in a private DSH
home, and a profile under another name in the real DSH home, built
as his was and upgraded in place; (3) after the publish that proof
profile is re-added from the registry first, then the owner's own
installation is upgraded by the README's commands, and a failure
there is answered by a patch release (D-051). The launcher names
the `dashi` profile itself, so before the tag it runs only against
the private home: a stated limit of every such proof.

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

### W-105 dashi and sessionbus-dsh: repository references follow the organisation move — status: accepted 2026-09-22 (sessionbus-dsh PR #47 and dashi PR #237 squash-merged)
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

Accepted 2026-09-22. Plugin half: sessionbus/sessionbus-dsh PR #47
(squash c4b656a; README, docs/HOST-INSTALL.md and package.json
repository fields point at the organisation; no version change; the old
antst references are gone; the gate passed only after the owner
installed the pkg.pr.new app on the organisation, since GitHub App
installations did not follow the transfer). dashi half: PR #237 (squash
86e07a4; scripts/provision-sessionbus.mjs downloads from
github.com/sessionbus/sessionbus with unchanged checksums; gate green on
the three DSH legs and preview; macos-gate needed one rerun after an
unrelated flake in the resized-decision case, recorded as W-106 with the
failing frame saved). Verifiers: haiku fourteen-point review of #47;
haiku five-point review of #237; run 35736658657 green on rc.2, alpha.1,
alpha.2 and preview, macos-gate green on its single permitted rerun,
attempt 1 failure saved under scratchpad w105-macos-flake-35736658657 as
the W-106 input.
### W-106 PTY: the resized inline decision case reads the frame before the overlay repaint — status: accepted 2026-09-22 (PR #240 squash-merged)
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
Accepted 2026-09-22 (PR #240, squash 29232fc; test-only, production
source 0). Root cause was in the test helper, not only the wait:
parseFrame read rows from line 0 of the xterm buffer, which in inline
mode after a resize is scrollback, so the parsed "overlay" was the old
transcript; it now anchors at buffer.active.viewportY. The resized
decision case waits for `Approval · bash` and `Allow once` in the parsed
overlay region before each resize and before Enter; the streaming resize
case waits for its stream markers in the transcript region and `idle ·`
in the status region; replacement-character negatives are scoped to the
text region; the two raw synchronized-output waits are gone; no
assertion removed or widened. Audit: these two are the only cases that
assert a frame after a live resize; other resize calls set dimensions
before launch or assert durable outcomes. Evidence: the W-105 macOS
failure frame and log saved; changed cases 20/20 under four-worker load
with hashed logs; run 35743212202 green on rc.2, alpha.1, alpha.2 and
macOS in three attempts. Verifier: sonnet nine-point review; one
cosmetic nit left as is (an initial resizedFrame call before each
vi.waitFor is overwritten on the first iteration).

### W-107 sessionbus-dsh: the skill text says idle messages stage; the contract says they wake — status: accepted 2026-09-27 (sessionbus-dsh PR #49 squash-merged, docs only, unreleased)
Found by pdev's cross-repo split audit (inventory on pdev,
stale-idle-stage-inventory-opus-20260927): skills/sessionbus.md
lines 70-76 still describe the lane default as `idle_message:"stage"`
with `run` as the opt-in, while docs/HOST-INSTALL.md and daemon 0.5.7
(normalizePolicy, protocol) make idle wake mandatory and normalise a
stored legacy `stage` to `run`; the plugin already implements the
wake (W-100). Scope: correct that passage so the model reads the
current contract (fresh lanes and interactive sessions wake on an idle
message; `stage` is a legacy alias normalised to `run`; there is no
opt-out); no other content change; update the skill-content unit
assertion that pins the old wording; grep the file for any other
`stage` claim. Text only, no version bump in the PR; whether a
pre-release carries it to installed models is the owner's call,
recorded here when made. PR against main, gate green, handoff.

Accepted 2026-09-27 (sessionbus/sessionbus-dsh PR #49, squash
33d6880; docs and test only, on main after W-108). The skill now
states that fresh lanes default to `idle_message:"run"`, that fresh
lanes and interactive sessions wake on an idle message, and that the
legacy `stage` value is normalised to `run` with no opt-out; the
remaining `queued_for_next_turn` mention describes a delivery
disposition, not lane policy. Unit assertions pin the three
statements. No version bump; the corrected text reaches installed
models only with the next plugin release, which is the owner's call.
Evidence: npm test 71/71 on rc.2, alpha.1, alpha.2; packed proofs
green; run 36289938885 green. Verified by the architect directly
(two-file diff read in full).
### W-108 sessionbus-dsh: the packed-consumer test installs the leg's DSH version — status: accepted 2026-09-27 (sessionbus-dsh PR #48 squash-merged, test only)
Found while preparing W-107: package.test.cjs's packed-consumer
install (`npm install --omit=peer` at :29) floats to the newest DSH
prerelease, so the day 0.1.5-rc.3 appeared upstream the test began
failing with ERESOLVE on cordis (rc.3's dsh-agent resolves cordis
4.0.4 against a 4.0.2 peer) before any plugin code ran; with
legacy-peer-deps the suite passes 71/71, which proves the failure is
the harness, not the plugin. Scope: the packed consumer installs the
DSH version of the leg under test, the same value the packed-proof
script receives, never a floating latest; assert the installed
@deepseek-ai/dsh version equals the requested one; no legacy-peer-deps
escape. Evidence: full npm test 71/71 on Node 22/npm 10 and on the
builder's local Node; packed legs green. Test only, no version bump.
W-107 rebases on this.

Accepted 2026-09-27 (sessionbus/sessionbus-dsh PR #48, squash
3e5be10; test and workflow only). The isolated packed consumer runs
pnpm 10.28.1 with DSH's profile settings (node-linker hoisted,
auto-install-peers false), installs exact @deepseek-ai/dsh at the leg
under test plus the packed plugin, and asserts both installed
versions; CI and release install the root test dependencies from the
tracked lockfile with `npm ci --omit=peer --ignore-scripts` and pass
the matrix leg as DSH_TEST_VERSION; the lockfile is unchanged with
52 DSH records at rc.2. Ruling recorded: strict npm cannot admit the
0.1.6 alphas under the D-041 floor and real installs go through
pnpm via `dsh plugin add`, so pnpm is the correct consumer; no force
or legacy-peer flags. Evidence: npm test 71/71 on rc.2, alpha.1,
alpha.2 (Node 22/npm 10 and Node 25/npm 11), packed proofs and peer
floor green, run 36289668881 green. Verifier: haiku six-point review.
### W-109 DSH 0.1.5-rc.3 under the track-current rule — status: accepted 2026-09-27 (dashi PR #246 and sessionbus-dsh PR #50 squash-merged, test infrastructure only)
D-030: validate against the newest DSH first, never pin backwards.
0.1.5-rc.3 is on npm. Scope: (1) the read-only shape of rc.3's
dependency closure: which package requires cordis 4.0.4 and which
peers pin 4.0.2, whether a uniform rc.3 graph installs cleanly under
pnpm with the D-041 floor, and whether 0.1.6-alpha.2 has the same
shape; (2) if rc.3 is installable, add it to the tested matrix of
dashi (validated-dsh-versions.json) and of the plugin's packed proof,
run the full gates, and record any behavioural difference as named
DSH gaps; (3) if the closure is internally inconsistent, an upstream
report draft in the usual format for the owner's go, and the matrix
unchanged with the reason recorded. No floor change without a
decision entry.
Accepted 2026-09-27 (dashi PR #246, squash 7e9e862; sessionbus-dsh
PR #50, squash 204cf3c; test and CI infrastructure only, no
version bump). DSH 0.1.5-rc.3 joins both tested matrices; the floor
stays 0.1.5-rc.2. Finding: rc.3 installs as a uniform DSH closure,
but its CLI pins the cordis family exactly while newer
cordis-plugin-include, loader and HMR releases require cordis 4.0.4,
so any harness that lets those companions float splits the graph
(gate typecheck failed on two Context types; the clean-install PTY
case failed on the HMR service). Ruling: one shared helper
(scripts/dsh-cli-pins.mjs) derives from the tested CLI's manifest a
pin for every non-DSH @deepseek-ai dependency, the exact pin or the
minimum of its range, used by the version gate, the top-level gate
and both nested clean-install hooks, with one resolved version per
package asserted in every lock; derived pins on all four legs:
cordis 4.0.2, schemastery 3.18.2, cordis-plugin-hmr 1.0.17 (absent
on alpha.2, which does not declare it), cordis-plugin-timer 1.1.4,
cordis-plugin-loader 1.0.3, cordis-plugin-include 1.0.7. The
plugin's packed-proof cutoff is the latest publish time across the
CLI's full DSH closure plus one second, replacing CLI publish plus
one hour, which rc.3 violated. Not an upstream defect; the exact-pin
versus floating-companion fragility is recorded here as a note.
Evidence: dashi run 36293122878 green on rc.2, alpha.1, alpha.2,
rc.3 and macOS; plugin run 36291516313 green on the peer floor and
four legs; local full gates on rc.2 and rc.3 300/300 with 233 uniform
DSH packages. Verifier: sonnet twelve-point review of both PRs.

### W-110 dashi 0.1.3: plugin pre.16, kit 0.5.12, daemon v0.5.12 — status: accepted 2026-10-10 (PR #249 squash-merged; released as 0.1.3)
Per D-046 ruling (4). Plugin pre.15 was a flag day: the daemon must
be v0.5.9 or newer and a kit 0.5.7 host is refused, so dashi 0.1.2
(plugin pre.14, kit 0.5.7, PTY daemon v0.5.7) cannot meet a current
daemon. Scope, dashi develop: dashi-app pins @sessionbus/dsh
0.1.0-pre.16 exact (W-091 shape; lockfile moves pre.14→pre.16 and kit
0.5.7→0.5.12, nothing else; report records); the test harness pins
@sessionbus/kit 0.5.12 exact; scripts/provision-sessionbus.mjs moves
to the sessionbus v0.5.12 release with its four checksums verified
against the published SHA256SUMS; the four packages become 0.1.3 with
a changelog line (plugin pre.16 on kit 0.5.12; daemon v0.5.9 or
newer required; idle_message no longer exists as a lane argument).
PTY cases from W-101 run unchanged against the v0.5.12 daemon; any
assertion that still names idle_message or the old skill wording is
corrected with its reason. Then on the dsh host, under the owner's
host authorization: daemon v0.5.12 release binary into the permanent
service (same procedure as the v0.5.7 upgrade: verified archive,
snapshot, restart announced on the bus, peers reconnect, before/after
inventory), sessionbus and web profiles to pre.16 exact, dashi profile
to 0.1.3 exact, and the human-visible acceptance of D-045 ruling (3)
natively on the permanent daemon with a current originating caller;
sealed packet for pdev. Release identity (dashi 0.1.3, plugin pre.16,
kit 0.5.12, daemon v0.5.12, DSH version per W-111) goes to pdev for
the umka install. Evidence: gate 3/3 on all legs and macOS; host
acceptance packet. Production source 0.

Accepted 2026-10-10 (PR #249, squash b35185d; released as 0.1.3, main
and tag v0.1.3 at the same SHA, run 38067782101). dashi-app pins
@sessionbus/dsh 0.1.0-pre.16 exact on the owner's direct word ("yes, pin
pre.16", given in the architect's window after pdev's relay); the test
harness pins @sessionbus/kit 0.5.12; the PTY harness provisions the
sessionbus v0.5.12 release for its own tests; the release notes state
the real requirement, a Sessionbus daemon v0.5.9 or newer, because
plugin pre.15 was a flag day that removed the idle_message lane argument
and made message wake mandatory. DSH floor unchanged at 0.1.5-rc.2.
Lockfile moves pre.14→pre.16 and kit 0.5.7→0.5.12 only. Consequence
analysis per D-046 in the handoff: an older daemon response carrying the
retired idle_message policy is rejected by the kit's closed schema as an
invalid frame, the no-daemon PTY case still proves dashi starts and
runs; kit 0.5.12's failed lane interrupt returns -32603 and allows an
explicit retry, and peer supersession no longer awaits the courtesy
write; the archive cache name now carries the release version so a warm
checkout cannot mistake the v0.5.7 archive for v0.5.12. Evidence: five
checks green three times on the head, gate 300/300 with the daemon,
hosted run 38064635445 attempts 1, 2 and 3 green on rc.2, rc.3, alpha.1,
alpha.2 and macOS, all four v0.5.12 archives verified against the
published sums, daemon reports v0.5.12 fd85d7e. Verifier: haiku
seven-point review. Host step and umka install recorded below when done.

Host note 2026-10-10: the dsh host install of this release was done
and verified by the architect (dashi-app 0.1.3 with plugin pre.16,
launcher 0.1.3, sessionbus and web profiles at pre.16, daemon v0.5.12
installed by the owner at 15:09); the acceptance run and packet were
stopped by the owner's D-048 ruling before completion and are not
claimed. Finding kept: with the daemon at v0.5.12 and the profiles
still at pre.14, a lane spawn from a current caller settled as -32600
invalid_frame with no row (the pre.15 flag day seen from the worker
side), distinct from the Sep 21 -32002 caller disconnect.
Before the stop, the native-broker lane spawn proof passed on this
host (profiles at pre.16, daemon v0.5.12, caller codex-peer v0.5.9):
one spawn without idle_message, one completed record "lane hello"
(run-gla0ivuhbf2h/1), ack and close; that closes the Sep 21 -32002
and today's -32600 observations. Snapshots at
~/.local/state/dsh-host-pre16-dashi-013/20261010T165036Z.

### W-111 DSH 0.2 line: evaluate, map what was solved, prove dashi, roller and the plugin on it — status: accepted 2026-10-10 (read-only evaluation; decided in D-047)
Owner 2026-10-10: "there is certainly new version of DSH, so we need
to upgrade to it and (1) check if something was solved there (2) make
sure our profile and plugins works with it." Survey of 2026-10-10:
versions since 0.1.5-rc.3 are 0.1.7-alpha.1/2, 0.1.7-rc.1/2,
0.2.0-rc.1/2, 0.2.1-alpha.1/2 (newest, 2026-10-09); npm latest is
0.2.0-rc.2; no stable exists. Of our thirteen Discussions only
#7172 (turn/end lost on pre-header cancel) is fixed in code since
0.1.7-rc.2 (abortedCancelCause), #7175 (fork replays the pending
prompt) is fixed from 0.1.6-alpha.1 except for a prompt submitted
before turn/end, #7177 is partly changed (sibling dsh-* now exact
pins, cordis family on ~ ranges), #7184 possibly touched (bundle
dependency mapping); #7171, #7174 (fileUploads still hard-injected,
so dsh-file-uploads-none stays), #7179/#7186 (session-scoped model),
#7180, #7182, #7183, #7185, #7187 and the steer strand (wakeDriver
unchanged in 0.2.1-alpha.2) are unaddressed; no maintainer has
replied to any. Breaking notes that can touch us: spill-policy
maxInlineBytes becomes maxInlineTokens (0.1.7-alpha.2); runtime
invariant plugins and ./invariant exports removed (0.2.1-alpha.1);
subpath plugins no longer read separate package.json files
(0.2.1-alpha.1); subagent completion unified, SDK runtimes must
support session/wait (0.2.1-alpha.2); tool-display mode `both`
removed; agent-instructions per-row dshHome removed; some model ids
removed (0.2.0-rc.2); cordis family moved from exact pins to
~4.0.4 (0.2.0) and ~4.0.5-alpha.1 (0.2.1), sibling dsh-* exact.
Step 1, read-only, per D-030 newest first: run the full dashi gate,
the roller gate and the plugin packed proof against 0.2.1-alpha.2 and
against 0.2.0-rc.2 in scratch (the W-109 pin helper takes the ~ range
minimum), and report per product: install shape (cordis copies), each
failing check with its cause classified as ours (profile config,
peer ranges, API use such as ./invariant or spill-policy keys, test
assumptions) or DSH's (named gap, with the smallest reproduction), and
which of the breaking notes actually bite. Also verify in code that
#7172 is fixed on the tested version and whether the fork cut makes
W-070's refusal of /btw during a turn still necessary. No repo edits
in step 1. Step 2 is decided in D-047 on that report: the new floor
and tested matrix, the peer-range form for the cordis family (a
floor like D-041 or the ~ range), the fixes, and the version line of
the resulting dashi release (D-044: a floor change is 0.2.0-alpha.1).

Accepted 2026-10-10 as a read-only evaluation (no repo change; report
/tmp/w111-eval-aCawKJzz/REPORT.md with per-product logs, preserved in
the builder's scratch and summarised in D-047). Findings: both 0.2
versions install uniformly once our stale references are adapted;
roller passes with test-only changes; dashi stops at 39/38
TypeScript errors in six groups (presets package and registry API,
shell executor, jobs and subagents, v4 source kinds, content blocks,
test fixtures) plus the stale model id; the plugin passes its unit
suite but its relay message's source kind is rejected by format v4
and its packed proof hard-codes cordis pins that leave two physical
cordis copies. All causes are ours. #7172 is fixed upstream from
0.1.7-rc.2; the fork cut is confirmed with dashi's /btw refusal still
needed; the fileUploads injection and the steer strand persist.
Decided in D-047; implemented by W-114 to W-117.

### W-112 dashi and roller: the owner's change rule in AGENTS.md — status: open (owner dsh-exec, docs only)
Per D-046 ruling (1) and the owner's instruction of 2026-09-30
("record also in AGENTS.md in ALL repos"). Add to dashi's AGENTS.md
and roller's AGENTS.md a section carrying the owner's verbatim rule
and the four practices as written in the plugin repository's
AGENTS.md (mandatory analysis of edge cases and consequences before
every change; KISS as the smallest sufficient change; RCA before a
fix; preservation and proof), adapted only where this ledger already
states a stronger rule (squash-merge only, PR titles, verifier gates,
no fake completion). The handoff protocol is unchanged: the builder's
handoff now includes the consequence analysis as its first part.
Docs only; one PR per repository; gates green.

Accepted 2026-10-10 (docs only; owner reassigned to codex-roller while
dsh-exec held W-114). roller: antst/roller PR #16 squash 5821c5c;
dashi: antst/dashi PR #264 squash 0638e660408548ff3875758e888fcc34c20a55b3. Both copy the owner's quote
and the four practices byte-for-byte from the plugin repository's
AGENTS.md at 75f8d65 (22 non-blank lines; implementation-language
section excluded), inserted before the handoff protocol; the handoff
bullet goes from three to four parts with the consequence analysis
first; no other line changed, reverse diff reconstructs the prior
document. Recorded fact: neither antst/dashi nor antst/roller has a
review bot (CodeRabbit runs only on the plugin repository), so the
exact-head evidence there is the hosted gates green at the reviewed
head plus the architect's verifier; the owner decides whether to add
one. Verifier: sonnet verifier agents 2026-10-10 (roller #16 and dashi #264: files, checks at head, verbatim copy against plugin 75f8d65, handoff bullet, cross-repo block identity).

### W-113 sessionbus-dsh: runbook follows pre.16 and kit 0.5.12 — status: cancelled 2026-10-10 (D-048; folded into W-115)
docs/HOST-INSTALL.md on sessionbus/sessionbus-dsh main still pins
plugin 0.1.0-pre.15, kit 0.5.9 and daemon v0.5.9 (b485529) while the
package is pre.16 on kit 0.5.12 and the README says the runbook does
not cover pre.16. Re-pin the active steps to pre.16, kit 0.5.12,
daemon v0.5.12 (its release revision and SHA256SUMS), dashi 0.1.3
once W-110 releases it, and the current originating-caller SDK;
remove the idle_message remnants if any remain; stale-literal audit
empty outside the history paragraph. First change in that repository
under its root AGENTS.md: the handoff opens with the consequence
analysis, waits for the review bot at the reviewed head, and the
merge is squashed and pinned to that head. Docs only.

### W-114 dashi 0.2.0-alpha.1: migrate to DSH 0.2 — status: open (owner dsh-exec; design accepted 2026-10-10, implementation after W-115)
Per D-047. Phase 1, design handoff before code (consequence analysis
per D-046): for each W-111 error group, the chosen replacement with
file:line evidence from the tested DSH 0.2.1-alpha.2 and 0.2.0-rc.2
packages: presets (singular package, registry API; what dashi's
copy/remove paths become), shell executor (resolve then execute),
jobs and subagents (what replaced SessionJob and the jobs frames;
what the jobs cell and picker show now; session/wait and the
startContinuable path), v4 source kinds for the shell notice and for
rendering of relay messages, content blocks (tool-result successor),
test fixtures (required projection hints and summary fields), the
README model example. State each user-visible change against the
completeness bar and each named DSH gap. Phase 2 after ACCEPT of the
design: implement on branch w-114-dsh-02 from develop; floor
`>=0.2.0-rc.2` in every peer range; cordis family as floors per
D-047 (4); validated-dsh-versions.json minimum 0.2.0-rc.2, tested
[0.2.0-rc.2, 0.2.1-alpha.2]; CI matrices and the version gate follow;
versions 0.2.0-alpha.1 (D-044); changelog; recorded v3 session
fixtures migrated with DSH's migration; PTY suite green on both legs
and macOS; W-101 sessionbus cases green against plugin pre.17 (W-115)
and the v0.5.12 daemon. Evidence: full gate 3/3 on both legs and
macOS; the W-111 scratch logs as the before state. Production source
changes listed per file with their reason.

Design accepted 2026-10-10 (phase 1c, /tmp/w114-dsh-02/
DESIGN-HANDOFF-1C.md with proposed-dashi-app.patch.yml; three review
passes). Composition on DSH 0.2.1-alpha.2: dsh-base host rows kept;
persona prefix as a host system-prompt override in dashi's words; one
native preset registry with `standard` carrying five scoped rows
(ask-user, present, ralph, time-context, subagent with model selection
on); dsh-tool-schedule and dsh-api-job-controller at host level;
dashi-app's authorization dependency removed; plural presets and the
in-process driver gone. Replacement map: shell resolve then execute;
JobController list/follow/kill with JobView get and non-consuming
readAt, no dashi tracker; /subtask through the native subagent tool
returning subagentId; listChildren for direct children; v4 kinds
plugin:dashi (augmentation in packages/dashi/src/ shell-command.ts) and
plugin:sessionbus-dsh (plugin side, W-115); tool results carried on the
tool message; recorded v3 fixtures migrated through
dsh-session-format-catalog, child-bearing logs via
historicalSessionFormatCatalog first; schedule default export and title;
README model example deepseek-flash. Named for users: preset authoring
inside dashi gone (upstream report on package-relative bundle patches),
custom presets additive only, children refused the schedule tools,
/tasks lists owned and unowned jobs while activations live in the child
catalog, migration-required sessions shown in the picker with the native
fork error relayed, persona and clock context from the new composition,
alpha.2-only line. Phase 2 implements on w-114-dsh-02 after plugin
pre.17 (W-115). Reviews: opus on 1a (blocking schedule split, preset
copy, relay kind), opus on 1b (empty preset losses), sonnet on 1c
(READY); carried into implementation: the boot proof asserts the scoped
subagent shadows the host row against alpha.2 dsh-tools, and the scoped
subagent row deliberately omits the web toolFilter because the schedule
refusal is native.

Accepted 2026-10-11 (antst/dashi PR #267, squash 89dc1485131007dea17490d99a8f7122ee2b7e24; released as
0.2.0-alpha.1 for all four packages from tag v0.2.0-alpha.1, run
38104130094, dist-tag alpha, `latest` untouched). Design 1c implemented as
accepted: dsh-base host rows kept with only the system-prompt and
session-query-sqlite overrides; persona override with the {{model}}
variable only; `standard` preset of exactly five scoped rows (ask-user,
present, ralph, time-context, subagent with modelSelectionSettings);
tool-schedule and job-controller host-level; authorization dependency
gone; fixtures produced by dsh-session-format-catalog and DSH's own
encoders, no hand-encoded v4; listChildren; plugin:dashi augmentation;
jobs through the native JobController/JobView; /subtask through the
native subagent tool; /config shows ctx.settings.documentPath; /loop
surfaces DSH's own schedule refusal; README deepseek-flash. Pins:
@sessionbus/dsh 0.1.0-pre.18, @antst/roller 0.1.4, DSH >=0.2.1-alpha.2
with CI/release matrix [0.2.1-alpha.2]; workspace linkWorkspacePackages
deep (dev-only). Every changed test expectation cites the DSH 0.2
fact that changed it; the storage-import guard stays unconditional
(the schedule unit test became a shipped-profile PTY case on a real
one-minute native schedule, ~124 s). Review: opus design review at
590fdcb (acceptable; four corrections landed in one push at d24eb67,
three green hosted attempts there); ops caught that dashi-app's
`workspace:^` on @antst/dashi would publish as a caret range, so the
release unit's sibling pins are exact from here on (`workspace:*`,
one oracle made exact, head 8c309f7, one green hosted run); verifier
sonnet/opus agents 2026-10-10/11 (design review at 590fdcb, correction deltas at d24eb67 and 8c309f7, hosted attempts, packed manifest, host packet 3534/3534 and live profile state). D-049 proof on the dsh host (DSH 0.2.1-alpha.2): two ordinary
paths. In-place upgrade of the existing 0.1.3 profile = FAIL
(W-121/W-122: the plugin's own provider dependency keeps 0.1.3 beside
0.2.0-alpha.1 and pnpm dedupe collapses nothing); fresh profile =
PASS: 32/32 DSH records alpha.2, one provider, cordis peers resolve to
the host's own copies, closure 590/590, banner `dashi 0.2.0-alpha.1 on
DSH 0.2.1-alpha.2`, real Codex turn, /config shows the settings
document path, /agents standard, /loop fire and stop with empty
catalog, /subtask child completed, /roller-restore usage surfaced,
idle peer relay woke the session (`peer wake ok`), typed slash line
reached the model (`slash ok`), /resume labels a v3 log migration
required; profile content ruled on the way: dsh-plugin-subscriptions
removed (no DSH 0.2.1 release exists), dsh-codex 0.3.2 with the
catalog override, companions inherited from the host. Packet
dsh-host-dashi-020-alpha1-proof-20261011, SHA256(SHA256SUMS)
cb289849...2fdfa, 3534 members. dist-tag stays alpha; 0.2.0-alpha.2
(pins pre.20) proves the upgrade path.

Follow-up 2026-10-11: 0.2.0-alpha.2 (antst/dashi PR #282, squash
60ab2997927fd45cf203c8674363de7cbbfae037; tag v0.2.0-alpha.2, run
38118531091, dist-tag alpha) pins @sessionbus/dsh
0.1.0-pre.20, whose upload provider is a peer the profile owns; README
upgrade section rewritten as the actual in-place instruction, the
stale groups paragraph replaced with the pre.19 facts, the
dsh-plugin-subscriptions wording fixed. D-049 proof: the in-place
upgrade of the dsh host's dashi profile from alpha.1 resolved one
@sessionbus/dsh (pre.20) and one provider (alpha.2) with no cleanup,
32 DSH records alpha.2, and the full feature list passed again; packet
dsh-host-dashi-020-alpha2-proof-20261011 (6653b25a...363f9, 75
files). Verifier: sonnet agents 2026-10-11 (PR #282 content, hosted run, host packet 75/75 and live home/profile state).

### W-115 sessionbus-dsh pre.17: v4 source kind, derived cordis pins, DSH 0.2 legs — status: open (owner dsh-exec, under the repository's AGENTS.md) — scope per D-048: DSH 0.1.5 legs dropped, peer floor >=0.2.0-rc.2
Per D-047 (2), (4), (5). plugin.cjs:176 emits source.kind "plugin"
(form relay), rejected on DSH 0.2 by session-format-v3-to-v4
index.js:125-126 ("format v4 message requires a producer-owned source
kind"). Scope: choose the v4 kind for delivered peer messages with
evidence (the schema union and how DSH's own producers mark inbound
agent messages), keep the sender envelope and the D-045 rendering
contract, and keep the DSH 0.1.5 legs working only if one kind
satisfies both formats; otherwise the plugin's peer floor moves to
`>=0.2.0-rc.2` with the dashi 0.2 line and the 0.1.5 legs leave its
matrix (state which in the consequence analysis). Packed-proof
script: derive cordis-family pins from the tested CLI (W-109 helper
form) instead of the hard-coded 4.0.2/1.0.3, so the packed home is a
uniform closure; the agent boundary proof installs the Agent packages
it imports. Matrix: 0.2.0-rc.2 and 0.2.1-alpha.2 added; the full
packed proof must reach the lane and dashi cases on both. Version
0.1.0-pre.17, changelog, runbook pins (folds W-113 if still open).
Handoff opens with the consequence analysis; bot review read at the
reviewed head; squash pinned to it.

Accepted 2026-10-10 (sessionbus/sessionbus-dsh PR #55 squash 3162d596817bceb2b2ef089184ce7b47f467031f, PR #56
squash 2f897294419d1d99bd89226ccaffd5d18d53124a, docs PR #57 squash 75f8d65246967f023598eda41f353025ab9945a4; released as 0.1.0-pre.17 from
tag v0.1.0-pre.17 at 75f8d65246967f023598eda41f353025ab9945a4, run 38091308571, dist-tag pre). The first change
under the repository's root AGENTS.md: consequence analysis written,
reviewed independently, revised (A to E), then code. Delivered peer
messages carry the v4 kind plugin:sessionbus-dsh with form relay, the
envelope, receipts, FIFO hop, uncertainty, idle wake and identity
unchanged; peer floors >=0.2.1-alpha.2 for DSH and the alpha.2 CLI's
cordis family minima; kit 0.5.12; CI and release matrices
[0.2.1-alpha.2]; root test dependencies installed by pnpm 10.28.1 from a
frozen exact lock (package-lock.json removed); the packed proof derives
cordis pins from the tested CLI and installs the Agent packages its
boundary proof imports; the dashi packed case is gated on
DASHI_APP_VERSION and prints one NOT RUN line to stdout and the step
summary until dashi 0.2.0-alpha.1 exists; the installer refuses a
below-floor host before any write, proven by a new peer-floor case;
runbook re-pinned (W-113 folded); the offline-provider helper reads no
settings with an explicit provider and resolves the settings location
through dsh-settings otherwise. Residual named: a manual pnpm add
bypasses the guard. Heading correction: the entry's floor text
`>=0.2.0-rc.2` and two-leg matrix were superseded by D-047 amendments
(a) and (f) before implementation; the delivered floor is
`>=0.2.1-alpha.2` with the single alpha.2 leg. D-049 proof: the
candidate packed from 2f89729 (tarball sha256 66953c59...6ffc3, byte-
identical at 75f8d65246967f023598eda41f353025ab9945a4's parent 1d98829) was installed on the dsh host's
real DSH 0.2.1-alpha.2 into the sessionbus and web profiles; lane
acceptance (idle send, one completed run, ack, close) and web acceptance
(delivered message wakes, slash line reaches the model, one web-owned
lane round trip) passed with the owner's web process and configuration
untouched; packet dsh-host-dsh-021-pre17-candidate-20261010,
SHA256(SHA256SUMS) 8f4545a3...1fe6. Verifier: sonnet verifier agent 2026-10-10 (tarball identity 2f89729/1d98829, PR #57 files and checks, packet 27/27, registry pre-publish absence).

### W-116 roller 0.1.4: DSH 0.2 legs — status: accepted 2026-10-10 (roller PR #14 squash-merged; released as 0.1.4)
Per D-047 (5) and the W-111 report: production unchanged; drop the
unavailable @deepseek-ai/dsh-code-runtime devDependency, provide the
DSH testkit working-directory fixture in both test harnesses, peer
floor `>=0.2.0-rc.2`, tested matrix 0.2.0-rc.2 and 0.2.1-alpha.2,
cordis family as floors per D-047 (4), version 0.1.4, changelog.
Evidence: gate 15/15 on both legs; the release flow of roller.

Recorded in roller's LEDGER.md; release run 38066085938.

### W-117 upstream: close what DSH fixed, post what it did not — status: accepted 2026-10-10 (posted on the owner's word)
From W-111: reply on Discussion #7172 that 0.1.7-rc.2 and later fix
it (abortedCancelCause and turn/end in finally), and on #7175 that
the fork cut is confirmed with the pre-turn/end residual; post the
steer-strand report (scratchpad draft upstream-steer-strand.md,
updated to cite agent-loop lib/index.js:854-858 on 0.2.1-alpha.2);
leave the rest open. Posting happens only on the owner's "post it".

Accepted 2026-10-10 on the owner's "post it". Posted under the
owner's account on deepseek-ai/deepseek-harness: Discussion #9370
"Agent.steer during the running→idle transition strands the spliced
next-step item" (category Ideas, like the earlier thirteen), with
citations verified on 0.2.1-alpha.2 (dsh-agent-loop lib/index.js:
send 800-806, steer 809-811, wakeDriver returns on a running phase
854-858, turn/end in finally 1027-1035, hasPending read 1037, idle
transition in kick's finally 893-898) and the reproduction script
named; a comment on #7172 confirming the fix from 0.1.7-rc.2
(abortedCancelCause 731-745, catch 1011, turn/end finally 1027-1035);
a comment on #7175 confirming the fork cut (dsh-session
buildForkSeed 925-934, called from fork at 2008) with the residual
pre-turn/end case stated from our reading, not a new test. Body kept
in the architect's scratch. Fourteen reports now; #7172 and #7175 are
the two with confirmed fixes.

### W-118 roller 0.1.4 on the real host — status: open (owner codex-roller, after plugin pre.17)
Per D-049 amendment. On the dsh host (DSH 0.2.1-alpha.2 in the home
install): install @antst/roller 0.1.4 exact into a real profile the
way a user would (`dsh plugin --profile <p> add @antst/roller@0.1.4`
on a snapshot-backed profile; the dashi profile stays untouched until
W-114), run the D-043 (0.2) checks (lock uniform, companions one each,
runtime resolution for roller's own package), boot the profile and
exercise roller's capture and restore on a real file edit through a
real model turn on the permanent daemon or a recorded turn if the
profile has no provider, and `/roller` surfaces as documented. Any
failure is fixed in roller 0.1.5 before dashi 0.2 pins it. Evidence:
expected vs actual with the profile log excerpts; sealed packet.

Accepted 2026-10-10 (no code change; proof only). roller 0.1.4 runs on
the dsh host's real DSH 0.2.1-alpha.2 install: dedicated profile
roller-proof with exact @antst/roller 0.1.4, dsh-codex 0.3.2 and
@sessionbus/dsh 0.1.0-pre.17; home and profile locks uniform at alpha.2
(290/13 records), companions one each, anchor correct; runtime
resolution via ctx.pluginPackages.packageOf from the profile importer
and roller's own importer gives 0.1.4 at the profile path. Two real
model turns (dsh-codex) made four edit/write mutations with four
persisted checkpoints; /roller-restore 32, start and 0 executed through
native commands.execute restored exact bytes (numeric: first retained,
later absent; start and 0: both created files absent), all reports
Failed(0), three paired durable command/run+done records in the v4 log.
Home manifest and lock byte-identical before and after; owner profiles
and process untouched. Two harness stops recorded, neither a roller
defect: pre.17 not yet published (resumed after the publish), and the
checker's wrong assumption that a bundle's own package appears in the
profile table (DSH app-boot deletes it; packageOf is the lookup).
Packet roller-w118-host.lRglU3ix, SHA256 3bed0a30...66aa, 75 files.
Heading correction: the entry's `/roller` is the documented
`/roller-restore` (seq|start|0); no alias exists. Verifier: sonnet verifier agent 2026-10-10 (packet hash and 75/75 manifest, profile exact pins and installed versions, home manifest/lock identical to snapshot, 13 dsh-* records alpha.2, owner process present).

### W-119 plugin pre.18: file-uploads-none range covers the 0.2 line — status: open (owner codex-roller, after W-112)
Found during W-114: @sessionbus/dsh pre.17 depends on
@antst/dsh-file-uploads-none ^0.1.0, so a profile that pins dashi-app
0.2.0-alpha.1 resolves two copies (0.1.3 with DSH 0.1.5-floor peers
beside 0.2.0-alpha.1): two providers of one service and an unmet-peer
install on DSH 0.2.1-alpha.2. Fixed at the source per D-049, before the
dashi 0.2 host proof: release 0.1.0-pre.18 whose only change widens
that range to accept the 0.2 line (builder decides the exact range;
semver prerelease matching proven by a test that resolves one copy in
a profile pinning 0.2.0-alpha.1 and one copy in a profile on 0.1.3).
Consequence analysis first, bot review at the pushed head, merge
pinned, tag, registry check, then W-114 re-pins to pre.18 exact.
Evidence: the resolution test, pack byte diff limited to package.json,
registry view of pre.18.

Accepted 2026-10-10 (sessionbus/sessionbus-dsh PR #58 squash 0d98cad30e777745d350cad34694fd3f9f5c6c42;
released as 0.1.0-pre.18 from tag v0.1.0-pre.18 at 0d98cad30e777745d350cad34694fd3f9f5c6c42, run 38094675235,
dist-tag pre). Range `^0.1.0 || ^0.2.0-alpha.1`; package.json is the
only shipped file that differs from pre.17 (version and that range;
pre.17 tarball 66953c59...6ffc3, pre.18 35da7798...cc07). Proof:
registry-shaped fixture serving the published 0.1.3 helper and the
W-114 0.2.0-alpha.1 helper packed read-only; direct-helper profiles and
a dashi-app-shaped profile with the two nested edges resolve one copy
at 0.2.0-alpha.1 and one at 0.1.3 with the same importer path, and the
old range resolves two (negative control); semver boundary checks;
76/76 tests; packed alpha.2 lane/web/boundary/install/uninstall and
peer-floor legs PASS; the dashi packed case stays NOT RUN until
0.2.0-alpha.1 is published. Known boundary: a helper prerelease on a
different base (0.2.1-alpha.x) is not admitted and needs a later range
change. Heading correction: the published 0.1.3 helper carries cordis
peers only, not DSH 0.1.5-floor peers; the defect is the duplicate
provider copy. Verifier: sonnet verifier agent 2026-10-10 (PR files/checks, package.json diff, extracted tarball diff, pack sha, semver boundary, CodeRabbit at head, no skip/todo/only).

### W-120 plugin: per-session groups from the UI — status: open (owner codex-roller)
Owner request 2026-10-11: a web profile hosts many DSH sessions, each
its own peer row, but @sessionbus/dsh resolves groups once per process
(plugin config key or SESSIONBUS_GROUPS; plugin.cjs:68) and the kit
cannot change groups on a live attachment (rehello takes name/info
only; replace needs another session id). Deliver in the plugin: one
user-invocable, not model-invocable command through DSH's command
service (`/sessionbus-groups`: no argument shows the session's groups,
a comma list sets them, `-` resets to the profile default; existing
group text validation), visible in the web palette and in dashi.
Mechanism: shut the session's peer down and present it again with the
same session id and the new groups (the existing create/dispose path);
if pdev confirms a re-hello may carry groups, use that and drop the
reconnect. Persistence: the per-session choice lives in the plugin's
own DSH storage domain keyed by session id, applied at present, so it
survives restart and resume; profile config and the launch variable
remain the default for new sessions; no plugin file, no mirror.
Owner rule: consequence analysis first. Evidence: packed alpha.2 web
leg showing two sessions with different groups listed by a peer, the
change surviving a process restart, the model refused the command;
host proof on the dsh web profile per D-049 before the tag.

Amendment 2026-10-11 (pdev answer, source-verified against kit/daemon
v0.5.12): a same-connection group change is rejected by design
(-32602 invalid_hello; PROTOCOL.md:155-165), so the re-hello option is
closed. A new connection may claim the same session id with new groups
at once; the daemon displaces the old attachment atomically and the
old client receives session.superseded (-32012). Overlapping
replacement preserves the peer's lane ownership; detach-first ends
ownership of its non-persistent lanes. Mechanism therefore: connect
the new peer first, treat the old peer's superseded close as expected,
swap, then shut the old object down; the stored list is written only
once the new peer is ready; lane ownership across the swap is proven
by a test.

Accepted 2026-10-11 (sessionbus/sessionbus-dsh PR #59 squash 1de2447d0798cdb5b2b155fcd4309ae0656e6a64; released
as 0.1.0-pre.19 from tag v0.1.0-pre.19 at 1de2447d0798cdb5b2b155fcd4309ae0656e6a64, run 38109061761, dist-tag
pre). Delivered as amended: `/sessionbus-groups` through dsh-commands
(human command plane only; the model gets UNKNOWN_TOOL; lane mode and
non-root agents refuse); overlapping replacement with a fresh env
snapshot, one bounded caller.list/self_info check, adoption then
shutdown of the old peer; cancellation honoured only before connectPeer;
after a failed check the command answers "change in progress" and the
per-root chain settles on the daemon's own terminal signals (candidate
terminal error -> old stays; old superseded -> adopt and persist; old
terminal error -> change rejected with that reason), never tearing
down both; the candidate's delivery callback accepts the exact
previous record until adoption; the unadopted candidate is closed by a
temporary agent/disposed listener and a ctx.effect. Persistence in the
plugin's storage domain sessionbus_groups (table groups, exact session
id key, per-record layout), written only after adoption; a damaged
record refuses activation with the table/key diagnostic and the README
repair step (native put does not validate). zod joins the companions
as a peer at dsh-storage-domain's own range, derived from that producer
through the executing CLI; identity by name/version (DSH consumes the
schema by parse only, proven by prove-domain-schema.mjs as a CI leg).
Known limitation: an old peer mid-reconnect after a daemon outage can
supersede an adopted candidate. The packed dashi case now runs against
the published dashi-app 0.2.0-alpha.1 through the published launcher
and proves coexistence (direct pre.19 beside dashi-app's pre.18), not
the candidate inside dashi. Reviews: opus at 3a0406f (NEEDS CHANGES:
failure path) and delta at 787347a (one blocker), both resolved at
cc972e2, final head bdc0c8e; CodeRabbit read at each head; verifier
opus/sonnet agents 2026-10-11 (design review 3a0406f, delta reviews 787347a and cc972e2, final head bdc0c8e, host packet 3124/3124 and live profiles). D-049 proof on the dsh host (DSH 0.2.1-alpha.2): the
candidate packed
from main 1de2447 (tarball 88c1fde3...7efe, plugin.cjs 8be71831...)
installed into the sessionbus and web profiles by the ordinary path
with producer-derived companions (zod 4.5.4); lane: spawn without
idle_message, idle send, one completed record, ack, close; web: two
real roots show defaults, take distinct groups, the daemon lists both
with product dsh and their private groups, direct messages reach each
with real Codex replies, a root owning a non-persistent lane changes
groups and the real model collects and acks the lane's result through
the new attachment, a scripted model call gets UNKNOWN_TOOL, lane mode
refuses the command (labelled control), restart/resume keeps the
groups, `-` deletes one override only; home and dashi bytes untouched,
owner's default model unchanged. Four harness stops recorded, none a
plugin defect. Packet sessionbus-w120-host.S2zX4q9b (ca3ca8a2...85f99).

Follow-up 2026-10-11: PR #60 (squash 2aa65158cc7a97dcc23f7704e098558239544a7f) canonicalises the proof
anchors (realpath) and records the host-proof cautions in the runbook.

### W-121 dashi: in-place upgrade leaves two upload-provider copies — status: closed (owner dsh-exec, after W-114 proof)
Found by the W-114 host proof: upgrading an existing dashi profile from
0.1.3 with the ordinary `dsh plugin --profile <p> add
@antst/dashi-app@0.2.0-alpha.1` keeps the retained
@antst/dsh-file-uploads-none 0.1.3 edge under @sessionbus/dsh (pnpm
does not re-resolve a still-satisfied range), so the profile holds
0.1.3 beside 0.2.0-alpha.1; a fresh profile resolves one copy (W-119).
Now: the README's upgrade section gains the dedupe step (`pnpm dedupe`
in the profile directory, or DSH's own equivalent if one exists) with
the expected lock result; the W-114 packet records the step as run on
the host. Later, structural: the plugin stops depending on the
provider and the profile owns that pin (plugin item). Docs only here;
no mechanism.

Amendment 2026-10-11: `pnpm dedupe` in the upgraded profile exits 0
and collapses nothing (lock byte-identical; three physical provider
directories), so no ordinary operation repairs the in-place upgrade
and the docs-only scope is withdrawn. The structural fix moves first:
W-122 (plugin pre.20, provider as a peer the profile owns); dashi
0.2.0-alpha.2 then pins pre.20 and its host proof is the in-place
upgrade from alpha.1. The alpha.1 proof continues on the other
ordinary path, a fresh dashi profile, so alpha.2 carries only the
re-pin; the packet names both paths (upgrade FAIL, fresh result). The
README's upgrade section states the defect and the alpha.2 path.

README part merged 2026-10-11 (antst/dashi PR #274, squash a377eb26a1b2ce8f4cd9f433d70628392ea1deea;
docs only): the upgrade section states the retained 0.1.3 provider
edge, the failed dedupe, the fresh-profile path, the planned alpha.2
with plugin pre.20, the exact dsh-codex catalog override and the
dsh-plugin-subscriptions fact. The item stays open until 0.2.0-alpha.2
proves the in-place upgrade on the host.

Closed 2026-10-11: the in-place upgrade path is proven by the alpha.2 host
packet (see W-114 follow-up); the structural fix shipped as plugin
pre.20 (W-122) and dashi 0.2.0-alpha.2.

### W-122 plugin pre.20: the upload provider becomes a peer the profile owns — status: open (owner codex-roller, after W-120)
From W-121: @sessionbus/dsh's own dependency on
@antst/dsh-file-uploads-none is the second owner of that fact; a
profile upgraded in place keeps the old nested copy beside the one
dashi-app pins, and nothing ordinary collapses it. One owner: the
profile. The plugin declares the provider as a peerDependency (range
covering 0.1 and the 0.2 line, as pre.18), never a dependency; a lane
profile gets its exact pin from the installer and the runbook exactly
like the cordis companions (derived from the published dashi-app when
present, else the newest matching release); dashi-app's exact pin
stays the single source in dashi profiles. Proof: packed alpha.2 lane
and web legs with one physical provider copy; the published-dashi case
with one copy inside the dashi profile; an in-place upgrade fixture
from a pre.18 lane profile resolving to one copy; host proof per
D-049 on the dsh host's sessionbus and web profiles before the tag.
Consequence analysis first (owner rule).

Accepted 2026-10-11 (sessionbus/sessionbus-dsh PR #61 squash 8e2d7c2fd84ee870cdc32bac41d101dca3c355f6; released
as 0.1.0-pre.20 from tag v0.1.0-pre.20 at d07cc7e0a6f3c7b449af90bcdfec813fc83a6b2d, run 38115968216, dist-tag
pre). The upload provider is a peerDependency at the pre.18 range; the
installer derives an exact pin for every profile it manages (from the
installed dashi-app's exact dependency when present, else the highest
release in range, chosen explicitly because pnpm's auto-install takes
the latest tag), adds it by the ordinary path before any row write,
never writes a provider row for web, and leaves dashi profiles to the
app; uninstall leaves profile-owned pins. plugin.cjs, launcher.mjs and
bin.mjs byte-identical to pre.19; packed deltas package.json,
install.mjs, README. Proofs: old installer fails the new cases, the
corrected one passes; strict missing-peer refusal (auto-install off)
and pinned positive; in-place pre.19 lane upgrade resolves one
provider with no cleanup; packed dashi case is a labelled coexistence
control (pre.20 beside dashi-app's pre.18), not a one-provider claim.
Reviews: opus at 099a1a9 (NEEDS CHANGES: multi-profile partial
mutation before refusal; a test on the live registry), delta at
d0e26f4 (removal tests still online), final head 4c29920 verified;
CodeRabbit read at each head; verifier opus/sonnet agents 2026-10-11 (reviews at 099a1a9/d0e26f4/4c29920, host packet 3201/3201 and live profiles). The host proof's
first attempt stopped on a runbook defect (the provider-pin and floor
snippets resolved dsh-app-boot from a synthetic .bin anchor, absent on
the real host where it lives in the pnpm virtual store); fixed by PR
#62 (squash d07cc7e0a6f3c7b449af90bcdfec813fc83a6b2d: runbook and two checkers anchor at the real dsh
package manifest, host-like CI control), tarball unchanged. D-049
proof on the dsh host: the candidate packed from main 8e2d7c2
(tarball a25bbe9c...7f18, plugin.cjs 8be71831...) upgraded the
published pre.19 sessionbus and web profiles in place by the corrected
runbook (baseline provider 0.1.1): one provider lock record and one
physical copy at 0.2.0-alpha.1 per profile, profile and plugin
importers resolving the same path, no cleanup; 13 DSH records alpha.2,
companions one each (zod 4.5.4), closure 582/582; lane acceptance
(idle send, completed, ack, close) and a web root on a loopback
instance with the pure per-session model seam: real Codex wake,
`/sessionbus-groups` show/set/reset with a same-group observer
confirming each identity; home, dashi, owner process, group records
and default model unchanged. Packet sessionbus-w122-host.A52lHEZi
(manifest ce5b36d4...06f23, 3201 files, verification 16/16).

Follow-up 2026-10-11: PR #63 (squash b42bc14d9275055958cd7f3bf5e52d74f33bd279) makes the plugin's packed
dashi case prove one shared plugin copy and one provider against the
published dashi-app alpha.2, with the expectation derived from the
app's pin versus the candidate.

Follow-up 2026-10-11: PR #64 (squash 5006c0b68c50449cc4422eb7ab2525fb588fcd10) adds to the host runbook
the staged one-shot settings import (hide the legacy file before any
0.2 boot, owning profile boots first, marker plus keys-only evidence),
the dsh-codex stale-peer disposition, failure guards on every repair
caller, and the owner-only uploads assertion found by the umka upgrade
(a profile without its own lock no longer crashes the closure check).

Correction 2026-10-11 (W-125 evidence). The premise of W-119, W-121
and this item was never a runtime fact. A profile holding two
physical versions of the upload provider was booted for the first
time on 2026-10-11 (W-125, isolated Linux, DSH 0.2.1-alpha.2, both
orderings): exactly one fileUploads service is registered, the plugin
never loads its own copy, native upload refusal and a recorded-model
Sessionbus turn pass. The "two providers of one service" finding came
from our copy-count check; the alpha.1 host proof stopped at the count
and did not boot that profile. What the required peer did buy is a
broken ordinary path: with the peer, the installer must add a package,
and the documented `dsh plugin --profile <p> exec
sessionbus-dsh-install` then waits on the profile lock its own parent
holds and fails after 121 s on a fresh profile (published pre.20). The
peer is superseded by W-125's design. One real effect was found, not
the assumed one: DSH mounts a bundle row from the profile root, so the
provider version that runs is the copy hoisted there, which in one
ordering was the plugin's older in-range copy rather than dashi-app's
pin (byte-identical files, no behavioural difference).

### W-123 macOS flake: "restores after stdin is already closed" times out — status: open (owner dsh-exec, after W-121)
Seen on the docs-only W-121 PR (#274, head 0d9cbc8, run 38108453512,
macos-gate 325/326): profile-pty.spec.ts:2389 "restores after stdin is
already closed" timed out at 30 s with no assertion frame, while the
same case passed on macOS in the four W-114 hosted runs and locally.
Logged exception to the no-rerun rule: that one macOS job was rerun
once for #274 with the first failure kept as this item's evidence
(/tmp/w121-macos-38108453512-failed.log and the full run log). Task:
root cause from the recorded output and the case's wait conditions
(observed state only, no sleeps, no widened assertion), fix the cause
or the case's observation, prove with repeated hosted macOS runs of
that case; if the rerun fails again this item moves ahead of W-121.

Diagnostics armed 2026-10-11 (antst/dashi PR #279, squash 2815739240e5d83873ca26994a8d62a882fa9946; test
only): the case's outer timeout now follows the suite's budget
(testCeiling: 30 s locally, 90 s in CI) so the helpers' 60 s
observed-state diagnostics print before any outer timer; waits and
assertions unchanged. Cause still unlocalised; the item stays open
until the next occurrence supplies evidence. Residual: several slow
successful waits can still exhaust the budget before a stall prints.

### W-124 dashi: launcher finds its own DSH; global and mixed installs documented — status: open (owner dsh-exec)
Owner steer 2026-10-11 ("user might have both, global and local
installs") and three host facts from the same day: the launcher spawns
`dsh` by name, so by full path from a home install it fails with
"dsh not found" (pdev), and with a global and a local install present
PATH order alone decides which DSH a launcher starts; DSH 0.2.1 from a
pnpm 11 global install does not boot at all (upstream loader bug,
reported; mac). Deliver: (1) the launcher resolves the DSH installed
with it first (Node resolution of @deepseek-ai/dsh from the launcher's
own real path, its bin from that package's manifest) and falls back to
`dsh` on PATH; zero dependencies and the one-line "not found" contract
kept; (2) README: which layouts work (home/project install proven;
pnpm 11 global needs the stated pnpm setting or NODE_PATH until the
upstream fix), what a global and a local install sharing one ~/.dsh
means (profiles and sessions are shared; a 0.2 profile needs DSH
>=0.2.1), how to see which DSH a launcher started. Consequence analysis
first. Evidence: launcher tests for co-installed, PATH-only and neither;
a packed two-install fixture; hosted gates; rides 0.2.0-alpha.3.

Amendment 2026-10-11 (D-050). Scope widened from "global and mixed
installs documented" to the universal install story for dashi: the
README's install and upgrade sections lead with a global DSH (npm,
pnpm, npx), then a project install, then both at once; the "npm is
unsupported" sentence stays or goes on the evidence of the legs; the
link to the host runbook as the upgrade path is replaced by the
commands themselves. New hosted legs on clean Linux and macOS run each
documented sequence end to end (install DSH, install the launcher the
same way, `dsh plugin --profile dashi add`, boot smoke under a
pseudo-terminal, an in-place upgrade from the previous release); the
pnpm 11 global-store failure (upstream Discussion 9432) is reproduced
by a leg and documented with its remedy. The gate's layout assumptions
are listed and replaced by runtime assertions. The launcher changes
stand as written; its diagnostic names the upstream problem and never
injects NODE_PATH.

Amendment 2026-10-11 (review of the builder's analysis). The launcher
change is withdrawn: `dashi` keeps starting the `dsh` on PATH, and no
diagnostic line is added. In every ordinary invocation PATH already
selects the DSH of the same install (a global bin directory holds both
bins; `npm exec` and `pnpm exec` put the project's bin directory
first); a pnpm 11 global install keeps the two packages in separate
environments, so own-first could not apply there; and running DSH's JS
entry directly bypasses the package manager's shim, whose environment
is what lets some layouts find the native binding (the mac probe that
started bin.js directly failed where the shim boot passed). A hint
printed on unrelated non-zero exits is worse than DSH's own error,
which the README quotes with its remedy. Kept: the README, the hosted
install matrix (one Node version; npm, pnpm 10, pnpm 11, npx globals
and npm, pnpm projects on Linux and macOS, with the mixed invocations
shown), the gate's layout assumptions, and the product's version check
reading DSH's own resolution (packages/dashi/src/index.ts) instead of
the argv bin's parent directory.

Builder note: W-124's clean Linux/Node 22 pnpm 11.18.0 cell observed
the published alpha.1 app pin `0.2.0-alpha.1` but the active profile-root
fileUploads provider `0.1.2` (one mounted service; completed recorded turn),
in hosted run [38138819395](https://github.com/antst/dashi/actions/runs/38138819395),
artifact `install-ubuntu-latest-G-pnpm11`, file
`runtime-0.2.0-alpha.1-fresh-false.json`.
Its literal registry upgrade to alpha.2 selected provider `0.2.0-alpha.2`;
the identified packed candidate also converged to its exact app pin.
Published provider versions are observations; candidate convergence,
active service ownership and completed native turns remain hard assertions.

Builder note: W-124's macOS matrix consequence: existing CI runs
38136222107 and 38141238695 on develop spent 15m17s and 14m12s in the
gate; PR runs 38138819395, 38145010260, 38148537557 and 38150216475
spent 15m15s, 16m02s, 17m22s and over 19m29s, respectively (the last
cancelled at the unchanged 20-minute job limit). All six headers report
the same image, toolchain and cache hit, but no CPU or physical-host
identity; runner variance versus shared-capacity contention remains
unlocalised. The last delta did not execute in the gate. Under the
architect's isolation ruling, CI's macOS install rows now wait for
macos-gate; Linux rows and preview remain independent. Both callers use
one OS-parameterised row matrix, including the below-floor case only on
Linux; release publishing still requires both operating systems. No
test, readiness bound, oracle or job limit changes. Estimated macOS
branch cost is gate plus about nine minutes (the previous matrix wall
time was 8m55s); runner work is unchanged. Evidence: the six Actions
run IDs above (macOS job logs and job timestamps). Isolation is a load boundary,
not a claim that the existing logs establish shared-capacity causation.

Amendment 2026-10-11 (after independent review of PR #293). Four
changes to the scope above, each on evidence. (1) The product's DSH
version check is deleted, not rebuilt: it compared the CLI with its
own exact dependency and could not fire in any documented layout,
while the skew that can occur was invisible to it. DSH's own
`plugin add` refuses an incompatible DSH and boot disables the rows
with a diagnostic; a hosted leg shows the refusal on a DSH below the
floor. (2) The launcher's "dsh not found" line changes in text only:
it assumed a pnpm project in the home directory and now points at the
install instructions. Nothing else in the launcher changes. (3) The
root README is the only owner of install instructions; the four
package READMEs are a description and a link. The hosted cells execute
its fenced commands, read from the file. (4) The matrix is nine
layouts on Linux and macOS: global npm, pnpm 10, 11, 12 and npx,
project npm and pnpm 10, 11, 12. Each runs a fresh candidate and an
upgrade from each published prerelease, a mixed global and project
selection check and one shell tool call per turn, with every packed
file hash-checked; one more leg is the below-floor refusal. Measured
and documented: a pnpm 11 global install needs
enableGlobalVirtualStore false (Discussion 9432); pnpm 11 and 12
project installs stop at ERR_PNPM_IGNORED_BUILDS until five DSH
dependency build scripts are declined with pnpm's own approve-builds,
and the checks pass with them not run. Not documented as a step:
`pnpm setup`, which on macOS with an npm-installed pnpm 12 writes a
broken launcher (pnpm's defect). The provider that runs is read from
the loaded module; published prereleases are observed, the candidate
must converge to dashi-app's pin.
One workflow consequence: with nine macOS rows running beside it,
the macOS source gate's own time rose from about 15 minutes to over
19 and it was cancelled at its 20 minute limit. The rows now start
after that gate (one reusable workflow, called once per operating
system); separated, the gate took 15m56s. The cause is consistent
with competition and not proven; the limit and the tests are
unchanged, and the preview build depends on the Linux rows only.

Accepted for merge 2026-10-11 (antst/dashi PR #293 squash f47c89043fb972153af747ec6414dc0f9555fd04;
hosted run 38152725106 at 225b0b2: 19 install cells and both source
gates). Reviews by opus agents at 3a9d6e8 (one ruling conflict, six
concerns), 3baabf1 (ten rulings met; two harness defects), 08ec2a0
(a fixture step that pre-upgraded the baseline homes; one overstated
sentence), 5b3dae7 (code met; macOS gate cancelled at its limit) and
225b0b2 (verified, all checks green). No bot reviews this repository.
Shipped behaviour changes: the version warning is removed, the resume
hint and the launcher's not-found line are reworded. Not released:
it rides 0.2.0-alpha.3, which pins plugin pre.21 as its last step,
with host proof per D-049 on a global install and a project install.
Open with the owner: the develop ruleset has no required status checks,
so only the gate process blocks a red merge.

### W-125 plugin: universal install docs and layout-independent checks; runbook scoped as operations — status: open (owner codex-roller)
Per D-050. In sessionbus/sessionbus-dsh: (1) README install = any DSH
on PATH, `dsh plugin --profile <p> add @sessionbus/dsh@<v>` and the
installer command, for a lane profile and for a web profile; nothing
host-specific; what the installer does for the user (rows, the exact
provider pin) stated in two sentences. (2) Guards and checks listed
one by one with the failure each prevents and the layout it assumes;
those that assume a layout (home path, one install, companion pins in
the profile lock, pnpm) are rewritten to assert the runtime fact
through the executing DSH's own resolution, or moved into the
operations procedure if they only make sense for an in-place upgrade
of a project install; the DSH floor guard, the bundle-conflict refusal
and the one-copy assertions stay. Whether companion pins are needed by
anything other than our own lock checks is settled by a leg, not by
argument. (3) docs/HOST-INSTALL.md is retitled and introduced as the
operations procedure for upgrading a project install in place, with
the operator naming the DSH install to act on instead of the script
asserting there is exactly one under the home directory. (4) Hosted
legs on clean Linux and macOS for a global npm DSH, a global pnpm DSH
and a project install: install, lane round trip, web delivery,
uninstall. Consequence analysis first; no shipped guard is weakened
without a leg showing the failure it prevented is still caught.
Version 0.1.0-pre.21 if shipped files change; host proof per D-049.

Amendment 2026-10-11 (design, after the premise and feasibility
controls). The plugin has neither a dependency nor a peer on
@antst/dsh-file-uploads-none. It ships its own no-upload provider as a
separate entry of its own package (`@sessionbus/dsh/file-uploads-none`,
308 bytes, byte-identical to the dashi provider's lib) and the
installer's lane row names that entry; the DSH 0.2.1-alpha.2 Loader
mounts a package subpath row from the profile root (control: sole
fileUploads implementation, native refusal, lane hello admitted; an
unexported subpath is refused at boot). The installer writes rows only
and performs no package operation: provider selection, the registry
query, the app-pin validation and the runbook's pin step are deleted.
The README path is `dsh plugin --profile <p> add --save-exact
@sessionbus/dsh@<v>` then `dsh plugin --profile <p> exec
sessionbus-dsh-install [--product dsh web]`, with the 121 s lock
failure of published pre.20 as the failing-first control. A dashi
profile then holds only dashi-app's provider; a web profile gets no
provider package; an upgraded pre.20 lane profile keeps its old exact
provider pin as an unused leftover, reported and never removed.
Runtime oracle: the mounted row and the registered service, never
physical or lock counts. plugin.cjs unchanged; the packed list gains
the one entry file; version 0.1.0-pre.21.

Amendment 2026-10-11 (implementation, after four independent reviews
of PR #66). What the design above became, and what was added to it.
The installer has one new dependency, js-yaml exact 4.3.2, used to
read only: it never re-serializes a patch and edits by source position
inside its own marked rows, so every other byte survives, including
comments, DSH's header and `!!js` expressions (constructed inert). It
edits two shapes, the block sequence DSH writes and DSH's stock empty
template; it reads flow and JSON bundle files. One preflight covers
all profiles and computes every output before the first write. It
refuses, with nothing written: an unparseable or non-UTF-8 file, a
non-empty flow or JSON patch, a dangling symlink, a malformed manifest
container, an unmarked row that mounts a package, a marked row inside
an indentless list, and a profile whose app already provides the
sessionbus or upload-provider row (DSH lets the last row with an id
win silently). An unmarked row that only overrides configuration is
the owner's: kept byte-identical, the lane default not applied, one
line printed. Each file is written like DSH's own writer does (sibling
temp file, rename) but keeps the existing mode and the symlink's
referent; a file changed since the preflight is not overwritten; an
unchanged file is not written at all. Uninstall strips only marked
rows. The installer no longer inspects the executing CLI: floor,
anchor and base probes are deleted, and a hosted leg shows DSH's own
refusal below the floor. Hints carry the installer's exact version.
Measured boundary: strict peer settings do not refuse the ordinary
add, because pnpm clears them for `add`; the README says only that
the plugin is tested with DSH's profile defaults and takes its DSH
peers from the executing installation. Proof harness: one process
group per child, signalled only by its owner, with an emptiness check
that can fail. Waived: an executable leg for the published pre.20
failure; its evidence is committed (exec failed after 121,380 ms on
the profile lock) and every installer exec in the legs is bounded.
Reported upstream: DSH exits 0 when a profile names a bundle that is
not installed.

Accepted for merge 2026-10-11 (sessionbus/sessionbus-dsh PR #66 squash
867764346aea7e6945bcca924ba3a62a0323a08b; hosted run 38156213539 at 7aecc7e: 17 jobs, of which 14 are
Linux and macOS installs by global npm, pnpm 10, 11 with the documented
remedy, 12, npx, project and mixed). Reviews by opus agents at 163587b
(red gate; uninstall refused an accepted profile; a byte-order mark
shifted every edit), dffd2ff (three installer defects), 29b7e2e (one
regression) and 7aecc7e (verified; an owner's provider and
default-model rows stay byte-identical in every shape tried);
CodeRabbit read at each head. Packed candidate 2adb5acc...c962;
plugin.cjs 8be71831... is unchanged from pre.20. Not released: W-126
merges first, then host proof per D-049 on a global install and on the
dsh host's project install, upgrading its pre.20 lane and web profiles
in place, and only then the tag v0.1.0-pre.21.

### W-126 plugin: lane open options are session facts — status: open (owner codex-roller, after W-125, same release)
Found on the dsh host on 2026-10-11 with published pre.20: spawning a
lane with open.reasoning_effort rewrote the lane profile's own
cordis.patch.yml (the agent-default-model row gained reasoningEffort),
so one lane's option became the default of every later lane. Cause is
ours: plugin.cjs:164-168 calls ctx.sessionController.selectModel
whenever open.model or open.reasoning_effort is given, and DSH
documents that call as saving the profile default
(dsh-api-session-controller lib/index.js:722-740, saveSelection at
:738). open.model does the same, and a model without an effort can
drop a stored default effort. Rule: a lane's open options belong to
that lane's session; the owner and the installer are the only writers
of a profile patch. Change: validate the requested provider, model and
effort through DSH's own resolution, then apply them with
sessionController.agents.selectForNextRequest; never selectModel or
saveSelection. An effort given alone applies to the session's current
selection, also on resume. Public service interfaces only, no copied
DSH resolution code. Failing-first controls: model and effort, model
only, effort only, resume, no options, invalid effort; the profile
patch is byte-identical after open and after shutdown; the session's
native selection matches the option; a second lane without options
still gets the profile default. Own branch and pull request after
W-125 (whose diff keeps plugin.cjs byte-identical); both ship in
0.1.0-pre.21; one host proof per D-049 covers both.

Amendment 2026-10-11 (implementation, after the builder's analysis and
independent review of PR #67). The change above stands with three
facts added. (1) DSH 0.2.1-alpha.2 has no public way to give one
session its model and effort without saving the profile default: the
controller's create and resume take neither, and the public agent
registry accepts them only by taking creation and lifecycle ownership
away from the controller. The plugin therefore reaches three
documented ApiSessionAgentController methods, selectionFor,
selectForNextRequest and serializeImageAdmission, through
sessionController.agents, which the published types declare private
(lib/types/index.d.ts:49; agent.d.ts:101,107,129). This is the single
named exception to "public interfaces only". If any of the three is
missing, that lane open fails with a message naming it; there is no
fallback to selectModel; a lane opened without options touches neither
the holder nor the llm service; a hosted fixture goes red if DSH
removes one. An upstream request for a public, validated
select-for-this-session entry point is queued. (2) Validation is DSH's
public core resolver (llm.resolveCallConfig), taken at the point of
use, not injected: an unknown provider, an adapter-rejected model or
an unsupported effort fails at open before anything is committed. A
valid but unadvertised route is accepted, so a mistyped model that a
permissive adapter accepts now fails at the lane's first request
instead of at open; an empty model is an error instead of a silent
fallback. (3) Proof: the profile patch is byte-identical after open,
after a completed turn and after shutdown in every install cell, and
the same proof run against the published pre.20 must fail on changed
bytes, which keeps it from passing vacuously. Unchanged and stated:
the selection is committed before permission_mode is validated, and a
failed option-bearing open leaves the created session behind. Version
0.1.0 per D-051.

Accepted for merge 2026-10-11 (sessionbus/sessionbus-dsh PR #67 squash
826a29427d93150e995dec33f71685f913ebbe0f; hosted run 38162254589 at 0b065ab: 17 jobs). Reviews by an
opus agent at 247575c (fix as ruled; the missing-seam message could
itself fail on a version lookup; one behaviour change understated;
the failing first control not executable) and 0b065ab (verified);
CodeRabbit read at each head. Packed candidate 1fb8e005...4be55,
version 0.1.0; plugin.cjs changes for this item only, installer,
launcher and bin unchanged from W-125. Not released: host proof
per D-049 and D-051 of the packed candidate on a global install and
on the dsh host's project install (in-place upgrade of its pre.20
lane and web profiles with the owner's rows byte-identical, and an
option-bearing lane leaving the profile patch unchanged), then the
tag v0.1.0 and the registry check.

Released 2026-10-11 as @sessionbus/dsh 0.1.0, W-125 and W-126
together: tag v0.1.0 at 826a294, release run 38178927543, npm `latest`
(moved from 0.1.0-pre.2 by the publish), the first plain version per
D-051. Registry integrity sha512-56M+2KGl...gMTQ== and the published
archive byte-identical to the proven one (1fb8e005...4be55, plugin.cjs
f6e7d925...).
Host proof of the packed candidate before the tag (D-049): packet
dsh-host-sessionbus-010/20261011T204039Z (manifest 0a4b4cf8...83d6,
167 files); an opus agent read it against the brief and re-measured
the live host: verified with stated limits, no candidate defect.
Measured by the verifier on the dsh host (real home, project install,
permanent daemon): the published pre.20 lane and web profiles were
upgraded by the two README commands alone, three DSH plugin operations
per profile; the lane patch differs from its snapshot in one
installer-marked line, the web patch kept its bytes, inode and mtime,
and the owner's provider and default-model rows are byte-identical in
both; a second installer run wrote nothing; home, the five other
profiles and the daemon configuration identical; the owner's web
process untouched. The lane patch was not written after the install at
all, while native logs show lanes that ran with a requested effort and
a later lane with no options on the unchanged default. The builder's
daemon-side steps were declared, not captured, so the architect
repeated them through the permanent daemon with every call recorded:
describe 0.1.0, a lane with effort only and a lane with model and
effort, exact replies, the patch's hash, inode and mtime identical at
six points, roster clean; the verifier confirmed this from the raw
call records and the two native logs.
Stated limits. A refused option-bearing open leaves one empty session
directory and its worker exits 0 (no log, selection, request or turn;
same as pre.20; DSH's session list skips a directory without a log and
never removes one); carried to W-128. The lane runtime oracle ran in a
builder-booted process against a fixture daemon; the upload-refusal
control would pass with any provider. The own web instance's native
wake and reply are measured; its exit status is the driver's own and
its roster row is builder-recorded, as is the refusal code. On the mac
the real global DSH install ran the README install, runtime oracle,
round trips, the ten option cases and uninstall in 27 seconds with a
private home, private pnpm configuration and protocol fixture daemons,
relayed as text, the pnpm version not recorded: an in-place upgrade on
a global install and product launch by a released daemon there are not
proven. Three harness stops, none a plugin defect. After the publish
the dsh host's two profiles were re-added from the registry by a
script that saved every command and bus call as it ran (packet
20261011T222041Z-registry, manifest 756acc88...7a3c; a first attempt
stopped before any change on a capture limit). Verified on the live
host: both manifests name exactly 0.1.0 with the published integrity,
nothing references the tarball, the installers wrote nothing, both
patches keep hash, inode and mtime, and a lane opened with no options,
sent one message while idle, answered on the default.

Host note 2026-10-12. On the dsh host the `sessionbus-dsh` command
the daemon launches comes from the owner's home project, which still
held the plugin at 0.1.0-pre.11 (launcher byte-identical to 0.1.0's).
On the owner's word it was updated to 0.1.0 by one exact-pin add with
pnpm 10.28.1, the version that built that project. Verified on the
live host by the opus verifier, with stated limits: the manifest
differs only in the plugin's version; the lock only in the plugin,
its kit and the old upload helper; the home copy is the proven
archive and is the one the daemon's PATH selects; the Gemini CLI in
that project is not relinked; profiles, patches, daemon and the
owner's process untouched; one lane through the daemon completed.
Found by the verifier and absent from the builder's account: 44
other bin wrappers were rewritten with identical bytes, and pnpm's
install record lost its note that dsh-subprocess-local's install
script had been skipped, a consequence of --ignore-scripts. Two
lessons: a lockfile-only rehearsal on a bare copy did not predict the
real add, which reuses the installed context, so the builder's
byte-equality guard stopped a correct result; and `gemini --version`
loads the owner's settings and runs cleanup before it parses its
flags, so it was run only under a private HOME.

### W-127 dashi: a fresh profile reaches a working model from inside dashi — status: open (owner dsh-exec, after W-124)
DSH 0.2 keeps provider and default-model settings in each profile's
patch, and its one-time import of the old global settings file lands
in whichever profile boots first, or in none. A dashi profile created
by the documented install therefore starts with no provider of the
user's own: on the dsh host on 2026-10-11 the owner's local model was
absent from dashi although the web profile had it. Start with a
survey, no code: what dashi shows today on a fresh profile without a
usable provider; which native interfaces exist to add a provider, a
credential and a default model from a terminal (config editor,
credentials service, provider login methods, the default-model
service). Bar: Claude Code's first run. Acceptance: a user with a
fresh dashi profile gets to a working model without leaving dashi and
without editing YAML by hand, through DSH's own writers only (dashi
stores nothing); whatever cannot be done that way is named as a DSH
gap and reported upstream. The README states the per-profile fact in
one sentence. Consequence analysis first.

Amendment 2026-10-11 (design, after the builder's survey). DSH has
every writer needed and dashi may call them directly: profile settings
(ctx.settings.mutate), credential references (ctx.credentials.set),
registered login flows (ctx.authorization.begin) and model selection.
What is missing is a terminal surface, so no native gap is claimed for
writing. Scope: the known-provider path only, meaning DSH's stock
route, its registered login flows and its configurable catalog
providers. A custom endpoint form is a separate backlog item; against
the bar it is not a gap, and `/config` or the web Models page do it
today. Readiness uses two native facts and nothing inferred: a turn
that failed with MISSING_CREDENTIAL, and a route's declared credential
reference reported as not configured. An advertised model is never
treated as authenticated. Surface: one action line on that failed
turn and one notice at start, neither blocking; in `/model`, "Set
credential" for a route with a declared reference (masked entry) and
"Add provider" for a dormant catalog entry (its addressed settings
subtree, then its credential or login flow); then the existing
picker. No wizard, no onboarding flag, no stored state. One path for
the default: selectModel as today; dashi reports the selection, not a
durable-default receipt. Profile and credential writes are separate
commits, reported truthfully when only one succeeds and never
compensated or replayed; replacing a shared reference needs a
confirmation naming it; a failed prompt is never replayed. Proof needs
native completed turns against an endpoint that requires the key.
Upstream request, not blocking: provider readiness and login-flow
metadata on the Host seam, which today only the web client computes.

Amendment 2026-10-11 (implementation). One new file,
packages/dashi/src/model-setup.ts (157 lines), and one new peer,
@deepseek-ai/schemastery, to read the role a settings field declares;
the lock gains that one importer edge. The peer on dsh-llm-pi-ai
allowed during design is withdrawn: it rewrote the lock (zod 4.6.5,
+43/-144), so after "Add provider" dashi offers DSH's registered
sign-in list unfiltered instead of naming the provider's own flow.
Writers are DSH's alone: credentials.set, settings.mutate with the
section revision, authorization.begin; selection stays selectModel.
A provider with no known settings address or no single key setting
gets no claim and no log line; only a native read that threw is
logged. Outcomes as ruled: a cancel after the provider was saved says
so and that sign-in was cancelled; a rejected key write stays
sanitized and unconfirmed; another sign-in failure shows DSH's own
message, as /login does. The picker reopens from the existing
settlement continuation, so a catalog error cannot replace a write
receipt. Changed existing behaviour, both stated: an old /login
completion no longer closes the UI of a newer root, and the
launcher-parity test compares the frame that carries the notice. A
renderer defect found on the way is fixed: a question with more
choices than rows now windows them. Twelve native cases run real DSH
packages against a loopback endpoint that requires a generated key;
the key value is absent from session events, terminal output, the
export and every regular file of the private DSH home except DSH's
credential document.

Accepted 2026-10-11 (antst/dashi PR #299 squash ff05a9ef9f1d4af687da203761ad9c551b0c2bd2; hosted run
38179093632 at ca4fa81: both gates, ten Linux and nine macOS install
rows, macos-gate 17m10 of its 20 minutes). Reviews by an opus agent at
4cf8956 (accept with fixes: a cancel after "Add provider" reported as
an unconfirmed write with an internal code; a red macOS gate through a
frame race; two assertions that could not fail), at f84a5a6 (five of
six items verified by mutating the built product, each new control
failing as it should; three strings left) and at ca4fa81 (strings
only). Not released: rides in dashi 0.2.0 (D-051) with the plugin
pinned at 0.1.0.

### W-128 plugin: a failed lane turn carries its native reason — status: open (owner codex-roller, after the 0.1.0 release)
Found in the W-126 review on 2026-10-11. When a turn fails after the
user message is bound (a provider error, a missing credential, a model
id the backend rejects), the record a lane owner collects is outcome
failed, native_stop_reason error and an empty result: plugin.cjs
renders the error text only for a turn that ends before the message is
bound (:270-274). The lane's owner cannot tell why it failed, and
W-126 routes one more class of error there (a mistyped model accepted
at open). Deliver: the terminal record of a failed turn carries the
native error code and message DSH reports for that turn, through the
existing record shape, with no secret and no host path. Consequence
analysis first: what the kit's record allows and what DSH's turn end
exposes. Failing-first: a replayed backend error on the first request.
Ships as 0.1.1.

Amendment 2026-10-11 (from the verification of the 0.1.0 host proof).
The same change also carries: (a) fully specified open options are
validated before the session is created, so a refused open leaves
nothing; where DSH offers no way, what remains is stated in the
shipped README (today a refused open leaves one empty session
directory and its worker exits 0; DSH's session list skips it). The
builder argues whether that worker should exit non-zero, and
considers DSH's Workspace registry, which can archive a session.
(b) README: `dsh plugin add` prints pnpm "missing peer" warnings for
the DSH packages and exits 0; say that this is expected and what a
real refusal looks like. (c) A hosted upload-refusal assertion that
fails when the provider is not the plugin's own; the current control
passes with any provider. (d) release.yml loses its prerelease branch
(D-051); a tag that is not a plain version fails. (e) The mac
global-install procedure used for the proof lives only on the side
branch proof/host-global-010: it lands in the repository, recording
the pnpm version and store setting and including an in-place upgrade
from the last release, or it is dropped and the branch deleted.
Proof rule for this and every later item: a bus call an item depends
on is made by a script in the packet, or its raw request and raw
result are saved at the moment of the call; a flag the harness wrote
for itself and read back is not an observation.

Amendment 2026-10-12 (design, after the builder's consequence
analysis). Privacy: the words "with no secret and no host path" above
are withdrawn. DSH's error message is not a sanitized contract and a
pattern filter would promise what it cannot deliver, so there is no
redactor. The plugin copies exactly two native fields, code and
message (no stack, cause chain, details, headers or request ids), on
one line, bounded at 1024 bytes with a visible truncation mark; it
adds nothing of its own and says in the README that the text is DSH's
own error for that turn. The lane's owner drives that session and
already receives the worker's raw stderr tail on a refused open
through the kit: the same boundary, stated. A safe public error
surface is an upstream request. Partial assistant text is kept and the
diagnostic separated; a terminal is immutable against duplicate
events; nothing is retried. Validation moves ahead of creation for
every session-independent check, the permission preset name included,
and for a fresh open with an explicit model through one public
resolver call; an effort-only fresh open is validated against the
profile default before creation if DSH offers a public read of it,
otherwise the residue stays and is documented. No archive through the
Workspace registry: it writes a durable tombstone and deletes nothing.
A worker whose Open was refused exits 1, decided only after the
refusal has been sent, never for a describe-only worker or a lane
whose turn later failed; first the builder states what the released
daemon does with that exit status. The upload-refusal assertion
observes the provider's identity before the refusal, with the stock
provider as the failing control. The plain-version check is one script
the release workflow calls first, tested directly, and the workflow
gains the payload check of D-052. The mac side procedure is dropped;
instead the hosted global-install rows gain an in-place upgrade from
the last published release if they have none.

Amendment 2026-10-12 (after the builder's reading of the daemon). The
exit-1 change is withdrawn. The released daemon (v0.5.12,
bus/internal/daemon/lane.go) keeps the worker's spawn_failed, closes
the wire and sends SIGTERM to the worker's process group, waits for
the exit and returns one spawn_failed whose data carries the observed
exit code; DSH's own SIGTERM handler requests exit 0 and the first
code wins. A worker that tried to exit 1 would report 0 or 1 by race,
and forcing it would need a signal handler or a timer. The caller's
answer is the single spawn_failed with DSH's reason; the exit code in
its data is the worker's shutdown status after the daemon stopped it
and says nothing about the refusal. The README says so. An
effort-only fresh open is validated before creation against DSH's
public read of the default selection
(ctx.agentDefaultModel.currentSelection), which the controller itself
uses for a fresh session; the check at commit time stays. Publishing
a prepared archive keeps provenance under the trusted publisher per
npm's documentation and a dry run; the first real attestation is the
0.1.1 release, ordered so that nothing public exists before the
archive check has passed. The hosted global rows were fresh installs
only and gain an upgrade in place from published 0.1.0.

Accepted for merge 2026-10-12 (sessionbus/sessionbus-dsh PR #68 squash
64d445fc68c24f9ca4223c85852820f9542c5637; version 0.1.1). A failed lane turn's record carries DSH's own
code and message on both association paths, one line, every control
character and line separator replaced by a space, code at most 128
and message at most 1024 bytes with a visible mark, partial assistant
text kept; nothing else is copied and nothing is claimed to be
sanitized. Session-independent checks, the non-public seam's presence
included, run before a session is created; a fresh open with a model
or with an effort alone is validated before creation, so a mistyped
option leaves nothing; lanes opened without options behave as in
0.1.0. The upload-refusal check observes the provider's identity
first and the stock provider fails it. The hosted global rows upgrade
in place from published 0.1.0. release.yml per D-052: one validator
script, plain versions, an annotated tag with exactly one lowercase
hash line, npm 11.12.1 pinned for the pack, the checked archive
published with provenance before the GitHub release, an existing
version's integrity compared, only a documented not-found read as
absence. Reviews by an opus agent at 76e4a0f (accept with fixes: the
seam check ran after creation; a cancellation check changed
no-option lanes; a bound test that could not fail), d835d02 (eleven
items verified, 23 mutations, none surviving) and b330f4f (seven
unshipped items; the archive unchanged). Hosted run 38238897002 at
b330f4f: 17 of 17. Packed candidate aec194b2...a101 (npm 11.12.1),
plugin.cjs cff35198...; against 0.1.0 only README.md, package.json
and plugin.cjs differ. Stated: DSH's message can itself carry
sensitive or path text; a result over the kit's 1 MiB frame becomes
an unavailable record; a default or capability change, a
cancellation or a storage error between validation and commit can
still leave a session behind; the workflow pins the Node 22 line,
not an exact release, so a changed compressor would stop a release at
the checksum step. Not released: host proof of the packed archive on
the dsh host's lane profile, then the tag with the archive's hash
line.

Released 2026-10-12 as @sessionbus/dsh 0.1.1: tag v0.1.1 at 64d445f,
release run 38308827528, npm `latest`. The first release under D-052:
the annotated tag's message carries the proven archive's hash line and
the workflow published that archive (aec194b2...a101, plugin.cjs
cff35198..., integrity sha512-5cPs1dJ6...Z5cUQ==), with a signed
provenance statement (SLSA v1) on the registry. Ops checked the tag
locally with the workflow's own validator and pack check before the
single push; the runner reproduced the archive under Node 22.23.3.
Host proof before the tag (D-049), on the dsh host's lane profile,
real home and permanent daemon; five packets under
dsh-host-sessionbus-011, the last 20261012T185642Z-continuation
(manifest 636dce6c...0416). An opus agent re-measured the host and
replayed every script against its captures: verified with stated
limits, no candidate defect. The profile was upgraded in place from
the registry 0.1.0 by the two README commands; the patch has not been
written since 2026-10-11 and the owner's rows are identical; web
profile, home project, other profiles and daemon untouched. Through
the daemon: a lane with no options and a lane with effort only
completed on the default; an invalid effort, an unknown provider and
a nonexistent model were each refused with DSH's reason and left no
session directory, the residue 0.1.0 left. The failed turn with its
reason was observed once and by accident: during the proof the
owner's model server was unreachable for 80 minutes, and the lane's
turn came back as a done record, outcome failed, with DSH's code
TRANSPORT and message on one line; the native log shows the relay
message bound inside the turn, so it took the new branch, where 0.1.0
returned an empty result. Stated limits: no global-install or mac
part (installer, launcher and bin are byte-identical to 0.1.0; the
hosted global rows upgrade in place); a provider's long or multi-line
message, the partial-text form and the ack of a failed record were
not seen on a real host; the lane's manifest and lock were not saved
right after the add, bounded by their birth times and DSH's three
operation records; the daemon's key and environment files compared
by metadata only. Five stops: three in the proof's own script (a
parser resolved from the wrong place; a count of user messages that
ignored DSH's two context messages; a roster predicate that took a
self-closed lane's resume row for a live lane), one preflight hold,
one for the model server; none a plugin defect. Found on the way, for
the next plugin item: a refusal's stderr tail can carry a first line
from the kit ("sessionbus connection closed") before DSH's reason.

Rollout on the dsh host 2026-10-12, after the publish, on the owner's
word for the web profile and his home project: the lane profile, the
web profile and the home project's copy were each re-added at 0.1.1
from the registry (nine packets under dsh-host-sessionbus-011, from
20261012T220326Z-registry-lane to 20261012223604Z-registry-final-
closure). The opus verifier re-measured the host: lane verified; web
and home verified with stated limits; no defect in the package. All
three hold the published bytes; five writing commands in all (an add
and an installer exec per profile, one pnpm 10.28.1 add in the home
project, no install script run); both patches, the daemon and the
owner's web process untouched; in the home lock only the plugin's
record, snapshot and importer edge changed, and the Gemini CLI there
is not relinked. Lanes through the daemon completed after the lane
and the home step; in the latter the launcher the daemon started was
read from the worker's command line and is the home 0.1.1 copy.
Limits: the web profile is installed, not exercised (the changed
code cannot run in peer mode, and the owner's server loads 0.1.1 at
its next restart); no script run of the home part ended in a pass,
its seven stops all being the proof script's own, so the result
rests on three packets read together and the verifier's
measurements; pnpm's install-state file changed in its timestamp
only, shown by the verifier.

### W-129 dashi: the macOS gate runs at 17 of its 20 minutes — status: open (owner dsh-exec, before the next item that adds PTY cases)
On 2026-10-11 macos-gate took 16m05 (5e6c3b0), 16m42 (f84a5a6) and
17m10 (ca4fa81, a strings-only change): the run-to-run spread is
about half a minute and the margin under the limit is under three.
The limit is not raised (ruled in W-124). Deliver: measure where the
time goes per spec file on the hosted macOS runner, then the smallest
change that restores a margin of at least five minutes, most likely
the same suite split by file across two macOS jobs, each with the
full setup and both required. No test dropped, skipped, retried or
moved to Linux only. Consequence analysis first.

Amendment 2026-10-12 (design, after the builder's measurement). Per
spec file on the hosted macOS runner the whole budget is one file:
profile-pty.spec.ts, 120 sequential cases, 908, 936 and 971 seconds
in the three runs; first-run-model-pty.spec.ts takes 64 and every
other file at most 4. Two jobs are therefore not the smallest change.
Ruling: that file is split into two physical specs at an existing
boundary (59 and 61 cases), same names, assertions, waits, timeouts
and order within each, the common fixture in one test-only module,
each spec with its own fixture and private homes. Nothing else
changes: no Vitest projects, no second job, no workflow or check-name
change. Proof: the multiset of 356 test names identical before and
after; three hosted runs at the same head with per-file timings,
macos-gate at or under 15 minutes in each, Linux no slower, no new
failure. If the runner's cores do not carry two such files at once,
the builder stops and returns with the numbers and the two-job shape;
no bound is raised and no retry added.

Accepted 2026-10-12 (antst/dashi PR #304 squash 7419a109ca6a3843f32da858b034debcd706f2e8; three test
files, no source, workflow or bound change). profile-pty.spec.ts is
split at an existing boundary into two specs of 59 and 61 cases with
the fixture in one test-only module. An opus agent compared the old
file with the new ones statement by statement (107 statements, the
describe body byte-identical, 356 collected names equal as a
multiset) and found each spec isolated in its own forked process and
no dependence of the second half on the first. Hosted run 38213993300
at 6277230, measured three times: macos-gate 9m19, 10m46 and 10m32
(17m10 before), Linux 9m56, 10m06 and 10m03, 356 of 356 each time,
the two specs overlapping for the whole of the shorter one. On macOS
the second spec is now the critical path; new PTY cases belong in the
first until the lanes meet. Two jobs of the last attempt were red and
were not re-run: preview (pkg.pr.new answered a server error, a third
party) and install-layouts-macos / G-pnpm11 (W-132); neither can be
reached from the three changed files.

### W-130 dashi: the macOS P-pnpm10 install row failed once with EINVAL — status: open (owner dsh-exec, cause first)
On 2026-10-11 the row install-layouts-macos / P-pnpm10 failed on the
ledger-only PR #301 (run 38181415835, job 114597523641), on code
identical to the head where it had passed an hour earlier. In the
alpha.1 baseline leg, `pnpm add --save-exact
@deepseek-ai/dsh@0.2.1-alpha.2 @antst/dashi-launcher@0.2.0-alpha.1`
exited 234 with `EINVAL: invalid argument, open` on the launcher's
package.json inside the project's node_modules. The row was not
re-run. Deliver the cause: pnpm 10 on the macOS runner (a known
defect, with its issue), our harness (two writers into one project or
store), or the runner image; then the fix or the upstream report. A
retry is not a fix. If a user can hit it with the README commands,
the README says what to do.

Amendment 2026-10-12 (after the builder's read-only report). Not
localised: the failed and the earlier green row have the same runner
image, Node, pnpm 10.28.1 and cache; harness, workflow, lock and
launcher are identical; commands run one at a time; no known pnpm
issue matches an EINVAL on open of a package.json. The failing step
is one no user performs: the row reuses one project across phases, so
the alpha.1 leg turns a file-installed candidate launcher into a
registry-installed one. Ruling: (1) one bounded reproduction attempt
on a throwaway branch, the launcher-only transition 200 times in one
macOS job with full capture on the first failure, no retry; if it
reproduces, a pnpm report with the reproducer. (2) Each baseline
phase starts in its own empty project, after the builder states what
that loses and costs. (3) The acceptance harness saves path metadata,
the resolved store and the manager's debug log when a package-manager
command fails. The item closes for the 0.2.0 release when the failure
is reproduced and reported, or not reproduced in 200 with (2) and (3)
merged and the one occurrence recorded as unexplained.

Amendment 2026-10-12 (a second occurrence, found in review). The
EINVAL is not a pnpm 10 matter and the heading above is too narrow:
four minutes before the P-pnpm10 failure the develop push run
38181238927 at ff05a9e failed in row P-pnpm11 (job 114597086228,
22:56 UTC) at the same step with the same error on the same file. Two
runners, two pnpm majors, one transition, one short window; never
before and not since. The rulings stand.

Result 2026-10-12: not reproduced. Run 38214231288 (throwaway branch,
never merged): the launcher-only transition, candidate file then
published alpha.1, 200 times in one macOS job with pnpm 10.28.1, one
warm private store and a fresh project each time, all exit 0. Stated
differences from the failing rows: no DSH closure in the project and
no PTY work before the add. The two failing logs side by side: same
runner image, two runners, 3.5 minutes apart, the same reused-project
transition after successful turns; pnpm 11 prints the stack
(readPackageJson from removeBinsOfDependency from
removeDirectDependency), so pnpm failed reading the old file-installed
launcher's manifest while removing it as a direct dependency, in an
add that also links the DSH closure, which the lighter probe did not
have. Cause inside pnpm not established; a pnpm report is drafted for
the owner's decision.

Amendment 2026-10-12 (cause, found while the pnpm report was being
checked). In pnpm 10.28.1 and 11.18.0, the versions the rows pin,
removeDirectDependency starts the read of the old dependency's
manifest and the removal of that same directory entry together
(pkg-manager/modules-cleaner/src/removeDirectDependency.ts:21-25 at
v10.28.1; pnpm11/installing/linking/modules-cleaner/src/
removeDirectDependency.ts:22-26 at v11.18.0); the removal is a rimraf
and the read tolerates only ENOENT. The two Promise.all frames of the
captured stack are these calls. pnpm PR 16415, a lint port merged
2026-09-30, happened to make the read finish first; that is in
11.28.3 and later, while 11.28.2 (the latest-11 tag today) and every
10.x through 10.34.7 still start both together. That this race
produced the EINVAL on APFS fits every observation and is not itself
demonstrated. It runs whenever a direct dependency is replaced or
removed, so also in the upgrade legs that remain and in a user's
upgrade by the README: phase-owned projects remove one such
replacement per row, not the exposure. Rulings: the pnpm report
becomes a report of that race with a request to carry the reordering
to 10.x; the install guide gains one factual sentence (pnpm 10.x and
11 before 11.28.3, macOS, absent from 11.28.3 on) with no recovery
claim; a row failing with exactly this signature (exit 234, EINVAL on
open of a direct dependency's package.json, and where printed the
removeBinsOfDependency frame) may be re-run once with run and job ids
recorded, the only exception to the no-rerun rule; and the rows'
pins, pnpm 11.18.0 from July and 10.28.1 from January, become their
own item.

Accepted 2026-10-12 (antst/dashi PR #306 squash b62ad83344fd97d69ec345b14f0d7beec97b1c36; four test
files, no product, README, lock or bound change). Each phase of a
project row starts in its own empty project; the command runner is an
awaited spawn in its own process group with the unchanged 180-second
deadline; a package-manager command whose outcome is not the expected
one leaves path metadata, the resolved store and the manager's debug
log, and a timed-out one the group's process tree and DSH's
plugin-manager log, taken before it is terminated; an expected
refusal does no diagnostic work; a timeout, a spawn error or a signal
is fatal whatever was expected. The first head failed four rows: with
pnpm 11 and 12 the build approvals are a per-project setting that the
shared project had let the baseline phases inherit, so the README's
approval step now runs in every project of those rows. Reviews by an
opus agent at 0bf4bba (accept with fixes; no path by which the change
hides a failure; three behaviours the unit spec did not pin) and at
852a143 (accept; 27 mutations, the three earlier survivors caught).
Hosted run 38240771587 at 852a143: 23 of 23, 363 tests on both gates,
all 19 rows; 15 rows issue the same commands with the same exit
statuses as before, P-pnpm11 and P-pnpm12 the same plus six control
commands. Stated: project rows no longer replace a file-installed
launcher by an older published one, nor carry manager metadata across
baselines; the npm project row costs two more full installs (24 s
each on Linux, 40 to 47 s on macOS). The item closes with the cause
recorded above, the capture merged and the pnpm report posted (see
Upstream reports).

### W-131 dashi 0.2.0: the first plain release — status: open (owner dsh-exec, after W-129 and W-130)
Per D-051 and D-052. Four packages at 0.2.0, exact siblings, the
plugin pinned at exactly 0.1.0 with its registry integrity asserted;
every lock change listed and explained, none by hand. README install
and upgrade fences at 0.2.0, historical baselines untouched; the
provider paragraph in a user's words ("Choose a model and provider
shown by /model. If you use your own provider, configure it with
/config or DSH's Models page before starting dashi with it."). The
changelog gathers W-124, W-127 and the pin. release.yml: plain
versions only, `latest` for all four, no prerelease branch, the
payload check of D-052. Order: release-prep PR reviewed and merged;
four archives packed from the merged head with hashes and file
inventories; D-049 proof of those archives on the dsh host's project
install and on the mac's global install under the architect's
briefs, every command and bus call captured by a script in the
packet; then the tag with the four hashes in its message; then the
registry check and the literal README install and upgrade on the
same hosts. A failure after the publish is answered by a patch
release.

Amendment 2026-10-12: W-132 joins the items that must close before
the release-prep branch, by the same standard as W-130.

Release preparation accepted 2026-10-13 (antst/dashi PR #314, squash
311d4c5f65cf422ca3e901ca96741e789988ac72, five commits reviewed at
bb24432). The four packages are at 0.2.0 with exact siblings. The
plugin pin is 0.1.1 (W-128), not the 0.1.0 named above, with the
published integrity in the lock; the lock changed in thirteen lines,
all on the plugin. The release workflow has no prerelease branch, no
input and no carried artefact: a preflight job checks the plain
version, packs, checks the tag's four lines and gates the verify job
and both install callers; the publish job packs and checks again
before any npm or gh action, reads all four packuments and every
exact external dependency named by the packed manifests before the
first upload, publishes provider, core, app, launcher to `latest`
and creates the GitHub release last. One script packs for the
workflow, the Linux gate and the operator: it removes the two
generated lib directories, builds, packs, and refuses any toolchain
but Linux x64, Node 22.23.3 and the workspace pnpm. RELEASING.md at
the repository root is the operator procedure.
What the review found (an opus agent at 4327b3a, 9a42898 and
bb24432; accept at bb24432). (1) The app archive was not
reproducible. pnpm 11.7.0 writes a package's `workspace:`
dependencies in the order in which its reads of the sibling
manifests finish (pnpm issue 10167, fixed by pnpm PR 13751), so one
commit packed to two archives that differ in the order of two keys.
The builder's one-time comparison of host and hosted hashes caught
it: ten packs split eight to two, the reviewer's 180 split 95 to 85.
The workspace pnpm moved to 11.28.5, where 120 packs give one hash;
the pack refuses a packed manifest whose dependency keys are not in
source order, and the gate packs three complete sets and compares
them. The lock did not change. Archive bytes depend on the pnpm
version (the LICENSE entry moved in two archives), which the
toolchain refusal covers. (2) The release step called `rg`, which
the hosted image does not have: a release would have published all
four packages and then failed, on every re-run too. It is grep now,
and the spec runs the step's own text with a fake gh on a restricted
PATH. (3) All four scripts exited 0 without doing anything when
started through a linked path; the spec did not pin the
plain-version rule; a 65-character hex line beside four valid lines
was ignored; a pack over a stale build would have shipped it. All
corrected, each with a control that fails without the correction.
(4) pnpm replays an upload after a 5xx answer. The upload command
alone now runs with `pnpm_config_fetch_retries=0`; the reviewer
measured it with the real pnpm 11.28.5 through the publish script
against a local registry: one PUT, exit 1, and the re-run reads the
registry before it uploads.
Evidence: hosted run 38328906328 at bb24432, 23 of 23, both gates
with 56 and 331 tests, all 19 rows. The four lines are equal from
the builder's host, the reviewer's clones and rebuilds, and the
hosted gate step:
5d22fff1d595ea7b73634b56fda0b4b739124101cebc6185c21df384d6c57d0e  antst-dsh-file-uploads-none-0.2.0.tgz
fd987bcbd8ca09faa05b7dc06216910e68a5d7be2600310202120b355cc8d98a  antst-dashi-0.2.0.tgz
67c230bb6db26a9bf24503f3eae2a1b86541792d12a61fac4a08de06474c8dae  antst-dashi-app-0.2.0.tgz
4d7154ff3ad5f99c2e468021c0682d2275fad115b608afe2a296ef86272f10ce  antst-dashi-launcher-0.2.0.tgz
Stated limits. The trusted-publisher upload with pnpm 11.28.5 is
first exercised by the tag run; earlier releases uploaded with
11.7.0. A tag on a commit that is not on main is publishable and tag
signatures are not checked, both as before. The spec does not run
the real pack, real git or the Node and platform refusals. An
earlier local gate at 072b468 failed the renderer bound once (36.5
ms against 25) and was not reproduced. Four review points that touch
no archive are W-136.
During the review the reviewer's harness twice started the machine's
real pnpm on a publish command aimed at the public registry. Both
ran under a private home with no configuration and no credential and
stopped at the provenance check before any request; the registry
shows no 0.2.0. Since then every case that can reach an upload runs
in a loopback-only network namespace with a private home, an empty
user configuration and the registry address confirmed by the client;
that is now a condition of every brief that touches a publish path.
The item stays open for the host proofs (D-053), the tag and the
registry check.

Host proof on the dsh host, 2026-10-13 (D-049, D-053): verified with
stated limits by an opus agent that read the packet against the brief
and re-measured the live host; no defect in the candidate. Packet
dsh-host-dashi-020/20261013T013843Z (279 files, manifest
80757c82...d317). The four archives packed from 311d4c5 have the four
hashes above. Measured by the verifier: in both proof places the
installed files of the app, the core and the provider are byte-equal
to the archives, one copy each, the launcher likewise; @sessionbus/dsh
one copy at 0.1.1 with the published integrity; all 37 protected
paths of the owner's side unchanged in inode, time and hash, none of
his seven profiles booted, the daemon and his web process untouched.
Part F, a new user's first run: a private DSH home, the candidate
launcher installed alone in a proof project, the profile created by
the native install and add; the first prompt answered by DSH's
missing-credential result and the guidance toward /model, the masked
key question reached and cancelled with nothing typed, no replay;
the launcher's -g groups shown by the native command; exit 0 with a
resume instruction that names no install layout. Part U, the owner's
situation: a profile dashi-proof-up in the real DSH home, built by
the ordinary commands as his was (published alpha.2 app, dsh-codex
0.3.2 with the catalog override, a byte copy of his patch file) and
upgraded in place by the one native add: four package records
replaced and nothing else, the pre.20 plugin gone without a cleanup
step. Confirmed from the native logs: a real turn with the shell
tool on the owner's model server, the permission dialog allowed
once, one loop fire, a subtask round trip, a sender-labelled relay
waking the idle root, the typed /sessionbus turn; no lane.
Stated limits. Not shown: the candidate launcher against a profile
with a model; a real turn in the fresh profile; the owner's own
profile and lock (the fresh baseline resolved zod 4.6.7 and
resolve.exports 2.0.4 where his has 4.6.5 and 2.0.3); the registry
path without selectors; opening a migration-required session (its
row was read, at 120 columns ending in "migration..." and in full at
200); the group proof-b on the daemon's side. The wiring: two
parent-scoped selectors in the fresh profile's workspace file; in
dashi-proof-up all three overrides in package.json, because pnpm
10.28.1 ignores the workspace file's overrides when package.json has
its own (measured; see W-136).
Eight stops, none a candidate defect, nothing replayed: five were the
driver's guesses about labels, frames and a list field, one a frame
wait on /config, and two were the architect's brief, which assumed
that the daemon's roster and a direct send by session id ignore
groups. They do not: a root with no group in its environment or
profile joins only its own session group, so no peer can list or
message it until -g or /sessionbus-groups names one; the alpha.2
proof had a group in its environment. The verifier found the
brief's guards blind in three places and measured them itself: the
package contents of a hoisted profile, ~/.dsh/storages, and sessions
by id. Two shared files were written there: one group record for
the proof's root, and the schedule store, rewritten by /loop. From
the installed schedule service (one table per DSH home, loaded once,
rewritten whole on every change, nothing pruned) and the file as it
stands, the store held no other task and nothing was removed; a
task created on the owner's web page during those seven minutes is
the one case this cannot exclude (B-006). The packet holds the
owner's session list and his provider's identifiers in its frames
and is private to his account. Left on the host: dashi-proof-up with
its wiring, for the registry re-add after the publish; three
sessions in his history; the packet; working directories under /tmp.
The mac proof follows with a bundle that carries only the four
archives and a fixed driver.

Host proof on the owner's mac, 2026-10-13 (D-049, D-053): passed in
both parts. The pack script refuses anything but Linux, so the four
Linux-packed archives travelled with a fixed driver as a bundle on a
throwaway branch (three cuts; the third, 0a85b00, ran), cloned over
anonymous https and checked against its commit and manifest hash. The
driver carries the archives, one Node script, a terminal bridge in
Python's standard library and one vendored published file; nothing is
built or installed as a helper on the mac. An opus agent reviewed
each cut for safety before anything ran there. The first cut could
not work on a mac (/tmp is a link there and the path comparison
stopped at the first command) and pressed Enter on a permission
dialog unchecked; the second fixed that and the other points raised
and was found safe with conditions; the third raised the real turn's
bound from 120 to 600 seconds after the owner said that his model
server was overloaded and that slowness is fine, and the builder
found that a second, enclosing bound of 180 seconds would otherwise
still have cut it. The driver approves nothing: a permission request
is a stop with the frame recorded.
Run by the architect through a lane on the mac in a window the
daemon team opened, started detached so that no tool deadline could
cut it. Part F, a new user's first run in a private DSH home with
the candidate launcher: passed; graph 540 of 540 entries checked,
289 DSH records, none missing or wrong; the first prompt ended in
the missing-credential outcome and nothing was sent. Part U, a
profile dashi-proof-up in the mac's real DSH home built as the
owner's is there (published alpha.2 app, a byte copy of his patch
file; no dsh-codex on the mac) and upgraded in place by the one
native add under pnpm 11.18.0, with the two selectors in the
workspace file: passed; a real turn with the shell tool on his model
server, /model cancelled, exit. Packet on the mac,
dsh-host-dashi-020/20261013T085537Z-mac, 89 files, manifest
8e8dbbbd...9b46 (a27cdb0d...0c46 after Part F). Re-measured
read-only through the lane afterwards: the four archive hashes; the
installed app, core and provider byte-equal to the archives in both
places and the launcher in the proof project; one copy each, the
plugin at 0.1.1; the owner's dashi and web profiles, his global
shims and launcher, his credential store's metadata and his running
DSH process unchanged; in his real DSH home only the proof's one
session and its projection record are new.
Stated limits. The mac's packet was not read by an independent
agent: it holds the owner's provider identifiers and stays on his
machine; the evidence is the reviewed, hash-bound driver, its sealed
packet and the architect's own read-only measurements. The short
list on the mac was by ruling: no group item, no missing-dsh hint,
no /loop, /resume or /config. Left there: dashi-proof-up for the
registry re-add, the session, the packet, working directories under
/tmp.
Both proofs of D-049 for these four archives now exist. Before the
tag the release tree needs a complete green hosted run on both
platforms; see the amendment below.

Amendment 2026-10-13: install rows and a slow registry. The push run
at 997b71d (tree identical to the head that had passed 23 of 23 an
hour earlier) had six red install rows, and three more fell in the
two runs after it, every one `Command exceeded 180000 ms` inside
npm's, pnpm's or npx's own fetch of DSH, between about 03:22 and
04:06 UTC. The builder's read of the captures: clients waiting on
connections to registry.npmjs.org, pnpm's own warnings of a
36-second metadata request and archives at 2 to 39 KiB/s for
unchanged DSH packages, a same-command pass at 175 s beside a
failure, on two hosting locations; images, tool versions and the
532 installed versions identical to the green runs; service, edge
or path not localised. In green runs the same commands take 20 to
57 seconds. Rulings: the bound stays 180 seconds; no retry
mechanism; those rows stay red and are not re-run. One narrow
exception joins the EINVAL one: an install row that fails with
exactly that message inside a package-acquisition command, with the
client's own slow-request evidence or the same failure in other
rows of the same half hour, is reported first and may be re-run
once on the architect's word after the registry answers normally.
The operator pushes no tag while the release tree lacks a complete
green hosted run or while cold installs sit near the bound. The
same hour one preview job failed because its preview service was
unreachable; it gates nothing.

Released 2026-10-13 as dashi 0.2.0, the first plain release: the four
packages on npm `latest` (the `alpha` tag stays at 0.2.0-alpha.2).
main was fast-forwarded to 514b7fac8a4525c23011953c9fb8597cc605a452;
the annotated tag v0.2.0 there carries exactly the four hash lines
(D-052); release run 38381375736, 22 of 22 jobs on the first attempt:
the preflight and the publish job each re-packed the four archives to
the proven hashes, all nineteen install rows and the Linux gate
passed, and the four uploads went through in the order provider,
core, app, launcher with provenance, then the GitHub release. The
registry archives are byte-identical to the proven files; the app's
published manifest pins core and provider 0.2.0, the plugin 0.1.1
and roller 0.1.4 exactly. The upload through trusted publishing with
pnpm 11.28.5, a stated limit of the preparation, worked.
One thing was not resolved before the tag and the owner decided it.
The push run at 514b7fa (38373974104) ended red on the macOS gate:
the idle SIGTERM case of the shipped-profile terminal lifecycle
timed out at its outer 30 seconds with no trace of where, because
the helper waits inside it are 60 seconds on CI and cannot report
first. The ledger pull request's run at the identical tree was 23
of 23 green. The builder's read: the case normally takes 1.5 to 3.3
seconds there, so load does not explain it; the teardown path, the
six lifecycle cases and their helpers are byte-identical to the
published 0.2.0-alpha.2 with the same DSH and pi-tui; since alpha.1
the case passed 95 of 96 recorded macOS attempts and 98 of 98 on
Linux; no path in the case makes or waits on a network request. One
risk was named from the source and not observed: DSH's forced exit
five seconds after SIGTERM could come before dashi has restored the
terminal. The owner sent SIGTERM by hand to the candidate, saw it
exit at once, and chose to release and to track the timeout as its
own item (W-137). The red run was not re-run.
Next: the registry re-add on the two proof profiles, then, on the
owner's instruction of the same day, his own installations on every
host except the one he named as not to be touched.

### W-132 dashi: `dsh plugin add` did not return on the macOS G-pnpm11 row — status: open (owner dsh-exec, cause first)
On 2026-10-12 the row install-layouts-macos / G-pnpm11 failed once
(run 38213993300, attempt 4, job 114712113037) on PR #304, which
changes three test files the row does not use; the row had passed
twice at the same head. The fixture step `dsh plugin --profile dashi
add @deepseek-ai/dsh-llm-replay@0.2.1-alpha.2` printed pnpm's "Done
in 1.2s using pnpm v11.18.0" and did not return within the unchanged
180 seconds; the same command form had succeeded for the candidate
archive seconds earlier. Not re-run. This is the mechanism the README
tells users to run. Deliver as for W-130: one bounded reproduction on
a throwaway branch, the command 200 times against fresh profiles on
the same global pnpm layout, stopping at the first timeout with the
process tree, DSH's plugin-manager operation log and a Node
diagnostic report of the hung process (its active handles); if it
reproduces, a DSH report. The acceptance harness's failure capture
(W-130) also covers a command that times out. Closes for the 0.2.0
release when reproduced and reported, or not reproduced in 200 with
the capture merged and the occurrence recorded as unexplained.

Result 2026-10-12: not reproduced. Run 38228012722 (throwaway branch,
never merged): 200 fresh profiles on macOS with global pnpm 11.18.0,
each with the native install, the published dashi-app 0.2.0-alpha.2
and then the exact replay add under the unchanged 180 seconds; all
200 returned, median 1.6 s, longest 3.4 s. Stated differences: the
published app instead of the candidate archive, no sibling overrides,
no PTY work. The occurrence stays unexplained and the item closes
with the harness change that captures the process tree and DSH's
plugin-manager log before a timed-out command is killed.

Closed for the release 2026-10-12 by the stated standard: not
reproduced in 200, and the capture of PR #306 (b62ad83344fd97d69ec345b14f0d7beec97b1c36) is merged, so
a recurrence leaves the process tree and DSH's plugin-manager log.
The one occurrence stays unexplained.

Amendment 2026-10-12 (reopened: it happened again, and the capture
caught it). Develop's own run 38279578807 at b61ac84, with the merged
harness and the old pin 11.18.0, failed in macOS G-pnpm11 (job
114918200245): the same `dsh plugin add` printed pnpm's "Done in
2.3s" and passed the 180-second deadline. The record taken before
termination lists two live processes in the command's group, both
sleeping: the dsh process and its child, pnpm itself. pnpm 11.18.0
had not exited three minutes after reporting completion, and DSH
waits for it without bound. Why pnpm stayed alive is not in the
evidence; DSH's operation logs were empty. Not re-run. Next: whether
pnpm fixed a non-exiting install between 11.18.0 and 11.28.5; the
open descriptors of each live process added to the timeout capture;
where DSH waits without bound, as an upstream note. The 0.2.0 release
does not tag before it is known whether a current pnpm still shows
it.

Amendment 2026-10-12 (cause, from the capture and pnpm's own record).
A matching pnpm defect exists and was fixed: a fetch arriving late
recreates the worker pool after it was drained, and the idle worker
keeps the process alive after "Done" (pnpm issue 12297, fix PR 13226,
merged 2026-08-16, first shipped in 11.23.0; the shipped bundles of
11.18.0 and 11.22.0 clear the pool, those of 11.23.0 and 11.28.5 do
not). Both hangs were on 11.18.0, the rows' pin until W-133, and fit
it; the process tree cannot prove the leaked worker, so it stays the
fitting explanation. DSH's side, from its published code: the CLI
runs the package manager with inherited streams and no installation
timeout (dsh-plugin-manager lib/types/operations.js:325-334,
:383-394), so it waits for as long as the child lives, and the
operation logs stay empty for the same reason. Rulings: no further
probe (200 clean runs of the affected version proved nothing, so 200
of a fixed one would not either); the timeout capture also lists the
open descriptors of each live process; the install guide gains one
factual sentence; DSH's unbounded wait is drafted as an upstream
note. The item closes when that capture and sentence are merged.

Amendment 2026-10-12 (count corrected while the DSH comment was being
checked). There were three hangs on pnpm 11.18.0, not two: the third
is run 38279443230, job 114916347723, on the ledger PR #307, same
command, "Done in 1.9s", with the same two live processes in its
snapshot. Three in 32 macOS runs of that row on that version, none in
39 Ubuntu runs. DSH's README states the unbounded CLI wait as
intended ("stays unbounded for its operator to interrupt",
packages/boot/plugin-manager/README.md:102), and DSH's desktop build
moved its own pnpm from 11.7.0 to 11.28.5 between 0.2.1-alpha.1 and
alpha.2; two other users report the same hang on Windows in DSH
discussions 9261 and 8922 with pnpm versions that predate the fix.
So the upstream note is a follow-up comment on 9261 with two narrower
questions, not a request for a bound.

Accepted and closed 2026-10-12 (antst/dashi PR #310 squash e1c106ee94ef718def24910ff6a639ff771f1c16;
three files). When a package-manager command passes its deadline, the
capture now also lists, for each live process of the command's group,
the names of its open descriptors (lsof on macOS, /proc on Linux;
names and types only, bounded, taken before the group is terminated,
errors recorded, nothing on success). The install guide says in one
sentence that pnpm 11 before 11.23.0 can leave a finished add running
so that `dsh plugin add` appears to hang, citing pnpm's report and
fix, with no advice to interrupt and repeat. Review by an opus agent
at ffcb159: accept; the capture cannot change an outcome; 47
mutations, the new cases catching eight of the ten that touch them;
the sentence matches pnpm's record and does not say our hangs were
that defect. Hosted run 38288769312: 23 of 23, 365 tests on both
gates, the real lsof control on macOS. Stated: descriptors cannot
name a timer or a worker; the two-second bound on lsof is a TERM, not
a kill, and the process tree is written after the descriptor read, so
a stalled read would lose both (to be hardened with the next change);
on pnpm 11.28.5 the row has passed every run since the pins moved,
which is too few to conclude anything.

### W-133 dashi: the install rows test current pnpm releases — status: open (owner dsh-exec, after W-130, before W-131)
Found in W-130: the rows pin pnpm 11.18.0 (July) and 10.28.1
(January) while users install current releases, and the race of
W-130 is gone from 11.28.3. Ruling: install-layouts.yml pins the
newest published plain version of each measured major, exactly
(10.34.7, 11.28.5 and 12.12.1 on 2026-10-12), not the dist-tags,
which lag, and never a floating value; workspace tooling is
untouched. All 19 cells are re-measured on Linux and macOS: G-pnpm11
must still show the native-binding failure and then the documented
remedy, P-pnpm11 and P-pnpm12 the ignored-builds refusal and then the
documented denials in each project, P-pnpm10 plain. If a current
release behaves differently, the builder stops with the observation:
then the README is wrong for today's users and that is a ruling, not
a test edit. The install guide gains one factual sentence: pnpm 10.x
and 11 before 11.28.3 can, rarely, fail an install or upgrade on
macOS with EINVAL on a package.json through a race inside pnpm that
is absent from 11.28.3 on; no recovery claim. The handoff says what a
user on the dist-tag values gets that the pins do not test. Keeping
current: the builder checks the three majors at release preparation
and a changed pin is one small reviewed PR with all rows green; no
scheduled writer and no automatic repair.

Amendment 2026-10-12 (the rule corrected in review). "Newest plain
version of each major" is wrong for the major that carries the
`latest` tag: `npm install -g pnpm` and `pnpm@12` both install the
latest-tagged 12.11.2, since npm prefers that version when it
satisfies the range, and a row pinned to 12.12.1 no longer runs what
users get. Rule: each measured major is pinned to the version `npm
install -g pnpm@<major>` installs on the day, the latest-tagged
version where `latest` lies in that major, otherwise the highest
plain version of the major (10.34.7, 11.28.5 and 12.11.2 on
2026-10-12).

Accepted 2026-10-12 (antst/dashi PR #308 squash 5cc17b74921117043a83e5a51bb6006d856292ea; the workflow's
pins, one README sentence and a test delta in its own commit). The
rows install pnpm 10.34.7, 11.28.5 and 12.11.2, which a dry-run
`npm install -g pnpm@<major>` resolves to today with npm 11.12.1 and
10.9.8. Nothing the README documents changed with them: pnpm 11 still
fails a global install with the native-binding error and passes after
the documented setting; pnpm 11 and 12 still refuse the build scripts
in each new project with the same five names and accept the
documented denials; pnpm 10 installs plainly; no oracle, text, bound
or command was edited. The install guide names the pnpm read/remove
race of W-130 in one factual sentence. The expected-outcome
expression moved unchanged into the helper and is pinned by a
40-cell truth table; the capture's leader row is asserted. Reviews by
an opus agent at a1eb2e9 (accept; it showed that the pnpm 12 pin
12.12.1 was not what users install, which corrected the rule above)
and at a11510f (accept). Hosted run 38284396769 at a11510f: 23 of 23,
364 tests on both gates, all 19 rows. Stated: users on the
latest-10 and latest-11 tags get 10.34.6 and 11.28.2, which the rows
do not run and which still contain the race; two finer KILL
lifecycle behaviours of the capture helper are not pinned.

### W-134 plugin: a refused open's reason is not always the first line — status: open (owner codex-roller, analysis first)
Found in the verification of the 0.1.1 host proof on 2026-10-12. When
a lane open is refused, the caller's spawn_failed carries a stderr
tail. For an invalid effort it is DSH's reason alone; for an unknown
provider and for a nonexistent model it has two lines, the first
"sessionbus: sessionbus connection closed", then DSH's reason. The
first line comes from the kit through a part of the plugin unchanged
since 0.1.0 (plugin.cjs:640), so it is not new, but a caller that
reads the first line gets the wrong text. Deliver, analysis first:
where the line originates and in which cases; what 0.1.0 printed in
the same cases; whether the plugin, the kit or neither should order
or drop it; what a caller can rely on. No change before that.
Also carried here from the same verification, as known gaps of the
0.1.1 proof and not defects: a provider's long or multi-line error
through the bounds, the partial-text form and the ack of a failed
record were seen only in the repository's tests.

Amendment 2026-10-12 (design, after the builder's analysis). The line
is the kit's error text, printed by our plugin: its warning on a
worker that closes without having opened (plugin.cjs:424 through
:637-640), and the released daemon prepends captured stderr to the
worker's structured refusal (launch.go:101-114 at v0.5.12). Ruling:
after an Open the plugin itself refused, the close that follows is
expected and is not warned about; every other unopened close warns
as today. One transient fact, set where the Open callback rejects; no
filter, no reordering, no exit-status change. The daemon's merge
order is passed to its architect as a finding and is not ours to
change. The same item carries the maintained host-proof script: one
unshipped script in the repository, for lane and peer profiles only,
with explicit operations (archive upgrade, registry re-pin,
verify-only), one capture helper that writes every observation to
disk and returns a digest, the predicates that cost the 0.1.0 and
0.1.1 proofs their stops written once, and a replay test that runs
the same code against a recorded packet. About a dozen stops in two
releases were all in scripts rewritten per proof, none in the plugin.
The owner's home project is not a target of that script. Ships as
0.1.2.

Accepted and released 2026-10-13 as @sessionbus/dsh 0.1.2
(sessionbus/sessionbus-dsh PRs #69, #70 and #71; main
10301a1b60402798d87d1f460427d0a543ef8ed9; tag v0.1.2, release run
38376790704, npm `latest`; archive sha256 508485c5...ebaa, registry
integrity sha512-7ioCh0r8...BTmSQ==, byte-identical to the proven
file, with provenance).
The shipped change is ten lines: the Open callback records its own
refusal when the cancel signal is not aborted, and the unopened-close
warning is skipped only then. A rejection caused by the transport
closing still warns; a refusal and a close in the same tick may
resolve either way and that is stated. 41 open and turn rows give
byte-identical output on 0.1.1 and 0.1.2; against 0.1.1 only
README.md, package.json and plugin.cjs differ.
The maintained host-proof runner (unshipped) took five reviewed
heads. The architect's guide of 500 and 300 lines was a wrong
estimate, met at first only by long lines; formatted normally the
runner is 1066 lines and its test 900, under ceilings set on what
exists. Operation (archive, registry, none) and the acceptance lane
are independent explicit parameters; every input is checked before
the first tool call; a stop is terminal, sealed and names every live
lane; nothing is retried. The replay test runs the real observer and
the real row installer on a tree it builds.
Three corrections came from the real host, where a sandbox could not
show them. (1) Unopened files were compared on their whole lstat
record: 507 hard-linked package files with credential-like names sit
in the protected roots, and any install from the shared store moves
their link count and ctime. Equality is now on type, size, mode,
owner, mtime and inode; a same-size write with a restored mtime is
not seen for files that are never opened. Measured with pnpm
10.28.1: installs elsewhere move only link count and ctime. (2) The
first real run stopped after the upgrade because its fixed 60 s wait
expired on a turn that took 160 s on the owner's overloaded model
server ("slowness is OK"); the lane then retired itself and its
result was lost. The wait is now a required total in required
slices, a still-running turn has its own message, and the
continuation ran as operation none with a fresh lane. (3) The route
check required a reasoning effort that the profile's default row
does not carry; it is compared only when the row has one.
Host proof (D-049), verified with stated limits by an opus agent
that read all three packets and re-measured the host; no defect.
Packets under dsh-host-sessionbus-012: 20261013T030143Z-archive-lane
(the upgrade; manifest ba928e18...8f89), 20261013T083405Z-
continuation-lane (acceptance and refusals; 763fc408...551f),
20261013T093839Z-registry-lane (after the publish; aab43fe8...1db0).
The lane profile was upgraded in place from published 0.1.1; the
installer wrote nothing and the patch with the owner's rows kept
hash, inode and times through 21 snapshots. Acceptance lanes
completed on the unchanged default route with the marker and were
collected, acknowledged, closed and absent. Three refused opens
through the permanent daemon each returned spawn_failed with a tail
of exactly one line equal to the expected reason and left no session
directory and no worker. Against 0.1.1 on the same daemon the change
is shown by the unregistered-provider case, which had two lines
there; the invalid-effort case already had one, and the
malformed-model case has no 0.1.1 capture. After the publish the
profile was re-added from the registry: plain version, registry
integrity, no reference to the archive.
Stated limits. The upgrade step rests on the stopped packet alone.
The sliced wait ran one slice in both later runs. With no effort in
the default row the route check accepts any effort. A refused open
still reports exit code 0. A refusal whose frame cannot be written
loses its reason in both versions, and 0.1.2 prints nothing there.
The owner's web profile and home project were not touched; the home
copy stays at 0.1.1 because the launcher file is unchanged. Not
shown: peer mode on a host, refusals after session creation. The
continuation packet holds 913 MB of file bytes, thirteen copies of
one metadata map. Carried to the next change of the runner: three
test lines (a throw that is not on the last slice, a refused slice,
a short remainder), the effort compared with the provider row's own
default, one map per run instead of one per snapshot. For the
daemon's architect: status answers unknown_session for a lane whose
row is retained offline, while list by id still returns it.

### W-135 dashi: the renderer timing check runs alone — status: open (owner dsh-exec, before W-131)
On 2026-10-12 the local gate of the release branch failed one
unchanged case: the 200k-cell redraw p95 measured 36.5 ms against its
25 ms ceiling, every other metric of that run normal. Not re-run. The
builder's history over the retained gate logs shows the check within
a few milliseconds of its ceiling for days (23.2 ms locally, 25.5 and
44.4 on hosted runners under the scaled ceiling), and a measurement
shows our own gate as one cause: beside the two PTY suites' fixture
start-up the p95 rises by about a third (median 13.4 ms alone, 17.6
in setup, up to 20.8). The 36.5 ms itself was not reproduced and is
not attributed. Ruling: the gate runs the renderer timing-ceiling
spec in its own vitest invocation first and then the rest as today;
no bound, statistic or assertion changes; the same tests, each once.
The release branch then runs its gate at the new head, with the
failed log kept beside it. If the check fails again under isolation,
the statistic itself, one run's p95 on a shared machine, is the next
thing to question.

Accepted 2026-10-12 (antst/dashi PR #312 squash 52b2c544d1481b9574811d55a9136321d6ebfbf8; scripts/
gate.mjs only, six lines added and two removed). The gate runs
renderer.spec.ts in its own vitest invocation and then the suite
with that file excluded; the first invocation's failure fails the
gate and the rest is not run. The same 365 tests, each once (56 and
309, disjoint, equal to the base as a multiset); no bound, statistic
or assertion changed; `pnpm test` stays one invocation. Review by an
opus agent: accept; a missing first selection, a failing first spec,
a killed runner and a failing second spec each end without PASS, and
an empty selection fails, so a rename cannot make the check vanish.
Hosted run 38318036642: 23 of 23; the 200k p95 from the first
invocation 15.45 ms on Linux and 18.27 ms on macOS, 12.60 ms in the
local gate. Stated: this removes our own start-up contention from
the check and nothing else; the 36.5 ms outlier stays unexplained;
the heap ceiling of the same spec has run at 44 to 48 of its 64 MiB
in some local runs and is untouched.

### W-136 dashi: four review points on the release scripts — status: open (owner dsh-exec, before the 0.2.0 tag)
From the W-131 review at bb24432. None touches an archive: this
item's Linux gate must print the four lines of W-131 unchanged,
because the tag binds the proven bytes and not the commit (D-052).
(1) The spec's inexact-sibling control cannot fail since the
key-order check exists (release.spec.mjs:210-214): it replaces the
whole dependencies object, so the order check refuses it first. It
changes only the sibling's range and must fail when the sibling
check is removed. (2) A failing build in the pack script reports the
command line and drops the compiler's diagnostics
(scripts/pack-release.mjs:10); they go to the operator's stderr.
(3) RELEASING.md does not say that the local check before the push
reads the public registry, and its commands leave the archives and
the hash file untracked in the repository root; it names the
registry need and uses a directory outside the working tree. (4) The
spec pins "exactly the two directories" against one marker file and
stubs the pack's preconditions: a decoy directory must survive, and
a pnpm of another version with switching off must be refused; the
Node and platform refusals stay hand-checked and are stated so. No
source, lock or workflow change.

Accepted 2026-10-13 (antst/dashi PR #316, squash
997b71de6a4d033c1b50572576efd2c3a11e6c94; four
files, no source, lock or workflow change). A fifth point joined the
four during the host proof: the install guide told every user to put
the catalog override for dsh-codex into the profile's package.json,
which pnpm 11 and 12 ignore. Measured on a tiny fixture by the
builder and again by the reviewer, for pnpm 10.28.1, 10.34.7, 11.28.5
and 12.11.2: an override in the profile's pnpm-workspace.yaml alone
applies on all four; with both places filled pnpm 10 reads only
package.json and pnpm 11 and 12 read only the workspace file. The
guide now names that one file, which DSH creates in every profile,
and tells readers of the earlier instruction to move their entries
and remove the old block. The other four as written above: the
sibling control changes only the range and fails when the sibling
check is removed; a failing build shows the compiler's diagnostics;
RELEASING.md packs into a directory outside the working tree and
says that the local check reads the registry; a decoy directory
survives the clean and a pnpm of another version is refused before
any clean, build or pack. Review by an opus agent at ca98f05:
accept; hosted run 38339325441, 23 of 23; the Linux gate printed the
four lines of W-131 unchanged. Carried to the next change of these
files: the spec's comment on toolchain admission is no longer exact,
and RELEASING.md's directory variable lives in one shell under /tmp.
The owner's own profile on the dsh host still has its override in
package.json, which works on pnpm 10.28.1; it moves to the workspace
file with the post-publish upgrade.

### W-137 dashi: a terminal lifecycle test timed out on macOS with no trace — status: open (owner dsh-exec, the forced-exit proof first)
From the 0.2.0 release (W-131): one timeout of the idle SIGTERM case
on the hosted macOS gate, run 38373974104, cause not localised; a
sibling case (stdin already closed) failed the same way once on
2026-10-11 (W-123). Four parts, in this order. (1) The one risk
named from the source, tested deterministically and alone:
a test-only plugin holds the native session flush after its own
SIGTERM so that DSH's five-second forced exit fires, with a receipt
that the timeout path ran, and the terminal is then checked as in
the other cases (the child's exit, the alternate buffer, the four
stty flags, the shell marker), beside an unarmed control. If the
terminal is not restored, that is a product defect: no skip and no
weaker oracle, and its fix is a patch release. (2) The W-123
convention for all six lifecycle cases, so that a helper's wait can
report before the test's own bound; the last helper is not
guaranteed its full ceiling, which the capture covers. (3)
Failure-only phase capture for this family alone: stage and elapsed
boundaries, the own child's pid and state, the last 4 KiB of the
PTY, written when the outer failure fires; nothing on the passing
path but in-memory marks; uploaded on failure from both gates and
from the release workflow's verify job, the only workflow change.
(4) A bounded attempt on a hosted mac: 300 runs each of the two
cases that have failed, serial, stopping at the first failure; a
clean result is reported as not reproduced. No ceiling is raised and
no red gate is re-run to close this.

Part 1, 2026-10-13, measured by the builder: valid on the third
attempt, and a product defect. With an admitted native maintenance
operation holding the agent busy before the signal, the published
DSH 0.2.1-alpha.2 forced the exit 5000.56 ms after SIGTERM (exit 0,
from the timer in profile-boot, not from ordinary disposal) and
dashi 0.2.0 left the terminal on the alternate buffer; the unarmed
control left normally in 109 ms. The first two attempts are kept as
invalid: one never sent the signal, one exited by natural disposal
in 95 ms because the fixture had not admitted a hold. Linux only;
nothing here explains the two macOS timeouts. The fix is W-138;
parts 2 to 4 wait for it.

Amended 2026-10-13. Two more failures of the hosted macOS gate, in
run 38403478491 at the W-138 head 9edcdb7 (the Linux gate of the
same run passed): the throwing-presenter-across-resize case
(profile-pty.spec.ts:1894), 6.2 to 7.5 s in every other run on
record, hit its 60 s outer bound with no helper diagnostic; and the
install-failure control (install-failure.spec.ts:102) read `pnpm
finished; command alive` where it expects `terminated`, as it had
once before on macOS at 6b3b374 (run 38331766267). The reviewer
counted three other macOS gate failures in the last 80 runs. None
was re-run. New order: parts 2 and 3 no longer wait behind the
release; they come directly after W-139's pull request and before
any 0.2.1 release preparation, extended to the throwing-presenter
case, because the release run uses this gate and is not tagged on a
blind re-run. Part 5, new: the install-failure control: which
process should have been terminated, by what, within which wait,
and why `command alive` can be read first. Part 4 stays last.

Added 2026-10-13, gate hygiene, found in the W-139 review: the
repository has no test-runner configuration and the gate passes no
include (its one exclude is the renderer file, which it runs first
on its own, scripts/gate.mjs:97-98), so the runner also collects
specs under the ignored `.cache/` directory; an untracked capture
spec in the builder's worktree ran in its local gate and was
counted (356 where the committed tree has 355), and by the
builder's own statement it overwrote, on those runs, the raw
capture a committed fixture had been made from. Part 6: the gate
runs tracked tests only, and says how many files it ran.

### W-138 dashi: a forced exit leaves the terminal on the alternate screen — status: open (owner dsh-exec, then a plain 0.2.1)
From W-137 part 1. When DSH ends the process itself, dashi's
terminal guard never runs: teardown is still waiting for the agent
to become idle (index.ts:264-268, session-runtime.ts:1543) when
DSH's five-second timer after SIGTERM calls process.exit. The
user's shell then prints into dashi's last screen, and the main
screen and its scrollback do not come back; the shell restores its
own cooked mode, so no raw-mode leak is shown. Present in 0.2.0
and in 0.2.0-alpha.2 before it, whose teardown path is
byte-identical (W-131).
Mechanism, accepted before coding: the guard owns one process
`exit` listener for as long as the terminal is acquired, and that
listener is the ownership token. Ordinary release, after the input
drain and at the cooked handoff, removes it and then makes the one
stop call; the exit path consumes it and makes the same synchronous
stop with no drain; reacquisition registers a fresh one. No new
phase, signal handler, timer or copied escape sequence, and no
change of teardown order; terminal-guard.ts is the only shipped
file. Stated limits: no input drain at a forced exit, so late keys
can reach the shell; nothing for SIGKILL, abort or a frozen loop;
Windows not established.
Acceptance: the forced-exit case of W-137 and its unarmed control
pass on both gates with the native timer receipt; unit controls
for ownership (nothing registered before start or after release,
one stop when the exit arrives during an unresolved drain, the
cooked interval and reacquisition, disposal during the cooked
interval); the two mutations (listener absent; listener removed
before the drain) fail, as shown in the handoff; the handoff names
the ordinary situations in which 0.2.0 reaches the forced exit,
each as observed or as read from source. Then a plain 0.2.1 of the
four packages, prepared as its own step under D-049 and D-052, and
the fleet after it.

Review 2026-10-13 (PR #320 at 911aa0b, hosted run 38392237038, 23 of
23 on the first attempt; independent reviewer in its own worktrees):
accept with notes, no mechanism to remove. The base guard fails the
native forced-exit case on the same assertion as the W-137 stop
report and the head passes it; an ordinary SIGTERM writes the same
escape sequences as before; only the core archive changes
(6520007e...b6a8). The reviewer also measured on the real profile,
base against head: a second SIGTERM, SIGINT and an uncaught
exception while teardown is wedged, and the timer exit in inline
mode; none restored the terminal before and each does at the head.
Ruled as one follow-up push before the merge: a stop that throws is
contained inside the exit callback only, because a throw in an exit
listener stops later listeners and, through DSH's fatal path (an
exit inside an async function), can keep the process from exiting
at all; controls for the two accepted properties that no committed
test covered (the listener is registered before the start; the
token is consumed before the stop); the two native cases remove
their per-run directories on a pass; the limits name every signal
DSH does not catch (it catches SIGTERM and SIGINT only).
Pre-existing and untouched: an external editor open at SIGTERM is
orphaned after five seconds. Carried: three existing PTY cases
depend on the length of TMPDIR.

Accepted 2026-10-13 and merged: PR #320 at 9edcdb7, squash
6a125025e72ded111a40d5a61a38d76eacd4d228. The follow-up push did
the four ruled things in three files, 60 lines: the stop is
contained in the exit callback only (the one catch in the file; the
ordinary release still rejects), three controls for registration
before the start, consumption before the stop and a throwing stop,
success-only removal of the native cases' run directories, and the
limits naming SIGHUP and SIGQUIT. Delta review: accept with notes;
of 22 mutations 20 fail a committed test, the two survivors being
`on` for `once`, which changes no behaviour, and a rejecting drain
that skips the stop, in code older than this item (carried). Core
archive 6c19f99d...ad542, only lib/terminal-guard.js differing from
0.2.0; the other three archives byte-identical to 0.2.0. Local gate
399 of 399. Hosted run 38403478491: Linux gate and ten Linux rows
passed, both native cases and the ten guard controls passed on both
systems, the macOS gate failed in two existing cases outside the
diff and its nine rows were skipped; not re-run, recorded under
W-137. The route by which a user meets this defect with nothing
going wrong, observed by the reviewer: a SIGTERM to the launcher's
process group reaches DSH twice, directly and through the
launcher's forward, and DSH exits at once on the second; 0.2.0
leaves the alternate screen in 4 of 4 such runs, the fix restores
it in 4 of 4. Release note: "Restore the terminal when DSH ends the
process before dashi's cleanup has finished, for example when a
termination signal reaches it twice." Ships in 0.2.1.

### W-139 dashi: the live activity rows flood the screen — status: open (owner dsh-exec, analysis first; ships in 0.2.1 with W-138)
From the owner, 2026-10-13, on long-running sessions with dozens of
background jobs (0.2.0-alpha.2, about 200 by 60): two screens of
`Job ·` rows between the conversation and the composer, tool rows
wedged between them, no separator above the model status line; "it
is currently beyond messy and unuseable", "what is what and where -
impossible to figure out", "you need to think a bit more about UI".
Unchanged in 0.2.0.
Cause, read from source and reproduced with xterm-headless
(renderer.ts 154-173 and 461-477 at develop): the control region
draws one row for every job and subagent of the root whatever its
status (W-009), and DSH's job registry never drops a settled job,
so the region grows with the session; on the DSH 0.2 line every
bash call registers a job, and background starts and foreground
calls promoted after the timeout stay. A job's label reaches the
row without sanitising, against DESIGN 13; one with newlines
becomes several physical rows that the inline screen does not
count, so later writes land displaced: stale rows in scrollback and
tool rows between two copies of the block. A running foreground
command shows twice, as its pending tool cell and as a job row.
Decision, put to the owner the same hour: remove the always-on
activity rows of W-009, for jobs and subagents, running or settled.
A region with no rows is bounded by construction. What remains is
already there: the count of running jobs in the status line,
extended to running subagents; the Ctrl+B overlay and /tasks as the
one list; the pending tool cell; the durable notice row when a
background job settles. With it: every collapsed head and overlay
row is one terminal row and is sanitised; state before command
where DSH gives the state as a fact, never read out of free text;
one blank row above the model status line; the footer hint names
the steer toggle and the card key separately. Basis for the
removal: DESIGN 6.1 has no such block and section 16 rejects a
permanent dashboard; DSH's own web list folds settled jobs behind a
count; Codex shows one line with the count of running background
terminals and lists them on demand; Claude Code documents only the
on-demand list.
Acceptance: a recorded session with at least sixty jobs (settled
and running, several multi-line labels, one with control bytes) at
80 by 24 and 200 by 60, inline and full screen: no activity row in
the control region, the last transcript rows visible, nothing stale
in scrollback after fifty renders with changing job states, every
head and overlay row one row, the blank row present, Ctrl+B lists
all sixty with status. DESIGN 6.1 and 6.2 in the same pull request.
The analysis says what the user loses by the removal and whether a
background failure is visible before the next turn. How a message
relayed from another session reads (today the plugin's envelope,
kept on purpose by D-045 ruling 4, W-027 and W-101) is analysed
with it and ruled separately.

Proposal accepted with rulings, 2026-10-13. The builder's analysis
keeps two causes apart, a tall suffix displacing the transcript and
multi-line or control-byte labels breaking the row count; its own
probe with 60 jobs over 50 renders left 100 stale rows at 200 by
60, forced 51 clear-and-replays at 80 by 24, and a clear-screen
sequence in a label removed the status line. Removal as decided;
it was put to the owner twice and he raised no objection. The
settlement notice's head is read only by DSH's documented form
(dsh-tool-jobs README.md:40), for a message whose durable source is
kind tool-jobs and form notice: id and kind from the documented
prefix, status from the documented suffix, the label whatever lies
between; anything else falls back to `Job notice` with the native
summary and no state. A message under another source is never
classified by its text. Timing stays as DSH claims the notice: no
early projection of inbox splices in this item, and DESIGN 6.2 says
that a background settlement appears when the model takes the
notice, with the count and Ctrl+B until then (the general question
is W-140). Footer: running counts in words next to their key,
early, omitted while a decision is open; the status line's fields
unchanged. One-row heads in the collapsed card mode only. Ceilings:
renderer.ts 90 changed lines, transcript.ts 50, the count helper
15, no state field. Title `W-139: remove the live activity rows`,
branch from e299cc5.

Rulings after the first review, 2026-10-13. The review at 701084c
(accept with notes; head not accepted by the architect) measured
with real background jobs what the first head read wrongly: DSH's
bash tool reports every command that was not killed as `completed`
and puts the exit code after it (dsh-tool-bash
lib/index.js:42-49), so `exit 3` and commands that died of TERM
and KILL all read `Job · completed`; a sandbox-denied job got no
state, because DSH appends bracketed markers to the detail
(dsh-sandbox lib/index.js:64-65, :76-77); a detail that itself
contained a second boundary gave the wrong state (DSH wrote
`[status: failed, x) finished [status: completed]` and the head
read `Job · completed`); and the footer's state token was found by
splitting composed text, which cut an overlay title in two. One
follow-up push ruled. The job's state is the whole content of the
documented status bracket, found by anchors only: the documented
prefix, the exact suffix `]. Read its output with job_output.` at
the very end, and exactly one `) finished [status: ` in the body;
anything else is `Job notice` with the native summary. Head `Job ·
<whole state> · <id> · <label>`; in the Ctrl+B list status and
detail come before the label. Footer: the new shape (new-output
indicator, state, `Ctrl+B` with the running counts in words, `%
context`, the long hints) exists only in the plain running and
plain idle states; every other state is byte-identical to the
base, with no text splitting. One blank row above the status line
also with an empty transcript in inline mode. Controls for the
surviving mutations that change behaviour. A second recording made
with real background bash jobs for exit 0, a non-zero exit, a kill
through `/tasks kill` and a sandbox-denied write; the volume
recording stays registry jobs with scripted outcomes and is
labelled so; both settings it was made with are named. DESIGN 6.1
and 6.2 say that the one-row head holds in the collapsed card mode
only and state the loss: for a running job "labels, elapsed time
and progress are no longer always visible"; it is a count next to
its key and a row in the Ctrl+B list. Withdrawn by the architect,
his own hasty ruling: that `/export` and search must read as on
the base; on the base both already carry a cell's text and its
head (session-export.ts, state.ts), so the new head loses nothing
and no field or prefix is added. One oracle change approved in
advance: at 80 columns a killed job's row keeps the whole state
and reason and cuts the command, so the adapted native case
asserts the state on the row and the full details in the job's
output view. Not confirmed and not to be cited: the builder's
figure for the base's scrollback growth (27 to 412 rows); the
reviewer did not reproduce it. Claude Code's documentation names
Ctrl+B and `/tasks` for background work and nothing about a footer
count; the count is this item's own choice.

Second correction, 2026-10-13, the architect's own ruling again.
The delta review at ec4e10c (accept with notes: the rulings on the
state, the footer, the blank row, the recording and DESIGN
implemented as ruled, the controls present for seven of the
reviewer's eight earlier survivors; 456 footers compared with the
base, the 260 outside the two plain states identical in text and
styling) measured what the state in front of the id does to a
sandbox-denied job. DSH's state for it is 262 characters; at 80
and at 200 columns the notice head and the Ctrl+B list row held
nothing but the start of that state: no id, no command, no elapsed
time, so that two denied jobs could not be told apart (two
identical rows are in the builder's capture of that head). Head
not accepted. Bounded fields come first: head `Job · <id> · <whole
state> · <label>`; list row id and elapsed, then the whole state
with detail and progress, then the label. The state stays whole;
anchors, the one-boundary rule and the fallback are unchanged.
With it: controls for the footer's job count with a stopping job,
for the trailing blank, for the whole list row and for the denied
job's row; the four conditions of the empty-transcript blank
reduced to the one the line above already uses; DESIGN naming
search beside the decision for the old hint whose key does
nothing. The recording: the reviewer repeated the capture in its
own home and found the four notice bodies byte for byte DSH's own
and 49 of 56 events identical apart from ids, times and paths;
that the committed bytes came from one particular run cannot be
shown, because the raw original no longer exists (by the builder's
statement its own capture spec overwrote it during its local
gates); the recording note says that it is gone and that the two
path replacements cannot be compared with it, and names the one
artefact of the replacement (a summary of 112 characters where DSH
cuts at 120). A label that itself contains the documented boundary
gives `Job notice` and no state: a wrong state would be worse than
none.

Accepted 2026-10-13 and merged: PR #324 at 3dc57d8, squash
60a113db369064811d8c33d47abbb9096ebece87. Three review rounds by
one independent reviewer, one per head, the last at this head: the
second correction is done as ruled and its five controls each fail
under their mutation; 456 footers are identical in text and
styling to the head before it, so the 260 outside the two plain
states are still identical to the base. A fresh native run of 21
notices, two of them real sandbox denials: 17 parse and show the
id first, 4 fall back to DSH's own summary, which carries no id;
the state is whole in 15 of the 17 at 80 and at 200 columns, the
two denials being cut after the id and the start of their state;
21 distinct list rows. Core archive 843bf7c2...ebd00, in which
lib/renderer.js and lib/transcript.js differ from the review
before; the other three archives byte-identical to 0.2.0. The
builder's local gate and both hosted gates: 435 of 435 (80 in the
renderer file, 355 others); the reviewer's own gate 80 of 80 and
354 of 355, the one failure being the `/init` case, which fails
there with a short temporary directory on any build and passes
with the long one. Hosted run 38448332130: 23 of 23 jobs on the
first attempt, both gates and all nineteen layout rows; the two
macOS cases recorded under W-137 passed in this run and in the one
before, which changes nothing in W-137. Whole item: renderer.ts 38
changed lines of 90, transcript.ts 12 of 50, the count helper 7
lines, 14 changed with its import and call site, of 15; no state
field, no timer, no dependency. Carried into W-143's pull request,
as its first test line: the blank above a panel on an empty inline
transcript (renderer.ts:521) is held by one condition whose
removal fails no committed test; and one native assertion lost a
trailing space. Limits: a background settlement still appears only
when the model takes the notice (W-140); a denied job's command is
on neither its head nor its list row at 80 or at 200 columns (it
returns above about 280), the id tells two apart, and the command
is in the notice's body in the expanded card mode, not in the
job's output view; a plugin job kind of unbounded length would
push the state out again, and none of the installed DSH
0.2.1-alpha.2 packages has one (their kinds are bash, pwsh,
pty-send and workflow), so no cap was added; the recording's raw
original is gone. Release note: "Background jobs and subagents no
longer take rows above the prompt: their count is in the footer
next to Ctrl+B and their rows are in the Ctrl+B list. A finished
job's line leads with its id and its status, exit code included;
where DSH's notice cannot be read unambiguously the line shows
DSH's own summary."

### W-140 dashi: what waits for the model, and who sent it — status: open (owner dsh-exec, analysis exists, after 0.2.1)
From W-139. Two things a user cannot see today. A message that DSH
has put into the agent's inbox (a job or subagent notice, a message
from another session) gives a transcript row only when the model
takes it; with a busy or stuck model that can be long. And a
message relayed by the Sessionbus plugin is shown as the plugin's
envelope: the opening tag, a raw metadata line, the text, the
closing tag (kept on purpose by D-045 ruling 4, W-027 and the W-101
PTY case, so that the sender is visible). Starting point, from the
builder's W-139 analysis: the durable `agent/inbox/spliced` record
carries the inserted message, so the fold can show it without a
mirror; a relayed message would read as a header naming the peer
and then the text, the raw envelope staying in the expanded and
history detail, gated on the durable source kind and form, unknown
or malformed forms left opaque. Not decided: whether pending items
of every source are shown or none, and how a pending row differs
from a taken one. Overrides the three entries named above if
accepted.

### W-141 dashi launcher: a group-wide signal reaches DSH twice — status: open (owner dsh-exec, analysis first, after W-139)
Found in the W-138 review. The launcher forwards SIGTERM and SIGINT
to DSH (dashi-launcher/bin/dashi.js:27-29); a signal sent to the
process group reaches DSH directly as well, and DSH treats a second
signal as an escalation and exits at once (profile-boot 63-66), 40
to 55 ms after the signal in four measured runs. So a group-wide
kill skips DSH's orderly shutdown whatever the terminal does; W-138
only restores the terminal. A signal to the launcher alone is
forwarded once and shuts down in order. Wanted from the analysis:
what the orderly shutdown saves that the forced exit loses, and the
smallest launcher that does not double a signal, for example one
that replaces itself with DSH instead of parenting it, if the
supported Node versions allow that on the gated platforms.

### W-142 dashi: NO_COLOR is not respected — status: open (owner dsh-exec, after 0.2.1)
Found in the W-139 analysis: with NO_COLOR=1 the renderer still
emits colour sequences, also in accessible mode; its colour
constants and theme are unconditional. DESIGN 6.1 says to respect
NO_COLOR and to keep ASCII status markers in monochrome and
accessible modes. Not part of W-139, whose rows and counts must
read correctly without colour in any case.

### W-143 dashi: nothing shows that a turn is working — status: open (owner dsh-exec, ships in 0.2.1 after W-139)
Owner 2026-10-13: "it is unclear, you send prompt and then silence
till you get reply. everybody else are indicating it", "with
pulsing symbol"; kept in 0.2.1 on his word. Between a prompt and
the first visible output dashi shows nothing that tells a waiting
model from a dead session; with a model that answers after minutes
that is most of the time. Ruled after the builder's analysis,
reduced: one disposable row directly above the model status line,
present only while the root's native turn is open, and gone with
it. While it is there the control region is one row taller and the
blank row separates the conversation from that row; W-139's
assertions of six rows and of a blank directly above the status
line in a running root, and DESIGN 6.1's sentence on the blank,
change with it. A pulse of four frames (`·`, `•`, `●`, `•`) at 250
ms on the renderer's one timer, which today runs only while a
command is pending (80 ms, one second in accessible mode) and now
also while a turn is open; in accessible mode a `*` at one second.
The words come from native facts only: Working; Waiting for model,
with the observed age of the attempt and none on a resumed turn;
Reasoning; Receiving text; Tool request; Tool pending, with the
name and the count; Retry wait and Retrying, with DSH's own retry
number; and the turn's elapsed time. Not built: labels for an open
approval or question (the decision surface says it), an attempt
ordinal of dashi's own, a token counter. The time of the last
received chunk is kept, so that a stalled stream reads as stalled.
No state beyond the one reducer, no second timer, no persistence.
Ceilings: turn-working.ts 90 lines, session-runtime.ts 50 changed,
state.ts 20, renderer.ts 50. Evidence: unit tests of the phases
over recorded logs and one native PTY case that waits on the row
appearing and on its going with the turn's end. Carried from W-139
as this pull request's first test line: the blank above a panel on
an empty inline transcript (renderer.ts:521). Title `W-143: show
that a turn is working`, branch from develop after W-139 merges.

### W-144 sessionbus plugin: a delivered message waits when the recipient's turn fails — status: open (owner codex-roller)
Owner 2026-10-13: long-running dashi sessions on one host showed
`pi-ai stream idle timeout after 300000ms` and stopped answering
peers. The transport was sound: the sessions were attached and
every delivery to them was `injected`. Reproduced by the builder
with the published plugin 0.1.2 in peer mode, a private DSH
0.2.1-alpha.2 home, a private daemon and a controlled adapter, and
then with no plugin and no daemon at all: input steered into a
running turn stays pending, with the agent idle and no new turn,
when that turn ends in a provider error or in a cancel that keeps
the inbox before it reaches its next step boundary; the next
waking input takes both. A follow-up queued during such a turn is
stranded the same way; by the same mechanism that should also
concern a prompt typed into dashi while a turn runs, which was not
measured through dashi (W-140). While a request is retried the
step repeats the request and takes no pending input between
attempts, so with the default policy of five retries and a
five-minute idle limit a message can wait through six requests
before the error end strands it: source reading and arithmetic,
not a timed run. An independent check re-ran the reduction with
identical results, checked every cited line in the installed
packages, corrected four line references and several sentences
that said more than was measured, and found nothing in the source
that contradicts it. Not established: that this explains every
hour of the owner's sessions. Their logs were not read: the
architect's script decoded whole logs, was killed by the kernel
for memory twice and took that host's bus daemon through one
restart by its service manager; the owner's sessions stayed up.
Rule since then: a script sent to an owner's host is bounded in
memory and time, streams its input and never decodes a session log
whole.
Ruled. The plugin does not wake the session itself. A synthetic
waking message was rejected. The public route found by the check,
removing the pending message and steering it again, was analysed
and not adopted: it makes two durable operations out of one
admitted message, with a window in which the message is in neither
place; DSH logs the removal as a cancelled, discarded input; it
wakes the whole agent, a queued user prompt included, on the
plugin's decision, where the session controller uses the pair only
to move a queued item into a running agent's next step; in a loop
over two pending messages it reverses their order, since the wake
is synchronous and takes all pending input; and the next peer
message already delivers everything. No change to the receipt
either: `injected` is true of what it names. What ships is plugin
0.1.3: the README says in a user's words what `injected` promises
and what it does not, what is seen when the recipient's turn
fails, and to send another message or prompt that session; the
reproduction is committed as proofs titled as a known gap, written
to fail with a message that says so on the day DSH wakes pending
input after an error end. plugin.cjs stays byte-identical to
0.1.2. Upstream: DSH discussion 4952 carries a comment of the same
day reporting the error-end case for queued follow-ups with the
same mechanism; a comment of 2026-09-20 on discussion 274
reproduced it after five exhausted retries and links a candidate
fix; a comment on discussion 9370 says that a turn that errors or
is cancelled keeps later steering on purpose and that seven
existing tests failed when every waking send was latched;
discussion 7328 asks for a wake operation; none of the eighteen
authors in these threads was marked as a maintainer when they were
fetched (2026-10-13T17:22Z). The architect found these only after
the report had been drafted and checked twice; the checked text
stays as the backing document, and what goes upstream is one short
comment on 4952 with what is new (the next-step case, a
reproduction from published packages, the retry interplay, the
type comment that does not name an error-ended turn), on the
owner's word. A side finding kept apart, in the plugin
repository's own note: after a rejected recovery pre-step the
steering that step had already claimed was gone, while steering
that arrived during the rejection stayed parked as the type
comment says; not a contradiction of that comment.

Accepted 2026-10-13 and merged, not released:
sessionbus/sessionbus-dsh PR #72 at c5ed269, squash
37d1e97764d4b65c31eff07265d83060a2db552f, tree identical to the
reviewed head. Three commits. The first hosted run stopped at 15
of 17: on the hosted runner the proof's directory is longer, the
daemon refused the lane socket it derives under it (114 bytes
against a limit of 107) and exited before any root, request or
message of the proof, and the proof's readiness wait hid the exit
for ten seconds; not re-run. The correction computes the longest
derived socket path before the daemon starts and stops with the
length and the limit, ends the wait at once when the child exits,
and moves the socket one directory up. The reviewer had passed the
first head after running the proof in a 9-byte directory of its
own, having met the same limit locally and worked around it; it
withdrew that verdict, reproduced the failure, and measured the
rule to the byte (a socket directory of 63 bytes passes, 64 is
refused, by the proof and by the daemon alike). At the final head:
13 cases, five of them known-gap; 203 unit tests; hosted run
38447390422, 17 of 17 on the first attempt; archive
4fd87eed...cca622, in which only README.md and the version line
differ from 0.1.2. Against a simulated upstream fix each of the
five known-gap cases fails with a message naming the upstream
change; against simulated loss of the input, run for four of the
five, it fails with a different one. Limit: a wake added on the
plugin's side would be credited to upstream by that oracle; only
the capture tells them apart. Seven points in unshipped files are
carried to the next change of the plugin. The upstream report did
not go out as a new thread. A short reply on discussion 4952 was
posted on the owner's word the same day and read back identical:
its backing report had been checked twice and the reply once by
the independent checker; the corrections from that check and two
wording points of the architect were then applied and verified by
the architect's own diff, not by a further independent reading. No
tag before the packed candidate is proven on the dsh host under
D-049 and D-053: a peer profile under another name in the real DSH
home upgraded from 0.1.2, and the lane profile in a private DSH
home; the permanent daemon cannot start a lane on a profile under
another name, so the lane round trip runs on a private released
daemon, a stated limit.

### W-145 fleet and dashi: a local model silent for more than five minutes — status: open (architect; the owner's choice between two routes pending)
Owner 2026-10-13, pointing at DSH discussion 3157: for every dashi
configuration with the local model, "put this timeout to 30 min".
Done the same day on four hosts, in every profile patch that
carries the local provider row, twelve profiles in all:
`streamIdleTimeoutMs: 1800000` and `timeoutMs: 1800000` under that
provider, each patch backed up first and each profile checked to
compose with the values in the composed tree. Not yet: the web
profile on the dsh host, whose running process reloads its patch
live and is the owner's; and four hosts that follow with the 0.2.1
fleet update. Sessions started before the change keep the old
limit.
The setting alone does not pass five minutes. Measured against a
loopback server with DSH 0.2.1-alpha.2 on Node 25.9: with both
values at thirty minutes a request that got its headers and then
390 seconds of silence was ended after about 300.3 to 300.4
seconds by the body timeout of Node's HTTP client and surfaced as
`terminated`, code TRANSPORT; a request that got no headers was
ended after the same time by the headers timeout of the same
client, code TIMEOUT. `timeoutMs` made no difference where it was
compared, with headers and then silence; with no headers only the
run with both values exists; by the code it bounds only the wait
for headers inside the model client and nothing passes it to
Node's HTTP client. With the defaults DSH's own watchdog ends the
request about half a second earlier, which is the message the
owner saw. A server that sends its headers at once and a comment
line every twenty seconds was not cut: 390 seconds, one attempt,
answer received. Each cut request was sent again as a full new
request, the first about half a second later and the second about
one second later; the default policy allows five such retries, per
provider (`retryPolicy` under the provider row). Not measured: the
final outcome after all retries, keep-alive lines against DSH's
watchdog at its default, more than 390 seconds, other protocols. A
search of the DSH 0.2.1-alpha.2 packages found no setting that
reaches the two limits of Node's HTTP client; none was tested, and
the dispatcher that DSH's proxy plugin installs was not inspected
at run time. If there is none, that is a DSH gap, named as such.
Two routes, the owner's choice: his model server sends headers at
once and keep-alive lines while it works, which in the one run
that did so carried a request through 390 seconds, longer not
measured; or a dashi-side change that lifts the two limits for the
process, which is a mechanism dashi would own and is not built
without his word. Also his: fewer retries for the local provider,
and whether these measurements go to discussion 3157.

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

### B-004 dashi: custom endpoint provider form — status: backlog
Split from W-127 on 2026-10-11. Adding a custom endpoint (base URL,
protocol, key reference, model metadata, discovery through
ctx.llm.discoverModels) from inside dashi, through DSH's writers only.
Not a gap against the bar: Claude Code configures alternative
endpoints through settings, and `/config` or DSH's web Models page do
this today. Opens after W-127. A custom route's key reference name
needs the user's explicit confirmation, never a derived convention.

### B-005 sessionbus daemon: a silent federated host stalls every list — status: backlog (owner 2026-10-11: redesign ours, or from scratch)
Upstream issue sessionbus/sessionbus 108 and pull request 109, from an
outside contributor, against v0.5.12 (main fd85d7e). Reviewed
2026-10-11 by two opus agents and one GLM lane; the problem was
reproduced on the unchanged release in an isolated federation. A host
link that stays open but stops answering is treated as live with no
bound, so every operation that needs that host blocks: the unfiltered
session.list on every other host, with local rows withheld; group and
multi-target sends; every directed call; lane and turn operations. An
idle silent link is reaped after about 150 s by TCP keepalive, one
with a pending forward after about 15 minutes, a stopped process
never. Pull request 109 is not merged as written: it closes the host
link after about 30 s of silence whenever a short call waits, which
ends cross-host nonpersistent lane ownership (running turns,
uncollected results, staged messages) for a laptop that sleeps a
minute, and its trigger includes operator roster legs and host_end,
so one departure cascades. Direction for our design: keep a caller's
patience and an attachment's lifetime apart. Bound the aggregate list
at its own wait, as the operator roster already does, and decide the
silent-link budget separately, by what is lost. It needs the owner's
amendment of "partial lists have no public representation". Our DSH
plugin's list tool has no timeout and hangs for the whole stall. The
three review reports are kept on the dsh host under
~/.local/state/dsh-architect/sessionbus-108/.

### B-006 DSH: two processes drop each other's scheduled tasks — status: backlog (DSH gap, to be reproduced and reported)
Found by the verifier of the W-131 host proof on 2026-10-13, from
the installed @deepseek-ai/dsh-schedule 0.2.1-alpha.2 over
dsh-storage-json: one schedule table per DSH home in one file, read
once when a process boots, rewritten whole from that process's copy
on every change, with no lock between processes. Two DSH processes
that both use /loop or reminders (two dashi windows, or dashi beside
the web server) each write the file from their own copy, and the
later writer drops the other's tasks from it; they live on only in
the memory of the process that made them. Not yet reproduced with
two processes. Then: an upstream report on the owner's word, and a
line in the README's known gaps.

### B-007 dashi: two things a user cannot see at 120 columns — status: backlog
From the W-131 host proof, both unchanged since alpha.2. After
/config the settings document is printed with its path as the first
of 53 lines, which is above the viewport at 40 rows. In the resume
picker a migration-required row with a long title ends in
"migration..." at 120 columns and shows the full label only when the
terminal is wider.

### B-008 dashi: a maintained host-proof driver — status: backlog
The W-131 host proof stopped eight times, five of them on its
per-proof driver (labels typed from memory, keys batched across a
frame, an unsupported list field, a guessed id prefix, an exit
queued with an observation). The plugin had the same history and
answered it with W-134. For dashi: one maintained driver for the
two proof places of D-053, with a replay test, written once the
mac bundle of this release shows what a second host needs.

### B-009 dashi: per-frame cost in a long inline session — status: backlog (to be measured)
Read from source at v0.2.0-alpha.2 while tracing W-139, not
measured. The live event list of a root is never trimmed, and every
publish, up to one per 34 ms, refolds the whole list
(session-runtime.ts:436-450, 490); inline mode materialises every
loaded cell on each frame (renderer.ts:503), which W-003 took as
bounded by the 50-message follow snapshot; the line cache is
first-in first-out at 512 entries with no refresh on a hit
(renderer.ts:255-266), so beyond 512 settled cells every cell would
miss on every frame; a relayed or unformed context cell has no
length bound (transcript.ts:211-215); each subagent refresh lists
all host sessions (presentation.ts:47-50). Measure on a recorded
session of the size the owner runs (context near half a million
tokens) before deciding anything.

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
- Posted 2026-09-19 (draft 10): DSH Discussion (General): turn/end is lost when a pre-header LLM request is cancelled https://github.com/deepseek-ai/deepseek-harness/discussions/7172 — fixed upstream from 0.1.7-rc.2
- Posted 2026-09-19 (draft 11): DSH Discussion (General): Session controller cannot activate without the web-only fileUploads service https://github.com/deepseek-ai/deepseek-harness/discussions/7174
- Posted 2026-09-19 (draft 12): DSH Discussion (General): Forking a running session replays its pending prompt in the child https://github.com/deepseek-ai/deepseek-harness/discussions/7175 — fork cut fixed from 0.1.6-alpha.1; residual pre-turn/end replay
- Posted 2026-09-19 (draft 01): DSH Discussion (General): Two install hazards: mixed prerelease graphs and stale peer dependencies https://github.com/deepseek-ai/deepseek-harness/discussions/7177
- Posted 2026-09-19 (draft 02): DSH Discussion (Ideas): Session-scoped model and effort selection https://github.com/deepseek-ai/deepseek-harness/discussions/7179
- Posted 2026-09-19 (draft 03): DSH Discussion (General): Cold seeded sessions lose their title in the session list https://github.com/deepseek-ai/deepseek-harness/discussions/7180
- Posted 2026-09-19 (draft 04): DSH Discussion (General): Stdio MCP server stderr inherits the host terminal https://github.com/deepseek-ai/deepseek-harness/discussions/7182
- Posted 2026-09-19 (draft 05): DSH Discussion (General): Plain plugin packages installed by dsh plugin add never load https://github.com/deepseek-ai/deepseek-harness/discussions/7183
- Posted 2026-09-19 (draft 06): DSH Discussion (General): Live patch reload excludes bundle additions https://github.com/deepseek-ai/deepseek-harness/discussions/7184
- Posted 2026-09-19 (draft 07): DSH Discussion (General): pnpm global installs produce profiles with missing DSH packages https://github.com/deepseek-ai/deepseek-harness/discussions/7185
- Posted 2026-09-19 (draft 08): DSH Discussion (General): Session-only model selection for Agent Sessions lanes https://github.com/deepseek-ai/deepseek-harness/discussions/7186
- Posted 2026-09-19 (draft 09): DSH Discussion (Ideas): Take-once access for launchEnvironment secrets https://github.com/deepseek-ai/deepseek-harness/discussions/7187
- Posted 2026-10-10: DSH Discussion (Ideas): Agent.steer during the running→idle transition strands the spliced next-step item https://github.com/deepseek-ai/deepseek-harness/discussions/9370
- 2026-10-11 https://github.com/deepseek-ai/deepseek-harness/discussions/9399: dsh-storage-domain: let plugins supply a record schema without their own zod
- 2026-10-11 https://github.com/deepseek-ai/deepseek-harness/discussions/9419: dsh-settings: legacy settings.yaml import lands in one profile only
- 2026-10-11 https://github.com/deepseek-ai/deepseek-harness/discussions/9432: DSH 0.2.1-alpha.2 does not boot from a pnpm 11 global install (native binding resolved from the loader's own module context)
- 2026-10-11 DSH Discussion (Ideas): dsh exits 0 when a profile names a bundle that is not installed; boot and --dump-config exit 0, --dump-config-schema exits 1 (W-125). https://github.com/deepseek-ai/deepseek-harness/discussions/9451
- 2026-10-11 DSH Discussion (Q&A): a project install of DSH 0.2.1-alpha.2 exits 1 with pnpm 11 and 12, ERR_PNPM_IGNORED_BUILDS for five build scripts, one of them DSH's own postinstall (W-124). https://github.com/deepseek-ai/deepseek-harness/discussions/9452
- 2026-10-11 pnpm issue: `pnpm setup` leaves a broken launcher when pnpm 12 was installed with npm on macOS, executable path not canonicalized (W-124). https://github.com/pnpm/pnpm/issues/16855
- 2026-10-12 DSH Discussion #7179, follow-up comment: session-only model and effort re-checked on 0.2.1-alpha.2, current code locations, what the plugin does instead, three questions (W-126). https://github.com/deepseek-ai/deepseek-harness/discussions/7179#discussioncomment-18875041
- 2026-10-12 DSH Discussion (Ideas): provider readiness is derived inside the web client and no provider route names its sign-in flow; a host-side read for other hosts (W-127). https://github.com/deepseek-ai/deepseek-harness/discussions/9486
- 2026-10-12 Corrected on the owner's word: the bodies of #7172, #7177, #7179, #7180 and #7182 to #7187 (posted 2026-09-19) were this ledger's queue lines pasted verbatim, with the queue marker and internal identifiers, and #9399 named a work item; each body was replaced by the same technical statement without them and read back. Rule: what goes upstream is report text written for upstream and read back after posting; a queue line is never pasted.
- 2026-10-12 pnpm issue: v10: removeDirectDependency reads the old manifest while removing the dependency entry; a read/remove race visible in source, gone from 11.28.3 through pnpm PR 16415, still in 10.x; our two macOS EINVAL failures with the stack, the link between them stated as not demonstrated, not reproduced in 200 lighter iterations; request to carry the ordering to 10.x (W-130). Posted on the owner's word after two independent checks. https://github.com/pnpm/pnpm/issues/16876
- 2026-10-12 pnpm issue 16876 closed as completed the same day: the maintainer merged pnpm PR 16878, "fix(modules-cleaner): remove a dependency's bins before its directory (v10 backport)", into release/10, three hours after the report; not yet in a published 10.x release (W-130).
- 2026-10-12 DSH Discussion #9261 (another user's report that `dsh plugin add` hangs on Windows after pnpm prints Done), follow-up comment: the same hang three times on macOS with pnpm 11.18.0 and the process list showing pnpm still alive; pnpm's worker-pool fix in 11.23.0, which the reported versions predate, stated as fitting and not proven; DSH's CLI wait is unbounded by its own README; two questions (is interrupt-and-rerun the supported recovery; an opt-in limit for unattended callers) (W-132). Posted on the owner's word after an independent check. https://github.com/deepseek-ai/deepseek-harness/discussions/9261#discussioncomment-18886224
- 2026-10-13 DSH Discussion #4952 (another user's report that follow-ups queued during a turn are never admitted), reply under that day's comment on the error-end case: the case confirmed independently on the published 0.2.1-alpha.2 packages, with the next-step (steer) case added, a 97-line reproduction from published packages only, the retry interplay as source reading and arithmetic, the type comment that does not name an error-ended turn, and pointers to the comments on #274 and #9370 and to #7328; no side taken between a re-wake after an error end and a wake operation (W-144). Posted on the owner's word; the backing report checked twice and the reply once independently, the final wording verified by the architect's diff; read back identical. https://github.com/deepseek-ai/deepseek-harness/discussions/4952#discussioncomment-18908166
