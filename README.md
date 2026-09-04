# dashi

dashi is a terminal UI for DeepSeek Harness. Linux and macOS are supported.

## Install

Install the exact validated DSH release and start dashi:

```sh
pnpm install @deepseek-ai/dsh@0.1.2-rc.1 @antst/dashi-launcher
dsh plugin --profile dashi add @antst/dashi-app
dashi
```

Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease.
When upgrading DSH, remove `node_modules` and the lockfile before installing so
pnpm cannot retain stale peer-only DSH packages.
dashi validates each DSH release before adopting it, and its packages pin DSH
dependencies exactly.

Without the launcher package, run `dsh --profile dashi` directly or use the
shell alias documented below.

dashi renders in the terminal's main screen by default. Use
`dashi --fullscreen` for an application-owned viewport in the
alternate screen.

Start with a prompt, assign a native session title, or return to an existing
root:

```sh
dashi 'inspect this repository'
dashi -n 'Parser cleanup' --agent standard
dashi --session-id session-00000000-0000-0000-0000-000000000000
dashi --resume
dashi --resume session-00000000-0000-0000-0000-000000000000
dashi --resume session-00000000-0000-0000-0000-000000000000 --fork-session
dashi --continue
dashi --model deepseek-v4-flash --effort high
dashi --permission read-only
dashi --tools read,bash
dashi --disallowedTools bash
dashi --yolo
dashi --image screenshot.png 'inspect this image'
```

`--model ID`, `--provider ID`, and `--effort ID` apply the same DSH selection
as `/model`; DSH also updates its default, because it does not yet expose a
session-only selection. `--permission PRESET` applies `/permission` before the
first prompt. `--yolo` and `--dangerously-skip-permissions` explicitly select
`danger-full-access` without a launch confirmation.
`--tools NAMES` allows only the comma-separated registered tool names, while
`--disallowedTools NAMES` denies them; DSH supports whole names, not command
patterns or path rules.
`--version` is DSH's own root flag, so `dashi --version` prints the active DSH
release; `dashi --help` starts with both dashi and DSH versions.

## Sessions

`--name TITLE` (or `-n`) assigns DSH's native session title at launch; `/rename TITLE`
changes that same title. Bare `--resume` (or `-r`) opens the current directory's
session picker. `--resume VALUE` accepts a complete DSH session UUID or a native
title, matching the title exactly before a case-insensitive substring fallback.
Names need not be unique: duplicate matches open the picker restricted to those
sessions. Add `--all` to search every directory. A following prompt is submitted
after resume. `--continue` (or `-c`) selects the most recently updated root in
the current directory. `--agent PRESET` and `--session-id UUID` feed DSH's
fresh-session creation; `--fork-session` branches the `--resume` or `--continue`
target before binding it.

## Daily-use walkthrough

After installation:

1. Start with `dashi`, or add `-c`/`--continue`, `-r`/`--resume [NAME|UUID]`,
   launch model/permission flags, `--name TITLE`, an initial prompt, or
   repeatable `--image PATH` arguments.
2. Type a request and press Enter. Review streamed reasoning, tool cards, diffs,
   plans, todos, jobs, and subagents in the transcript; answer any decision in
   its numbered overlay.
3. Use `/model`, `/permission`, and `/config` to change native DSH settings,
   and `/status` to inspect the current root without creating another source
   of truth.
4. Add file mentions with `@`, attach images through `@`, `--image`, or
   Ctrl+V, and use Ctrl+G or Ctrl+S for longer drafts.
5. Use native scrollback in inline mode, or PageUp/PageDown in full-screen
   mode; search with Ctrl+F or Ctrl+R, and inspect `/history` or Ctrl+B details.
6. Run `/rewind`, choose a prompt, then restore its conversation, code, or both.
   The code rows appear only when the profile supplies `roller-restore`.

## Keyboard and command details

Type `/` at line start to open live completion for native commands, dashi
commands, and user-invocable skills; Enter accepts a complete command and Tab
inserts the selection. dashi provides `/help`, `/status`, `/new`, `/resume`,
`/clear`, `/reset`, `/continue`, `/fork`, `/branch`, `/rewind`, `/rename`, `/model`, `/effort`, `/permission`, `/config`, `/login`, `/logout`,
`/agents`, `/queue`, `/context`, `/init`, `/memory`, `/skills`, `/diff`, `/plugins`, `/plugin`, `/tasks`, `/bashes`, `/subtask`, `/loop`,
`/history`, `/export`, `/copy`, and `/exit`;
every other slash
submission is handled by DSH's command service or sent as ordinary prompt
text when no command matches.

