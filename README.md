# dashi

dashi is a terminal UI for DeepSeek Harness. Linux and macOS are supported.

## Install

Use Node 22.19 or newer on the Node 22 line, or Node 24+. The minimum
supported DSH is `0.2.1-alpha.2`; dashi 0.2 uses DSH's 0.2 integration.
DSH's profile manager needs `pnpm` on PATH even when DSH is installed
with npm or run by npx.

### Global or on-demand DSH

Make your package manager's global binaries available on PATH, following its own documentation ([npm](https://docs.npmjs.com/cli/commands/npm-prefix), [pnpm](https://pnpm.io/installation)).

With npm:

<!-- install:G-npm -->
```sh
npm install -g @deepseek-ai/dsh@0.2.1-alpha.2
npm install -g @antst/dashi-launcher@0.2.0-alpha.2
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

With pnpm 10 or pnpm 12:

<!-- install:G-pnpm10-packages install:G-pnpm11-packages install:G-pnpm12-packages -->
```sh
pnpm add -g @deepseek-ai/dsh@0.2.1-alpha.2
pnpm add -g @antst/dashi-launcher@0.2.0-alpha.2
```

For pnpm 11, apply the [global-store remedy](#dsh-installed-globally-with-pnpm-11)
below before starting DSH. Then:

<!-- install:G-pnpm10 install:G-pnpm11 install:G-pnpm12 -->
```sh
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

With npx, without a permanent CLI installation:

<!-- install:G-npx -->
```sh
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
npx --yes --package=@deepseek-ai/dsh@0.2.1-alpha.2 --package=@antst/dashi-launcher@0.2.0-alpha.2 dashi --version
npx --yes --package=@deepseek-ai/dsh@0.2.1-alpha.2 --package=@antst/dashi-launcher@0.2.0-alpha.2 dashi
```

To start the installed profile directly, first check the CLI installation:

<!-- install:G-npx-direct-warm -->
```sh
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 --version
```

Then start the profile:

<!-- install:G-npx-direct -->
```sh
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 --profile dashi
```

### DSH installed globally with pnpm 11

The default pnpm 11 global virtual store can prevent DSH's native loader
from finding its installed platform binding. The error includes:

```text
No usable native binding found for node-addon-require-builtin-darwin-arm64
```