`/reset`, `/continue`, `/branch`, and `/quit` alias `/clear`, `/resume`, `/fork`,
and `/exit`; `/effort LEVEL` changes only the current model's reasoning effort
through DSH's model selection. `/clear` starts a fresh session. `/agents` selects the current blank session's
native DSH agent preset; after a conversation starts, choosing a preset starts
a new session with it. `/context` shows DSH's heuristic system, tool-schema,
and message estimates for the next request. `/init` atomically creates a starter
`AGENTS.md` without overwriting an existing file. DSH loads it when a new or
resumed session forms its instruction baseline; it is not injected live because
the instruction plugin has no file watcher.
`/memory` lists the instruction
files DSH loaded, with their scopes, and opens one in `$EDITOR` (falling back
to `vi`); DSH applies edits according to its own instruction reload rules.
`/skills [TEXT]` lists the session's resolved skills and filters their names
and descriptions; choosing one inserts its human invocation into the composer.
`/diff` shows the working tree against `HEAD`; `/diff turn` shows write/edit
hunks recorded by DSH for the last turn. `/tasks` opens the job and subagent
details view, Enter reads selected job output, and `/tasks kill ID` stops a job;
`/bashes` aliases it. `/subtask TEXT` starts a continuable child with TEXT as
its first prompt. `/loop 5m TEXT` or `/loop 1h TEXT` creates a DSH-owned
fixed-rate reminder whose firing submits TEXT as a prompt; `/loop` lists active
schedules and `/loop stop ID` cancels one. DSH sets the minimum interval to
five minutes. `/plugins` lists each
running profile row's id, module, enabled
state, and fiber phase; MCP client rows also show their configured server name.
`/config` lists every DSH settings namespace with its effective, base, and user
layers; `/config NAMESPACE KEY=VALUE` writes through DSH's validated provider.
`/login [KEY [METHOD]]` lists or starts DSH authorization flows; `/logout [KEY]`
lists stored record metadata or forgets one credential without reading its value.
`/plugin ARGS` passes ARGS to `dsh plugin --profile <running profile>` and
reports when a successful change will load on the next launch. Human `!`
commands receive the same resolved `DSH_HOME` as the running profile.
`/export [path]` writes the complete current transcript as Markdown under the
session working directory; its default filename is `dashi-SESSION_UUID.md`.

F1 opens help, Shift+Tab cycles permission presets, Ctrl+T switches a running
root between steer and next-turn input, Ctrl+O cycles the global tool-card mode,
and Ctrl+B opens job and subagent details.
On an idle empty composer, Ctrl+C or Ctrl+D arms exit; press either key again
within 1.5 seconds to exit. Any other key cancels the arm. On an idle nonempty
composer, Escape twice clears the draft into prompt history, where Up recalls it.
Permission presets that disable approvals require confirmation when selected
interactively; a danger flag is itself explicit launch consent.
`?` always remains ordinary prompt input.

Type `@` to open live path completion for files under the session working
directory; Enter or Tab accepts a selection. Choosing PNG, JPEG, WebP, or GIF
attaches it as an image. `--image PATH` is
repeatable, accepts relative or absolute readable paths, and preloads the same
visible image chips. A literal Ctrl+V asks `pngpaste` then `osascript` on macOS,
or `wl-paste` then `xclip` on Linux, for a PNG image; dashi installs none of
these helpers. Terminal-native text paste remains ordinary bracketed text.
An empty composer removes its last image with Backspace. Ctrl+S stashes or
restores one text-and-image draft. Ctrl+G edits the text in `$VISUAL`, falling
back to `$EDITOR`, while keeping its images. Ctrl+J inserts a newline;
Shift+Enter and Alt+Enter do the same when the terminal reports those keys
distinctly.