The suffix identifies your platform. This DSH/pnpm layout issue is tracked
in [Discussion 9432](https://github.com/deepseek-ai/deepseek-harness/discussions/9432).
Disable the global virtual store and reinstall DSH:

<!-- install:G-pnpm11-remedy -->
```sh
pnpm config set --global --json enableGlobalVirtualStore false
pnpm remove -g @deepseek-ai/dsh && pnpm add -g @deepseek-ai/dsh@0.2.1-alpha.2
```

The setting affects subsequent installations; it does not migrate existing
installations by itself.

### Project DSH

From your project directory, with npm:

<!-- install:P-npm -->
```sh
npm install --save-exact @deepseek-ai/dsh@0.2.1-alpha.2 @antst/dashi-launcher@0.2.0-alpha.2
npm exec -- dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
npm exec -- dashi
```

With pnpm 10, install as written:

<!-- install:P-pnpm10 install:P-pnpm11 install:P-pnpm12 -->
```sh
pnpm add --save-exact @deepseek-ai/dsh@0.2.1-alpha.2 @antst/dashi-launcher@0.2.0-alpha.2
pnpm exec dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
pnpm exec dashi
```

pnpm 11 and 12 stop at the first command until you decide about dependency
build scripts. The error includes:

```text
ERR_PNPM_IGNORED_BUILDS
```

dashi's installation checks start DSH and run a shell tool call with these
builds not run.
To decline them, run this command, then repeat the installation above:

<!-- install:P-pnpm11-decline-builds install:P-pnpm12-decline-builds -->
```sh
pnpm approve-builds '!@deepseek-ai/dsh-subprocess-local' '!@google/genai' '!koffi' '!node-pty' '!protobufjs'
```

[`pnpm approve-builds`](https://pnpm.io/cli/approve-builds) without arguments
lets you choose interactively. Handle any additional package pnpm lists the
same way; `!name` declines its build.

pnpm 10.x and pnpm 11 before 11.28.3 can rarely fail an install or upgrade on macOS with `EINVAL: invalid argument, open '.../package.json'` ([report](https://github.com/pnpm/pnpm/issues/16876)); the manifest read/removal race described there is absent from pnpm 11.28.3 onward ([change](https://github.com/pnpm/pnpm/pull/16415)).

### Global and project installations together

`dashi` starts the `dsh` on PATH: run it the way you run DSH, through your
global bin directory or `npm exec` / `pnpm exec` in a project. Those project
commands put the project's binaries first; a bare global invocation uses
your normal PATH. Inspect the global selection:

<!-- install:P-npm-inspect-global install:P-pnpm10-inspect-global install:P-pnpm11-inspect-global install:P-pnpm12-inspect-global -->
```sh
command -v dsh
dashi --version
```

Or check the project selection with its manager:

<!-- install:P-npm-inspect-project -->
```sh
npm exec -- dashi --version
```

<!-- install:P-pnpm10-inspect-project install:P-pnpm11-inspect-project install:P-pnpm12-inspect-project -->
```sh
pnpm exec dashi --version
```

`--version` reports DSH; `dashi --help` reports both dashi and DSH.

Unless you set `DSH_HOME`, both installations use DSH's same `~/.dsh`
profiles, settings and session history. A profile therefore needs to be
compatible with whichever DSH you start; a second installation is not a
second profile or an automatic migration.

### Upgrading an existing profile

Exit dashi and preserve your profile's manifest, lockfile, patches and
provider configuration before upgrading. Update the launcher with the
manager and location you used to install it, then update the shared profile.

For global npm:

<!-- upgrade:G-npm -->
```sh
npm install -g @antst/dashi-launcher@0.2.0-alpha.2
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

For global pnpm:

<!-- upgrade:G-pnpm10 upgrade:G-pnpm11 upgrade:G-pnpm12 -->
```sh
pnpm add -g @antst/dashi-launcher@0.2.0-alpha.2
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

For a project using npm:

<!-- upgrade:P-npm -->
```sh
npm install --save-exact @antst/dashi-launcher@0.2.0-alpha.2
npm exec -- dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
npm exec -- dashi
```

For a project using pnpm:

<!-- upgrade:P-pnpm10 upgrade:P-pnpm11 upgrade:P-pnpm12 -->
```sh
pnpm add --save-exact @antst/dashi-launcher@0.2.0-alpha.2
pnpm exec dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
pnpm exec dashi
```

With npx, repeat the on-demand commands with the new exact versions.
To update DSH itself, repeat your chosen DSH installation command with the
supported version before updating the profile.

Historical caveat: upgrading a `0.1.x` profile to `0.2.0-alpha.1` could leave
the Sessionbus plugin's older upload-provider dependency shadowing the app's
pin; `pnpm dedupe` did not repair that path. Alpha.2 changed the plugin to
pre.20, which consumes the provider as a peer.

### Third-party plugins on DSH 0.2.1

`dsh-codex@0.3.2` pins `@deepseek-ai/dsh-session-format-catalog` to
`0.2.0-rc.1`. On DSH `0.2.1-alpha.2`, it needs this override in the profile's
`package.json`. Merge this block into the manifest, preserving
other fields and any existing overrides (the block is a JSON fragment):

```json
  "pnpm": {
    "overrides": {
      "@deepseek-ai/dsh-session-format-catalog": "0.2.1-alpha.2"
    }
  },
```

`dsh-plugin-subscriptions` 0.9.9 and earlier declare DSH peers ending at
`0.2.0-rc.2`; no dsh-plugin-subscriptions release declares a DSH 0.2.1 peer.
DSH 0.2.1 refuses it at startup;
remove it from a 0.2.1 profile unless a release with a 0.2.1 peer exists.

Without the launcher package, run `dsh --profile dashi` directly or use the
shell alias documented below.

Create the `sessionbus` lane profile with the plugin's installer,
`sessionbus-dsh-install` (see the @sessionbus/dsh README); the dashi profile's
Sessionbus row ships in dashi-app. When `SESSIONBUS_LAUNCH_TOKEN` is present, the
launcher selects that `sessionbus` profile; repeatable `-g`/`--group` options
export group names as `SESSIONBUS_GROUPS`. Interactive roots use defaults
from the plugin's profile configuration (`groups`) or `SESSIONBUS_GROUPS`.
The native human command `/sessionbus-groups` shows the root's declared groups,
`/sessionbus-groups a,b` replaces them, and `/sessionbus-groups -` restores the
profile defaults. It is not a model tool or skill; lane groups remain
daemon-owned. Sessionbus names follow DSH's native session title, not a group
name. With no Sessionbus daemon running, Sessionbus has no effect.

## Running dashi

Use `/model` to add a provider or enter its key in a masked question, then select a model and send a new prompt. Providers are configured per DSH profile, while credentials use DSH's shared store.

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
dashi --model deepseek-flash --effort high
dashi --permission read-only
dashi --verbose
dashi --tools read,bash
dashi --disallowedTools bash
dashi --system-prompt 'You are a careful reviewer.'
dashi --append-system-prompt-file ./project-guidance.md
dashi --yolo
dashi --image screenshot.png 'inspect this image'
```

`--model ID`, `--provider ID`, and `--effort ID` apply the same DSH selection
as `/model`; DSH also updates its default, because it does not yet expose a
session-only selection. `--permission PRESET` applies `/permission` before the
first prompt. `--yolo` and `--dangerously-skip-permissions` explicitly select
`danger-full-access` without a launch confirmation.
`--verbose` starts tool and context cards expanded for this launch; Ctrl+O
continues to cycle expanded, hidden, and collapsed presentation.
`--tools NAMES` allows only the comma-separated registered tool names, while
`--disallowedTools NAMES` denies them; DSH supports whole names, not command
patterns or path rules.
`--system-prompt TEXT` replaces the root agent's system prompt, while
`--append-system-prompt TEXT` adds a final section. Their `-file PATH` variants
read the text once when dashi launches. All four also apply to resumed,
continued, and forked roots without changing session state.
`--version` is DSH's own root flag, so `dashi --version` prints the active DSH
release; `dashi --help` starts with both dashi and DSH versions.

`/btw TEXT` asks a side question in a titled fork at the latest completed turn,
and `/recap` does the same with a fixed ten-line summary prompt. The answer opens
over the main session, which receives no conversation events; the fork remains
in `/resume` because DSH does not expose root release.
Both commands require an idle root because DSH forks of a running source seed
and immediately run pending input, with no option to exclude post-boundary inbox items.
DSH's cold list cannot surface a large seeded fork's title after relaunch, so
that picker row may be untitled; its UUID remains resumable.

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
inserts the selection. dashi provides `/help`, `/status`, `/usage`, `/new`, `/resume`,
`/clear`, `/reset`, `/continue`, `/fork`, `/branch`, `/rewind`, `/rename`, `/model`, `/effort`, `/permission`, `/config`, `/login`, `/logout`,
`/agents`, `/queue`, `/context`, `/init`, `/memory`, `/skills`, `/diff`, `/plugins`, `/plugin`, `/tasks`, `/bashes`, `/subtask`, `/loop`,
`/history`, `/export`, `/copy`, and `/exit`;
every other slash
submission is handled by DSH's command service or sent as ordinary prompt
text when no command matches.

`/reset`, `/continue`, `/branch`, and `/quit` alias `/clear`, `/resume`, `/fork`,
and `/exit`; `/effort LEVEL` changes only the current model's reasoning effort
through DSH's model selection.
DSH 0.2 refuses launch model/provider routes absent from its available model catalog;
custom routes must first be declared through the native provider configuration.
`/clear [NAME]` starts a fresh session, naming the previous one when NAME is supplied.
`/agents` selects the current blank
session's native DSH agent preset; after a conversation starts, choosing a
preset starts a new session with it. DSH 0.2 presets are declared in profile
patches; `/agents` no longer creates, copies or deletes them. The shipped
`standard` preset supplies dashi's question, presentation, Ralph, time-context
and scoped subagent tools. Custom presets can add tools but cannot remove
DSH's host-level tools, and do not implicitly inherit those standard-only rows.
`/usage` shows DSH's whole-session token buckets,
turns, steps, and measured model/tool time; plan limits and cost, per-model
breakdown, and tool-call count are DSH gaps. `/context` shows DSH's heuristic system, tool-schema,
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
hunks recorded by DSH for the last completed turn. `/tasks` opens the job and subagent
details view, Enter reads selected job output, and `/tasks kill ID` stops a job;
`/bashes` aliases it. The job list includes unowned jobs; background subagents
are native activations shown in the separate child catalog, not job rows.
Reading job output does not consume the model's job result. `/subtask TEXT`
starts a native child activation with TEXT as its prompt. `/loop 5m TEXT` or `/loop 1h TEXT` creates a DSH-owned
fixed-rate reminder whose firing submits TEXT as a prompt; `/loop` lists active
schedules and `/loop stop ID` cancels one. DSH sets the minimum interval to
one minute on DSH 0.2.1-alpha.2. Child agents see the schedule tools but DSH refuses their use.
Sessions requiring a format migration are labelled in `/resume`; a cold fork
that requires migration is refused by DSH rather than silently rewritten.
`/plugins` lists each
running profile row's id, module, enabled
state, and fiber phase; MCP client rows also show their configured server name.
`/config` shows DSH's settings document path and profile entry IDs with their
effective, base, and user layers; `/config NAMESPACE KEY=VALUE` writes through
DSH's validated provider using one of those entry IDs.
`/login [KEY [METHOD]]` lists or starts DSH authorization flows; `/logout [KEY]`
lists stored record metadata or forgets one credential without reading its value.
`/plugin ARGS` passes ARGS to `dsh plugin --profile <running profile>` and
reports how a successful change loads. A package that ships a DSH bundle is
appended to the profile's bundle list by `dsh plugin add` and loads on the next
launch. A plain plugin package is installed but gets no loader row, so it needs
an `insert` row in the profile's `cordis.patch.yml`; DSH's live patch reload
then applies it without restart. Human `!` commands receive the same resolved
`DSH_HOME` as the running profile.
`/export [path]` writes the complete current transcript as Markdown under the
session working directory; its default filename is `dashi-SESSION_UUID.md`.

F1 opens help, Shift+Tab cycles permission presets, Ctrl+T switches a running
root between steer and next-turn input, Ctrl+O cycles the global tool-card mode,
and Ctrl+B opens job and subagent details.
On an idle empty composer, Ctrl+C or Ctrl+D arms exit; press either key again
within 1.5 seconds to exit. Any other key cancels the arm. On an idle nonempty
composer, Escape twice clears the draft into prompt history, where Up recalls it.
Up/Down recall follows durable input order, including slash commands and
`!command`; commands with `recordInput: false` stay absent.
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

The automated PTY matrix runs on Linux and macOS with xterm, tmux, GNU screen,
the Linux console where available, and dumb-terminal capabilities. The macOS
host gate requires Homebrew tmux and GNU screen 4.1 or newer:

```sh
brew install tmux screen
```

Ensure `command -v screen` resolves the Homebrew binary; macOS's
`/usr/bin/screen` 4.0 is too old for the test harness.

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

Historical cold-resume measurements on the retired DSH 0.1 line were quadratic
in event count: DSH 0.1.5-rc.2 (10k: 1.63 s;
50k: 11.88 s; 100k: 47.25 s; 200k: 183.09 s) and 0.1.6-alpha.2
(50k: 11.76 s; 200k: 183.22 s) because
its token-meter fold cloned and scanned the retained surface per event
(`packages/llm/token-meter/src/breakdown-projection.ts:56-75`, introduced by
deepseek-ai/deepseek-harness commit `6525195953`).

DSH conversation forks are per-turn, so a steered prompt rewinds to the start
of its containing turn. DSH also exposes no operation to summarize a selected
range. Installing roller may add workspace restore, but dashi does not
duplicate it.

The Session Controller has no root-release operation, so roots left by
`/new`, `/resume`, `/fork`, or `/rewind` remain idle until profile teardown.
DSH's Session Controller also hard-requires its web-only file-upload service;
the terminal profile provides a no-upload service and rejects file receipts as unstaged.

DSH's plugin CLI exposes no enable/disable verb, so dashi cannot toggle profile
rows in-session. The MCP client exposes configured server names but no live
connection-status API, so `/plugins` reports ordinary plugin fiber state, not
connection health. Stdio MCP servers also inherit DSH's stderr, so server logs
can overwrite an active terminal; dashi does not patch the DSH transport.
Hooks, add-dir, and
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