In full-screen mode, PageUp/PageDown scroll the transcript and
Ctrl+Home/Ctrl+End jump to its loaded ends. In inline mode, PageUp and Ctrl+Home
open `/history`; wheel scrolling and selection use the terminal's native
scrollback. Older pages are requested from DSH in the history browser or the
full-screen viewport. Ctrl+F searches loaded cells without changing the draft.
`/history` opens a selectable cell browser; `y` copies its selected cell through
OSC 52. `/copy` copies the latest completed assistant response. Copy payloads
are limited to 64 KiB. `/copy N` selects the Nth latest completed response;
`/copy code` opens a picker for the latest response's fenced code blocks.

On an idle root, `!command` runs the human's command through DSH's current
sandbox policy without a tool approval. Stdin is closed; stdout and stderr are
limited to 32 KiB each; the command is killed after 30 seconds. Suspend dashi
with Ctrl+Z before starting an interactive program. Detached processes are
unmanaged.

Outside accessible mode, dashi rings once for a decision that arrives during a
turn and once when a turn takes at least 10 seconds.

## Skills

DSH discovers skills from `.dsh/skills` and `.agents/skills` at the project
root, configured custom directories, `$DSH_HOME/skills`, and
`~/.agents/skills`. A skill is either `<name>/SKILL.md` or a top-level
`<name>.md` file with YAML frontmatter containing `name` and `description`;
`user-invocable` and `disable-model-invocation` are optional.

Type a leading `/name` token to inject a user-invocable skill into that model
turn; live completion lists the available names. Claude's
`.claude/commands/*.md` prompt files are not a DSH mechanism and dashi does not
read `.claude/skills`.

## Terminals

The automated PTY matrix is verified on Linux with xterm, tmux, GNU screen,
the Linux console, and dumb-terminal capabilities. macOS is supported by
design but was not available for this release's automated PTY run.

### Terminal modes

The default inline mode writes the loaded transcript into the main screen and
leaves scrollback, wheel scrolling, and selection terminal-owned. PageUp and
Ctrl+Home open the history browser for older pages. Search, pickers, decisions,
details, and rewind remain available, but pi-tui's app-owned mouse selection and
wheel routing do not. Ctrl+O changes historical tool-card layout and a terminal
resize changes wrapping, so either action makes pi-tui replay the loaded
document into scrollback.

Full-screen mode captures the mouse: each wheel notch scrolls three transcript
lines, and plain drag selects through pi-tui. The modifier for terminal-native
selection is terminal-specific: commonly Shift, but Option in iTerm2.

`--accessible` selects inline mode, uses stable text status instead of
animation, announces overlay titles, counts, and selections in reading order,
adds ASCII status markers, and suppresses the terminal bell.

## Known DSH gaps

DSH does not currently enforce writer ownership across processes; do not
resume the same root in two DSH processes.

DSH conversation forks are per-turn, so a steered prompt rewinds to the start
of its containing turn. DSH also exposes no operation to summarize a selected
range. Installing roller may add workspace restore, but dashi does not
duplicate it.

The Session Controller has no root-release operation, so roots left by
`/new`, `/resume`, `/fork`, or `/rewind` remain idle until profile teardown.

DSH's plugin CLI exposes no enable/disable verb, so dashi cannot toggle profile
rows in-session. The MCP client exposes configured server names but no live
connection-status API, so `/plugins` reports ordinary plugin fiber state, not
connection health. Hooks, add-dir, and
autocompact tuning also have no native dashi command surface.

An optional shell alias provides the shorter spelling:

```sh
alias dashi='dsh --profile dashi'
```

## Development

Work branches open pull requests against the integration branch, `develop`;
`main` contains releases. Pull requests and pushes to `develop` publish
installable previews of all three packages through pkg.pr.new once its GitHub
App is installed.
Run `pnpm gate:docker` to execute the same containerized gate used by CI.

To release, update the versions and changelog on `develop`, merge it to `main`,
then push the matching `vX.Y.Z` tag. The release workflow runs the full gate,
creates the GitHub release, and publishes to npm with trusted publishing.

After `pnpm install`, build, install both local workspace packages into an
isolated `dashi-dev` profile, and boot it with one command:

```sh
pnpm dev
```

The default profile home is temporary and removed after exit. Set `DSH_HOME`
to an explicit development directory to retain and reuse the profile.
