# Parity with Claude Code interactive mode

Date: 2026-09-03

Pinned DSH: `dsh-v0.1.2-rc.1`, commit
`a66e4702047846cdaa10c66c9d3df3951f5ea70d`.

Audit basis is the current Claude Code
[command roster](https://code.claude.com/docs/en/commands) and
[launch-flag roster](https://code.claude.com/docs/en/cli-usage), read
2026-09-03. DSH citations below are relative to the pinned rc.1 tree
`/tmp/claude-1000/-home-antst-dtui/4e09852f-b0d6-4344-b2c4-741ea0134a4b/scratchpad/dsh-0.1.2-rc.1`.
“Done” means the developer capability exists (the dashi spelling is called out
where it differs); missing aliases are kept visible rather than counted as new
mechanisms.

| Claude item | dashi status | Evidence / owner, or exact missing DSH surface |
|---|---|---|
| `/help`; `--help`, `-h` | done | One shared help/version source: `packages/dashi/src/help.ts:1-5`; command and startup surfaces: `packages/dashi/src/session-runtime.ts:569-577` and `packages/dashi/src/index.ts:152-154`. |
| `--version` | done | DSH owns and consumes the root flag at `apps/cli/src/args.ts:106-119`; `README.md:49-50` documents that `dashi --version` therefore prints DSH, while `--help` prints both versions. |
| `-v` | DSH gap | DSH root owns this flag before the app sees argv, but rc.1 exposes `-V` rather than Claude’s `-v` at `apps/cli/src/args.ts:112-119`. The dumb launcher cannot add the alias. |
| `/exit`, Ctrl+C/Ctrl+D exit; `/quit` alias | done / doable | Exit behavior is `packages/dashi/src/session-runtime.ts:813-821` and `packages/dashi/src/state.ts:350-367`. Only the `/quit` spelling is absent; DSH CommandRuntime owns scoped aliases at `packages/interaction/commands/src/index.ts:249-289`. |
| `/clear`, `/new`; `/reset` alias; `/clear NAME` | done / doable | Fresh roots are `packages/dashi/src/session-runtime.ts:631-652`. `/reset` and Claude’s “name the previous root, then clear” variant are direct scoped commands using SessionController.rename/create at `packages/api/session-controller/src/index.ts:234-246` and `:305-317`. |
| `/resume`, `--resume`/`-r`, `--continue`/`-c`, names/UUIDs/picker/all; `/continue` slash alias | done / doable | Launch parser: `packages/dashi/src/index.ts:59-65`. Runtime picker/name/ID resolution: `packages/dashi/src/session-runtime.ts:655-666`. Only the slash alias is absent; CommandRuntime.register owns it at `packages/interaction/commands/src/index.ts:269-280`. |
| `/rename NAME`, `--name`; `-n`; `/rename` with no name | done / doable | Explicit rename is `packages/dashi/src/session-runtime.ts:765-776` and launch `--name` is `packages/dashi/src/index.ts:49-58`. `-n` is only an argv alias. Automatic retitling is already an owned operation, SessionTitleService.refresh, at `packages/session/session-title/src/index.ts:422-461`. |
| `/branch`; dashi `/fork`; `/checkpoint` and `/undo` aliases | doable / done | Dashi `/fork` already implements Claude’s switch-into-branch behavior at `packages/dashi/src/session-runtime.ts:669-677`; exact `/branch` and rewind aliases are CommandRuntime registrations over SessionController.fork at `packages/api/session-controller/src/index.ts:310-317` and existing rewind. |
| `/rewind` | done | Conversation/code restore UI is `packages/dashi/src/session-runtime.ts:680-688`; the shipped command list is `packages/dashi/src/state.ts:360-365`. |
| `/model`, `--model`, `--effort`, `--provider` | done | `packages/dashi/src/session-runtime.ts:779-787` and `:889-908`; launch parsing is `packages/dashi/src/index.ts:49-58`. |
| `/effort` | doable | Same owned SessionController.selectModel operation can retain provider/model and change reasoningEffort: `packages/api/session-controller/src/index.ts:239-247` and `packages/api/session-controller/src/types.ts:268-275`. |
| `/plan`, `/goal`, `/compact` (no arguments) | done | Native DSH commands are used unchanged: `packages/plan/plan-mode/src/index.ts:211-245`, `packages/goal/command-goal/src/index.ts:188-195`, `packages/compaction/command-compact/src/index.ts:57-105`. |
| `/compact INSTRUCTIONS` | DSH gap | rc.1’s native compact command is explicitly no-args (`packages/compaction/command-compact/src/index.ts:13` and `:57-76`); CompactionEngine has no focus-instruction request field. |
| `/permission`, `/sandbox`; `--permission`/`--permission-mode`; `--yolo`/`--dangerously-skip-permissions`; `--allow-dangerously-skip-permissions` | done | Dashi uses `--permission` for Claude’s `--permission-mode` and always keeps the danger preset in the cycle, so no opt-in flag is needed. Native preset command/list/current: `packages/interaction/permission-presets/src/index.ts:252-309`; dashi wrapper: `packages/dashi/src/session-runtime.ts:790-799`. |
| `/context` | done | `packages/dashi/src/session-runtime.ts:591-599`; it reads DSH-owned context/token projections. |
| `/status` (session/model/preset/profile/workspace/token use) | done | `packages/dashi/src/session-runtime.ts:580-588`; exact facts are rendered from the bound DSH root and projections. Account quota and MCP connectivity are separately marked gaps below. |
| `/export [file]` | done | Explicit, sandboxed named export is `packages/dashi/src/session-runtime.ts:730-751`. |
| `/copy` latest | done | `packages/dashi/src/session-runtime.ts:754-762`. |
| `/copy N`, code-block picker, write selection | doable | Lossless history is owned by SessionController.page/follow at `packages/api/session-controller/src/index.ts:362-381` and `packages/api/session-controller/src/types.ts:381-465`; dashi only needs another selection surface. |
| `/plugins`; `/plugin add/remove/update/why` | done | Inventory and verbatim DSH CLI passthrough are `packages/dashi/src/session-runtime.ts:602-628`. |
| `/plugin enable/disable`; `/reload-plugins` | DSH gap | rc.1 plugin CLI’s verb set has no enable/disable/reload and Loader exposes no safe live profile-reload transaction: `apps/cli/src/plugin.ts:120-162`. |
| `/tasks` list | done | `packages/dashi/src/session-runtime.ts:702-710` and the Ctrl+B activity surface. |
| `/tasks` management, `/bashes` alias | doable | JobRegistry already owns list/get/read/kill at `packages/jobs/jobs/src/index.ts:73-120`. |
| `/subtask TASK` | doable | SubagentRuntime owns continuable child creation and interruption at `packages/subagent/subagent/src/index.ts:190-232` and `:278-295`. |
| `/agents` (roster/select; authoring UI) | done / doable | Selection exists at `packages/dashi/src/session-runtime.ts:713-727`. DSH owns the live roster at `packages/preset/agent-presets/src/index.ts:244-273` and read/copy/delete authoring at `:495-605`. |
| `/skills` list/search | doable | DSH SkillSummary carries name, description, invocation policy, source, provider and path at `packages/skill/skill/src/index.ts:56-93`; SessionSkillCatalog provides cold/live session-addressed listing at `packages/api/session-controller/src/skill-catalog.ts:28-87`. |
| `/skills` visibility toggling | DSH gap | SkillSummary exposes resolved invocation policy, but rc.1 has no service/settings operation to mutate per-skill visibility; `packages/skill/skill/src/index.ts:50-69` is read-only metadata. |
| `/reload-skills` | done | The filesystem provider watches by default at `packages/skill/skill-filesystem/src/index.ts:45-89`, registers its watcher at `:129-143`, and re-lists live roots at `:176-221`; dashi needs no manual reload command. |
| `/memory`: open the instruction files DSH actually loaded | doable | The durable agent-instructions source owns its changes at `packages/context/agent-instructions/src/state.ts:36-51`; observed/included files carry paths/content at `packages/context/agent-instructions/src/files.ts:23-34` and `:65-71`; ShellExecutor owns launching EDITOR at `packages/shell/shell/src/index.ts:64-99`. |
| `/memory` auto-memory enable/entries | DSH gap | rc.1 has instruction-file context, but no auto-memory store/service or enable/disable surface. |
| `/diff`: current git diff plus per-turn edits | doable | Current diff can use ctx.shell (`packages/shell/shell/src/index.ts:64-99`); DSH persists each write/edit hunk in opaque tool-result metadata at `packages/fs/tool-fs/src/diff.ts:13-20` and exposes raw history through SessionController.page at `packages/api/session-controller/src/index.ts:362-370`. |
| `/config`, `/settings`: effective settings and key=value edits | doable | SettingsProvider.describe returns every namespace with schema/value/base/user/revision at `packages/settings/settings/src/index.ts:498-537`; update/replace/mutate are public validated, serialized writes at `:550-617`. |
| `/init` (`AGENTS.md` starter) | doable | ctx.fs owns path resolution and atomic text creation at `packages/fs/fs/src/index.ts:107-126` and `:223-241`. |
| `/hooks` | DSH gap | The bridge parses once into a closure at `packages/hooks/hooks-claude-code/src/index.ts:97-117` and consumes private parsed groups at `:138-187`; there is no hook registry/list service exposing the exact active hooks. Re-reading configPath would not prove what DSH loaded. Codex bridge has the same shape. |
| `/login` | doable | AuthorizationService lists flows and begins a provider-owned interactive attempt at `packages/credentials/authorization/src/index.ts:220-311`; llm-pi-ai registers real provider flows at `packages/llm/llm-pi-ai/src/login.ts:112-160`. |
| `/logout` | doable | CredentialProvider owns record enumeration/deletion at `packages/credentials/credentials/src/index.ts:211-256`; llm-pi-ai exports recordKeyFor and already deletes exactly that record at `packages/llm/llm-pi-ai/src/auth.ts:141-185`. |
| `/loop`, `/proactive` | doable | `@deepseek-ai/dsh-schedule` owns durable one-shot/fixed-rate reminders and root runtime at `packages/schedule/schedule/src/index.ts:1-38` and `:42-69`; EveryScheduleRecord is `packages/schedule/schedule/src/types.ts:38-49`. |
| Local bundled skill commands: `/batch`, `/code-review` and `/review`, `/dataviz`, `/doctor` and `/checkup`, `/run`, `/run-skill-generator`, `/security-review`, `/simplify`, `/verify`, `/workflow-authoring` | doable | DSH skills carry full bodies and source paths at `packages/skill/skill/src/index.ts:56-93`; human invocation is first-class at `packages/skill/tool-skill/src/index.ts:163-204`. The generator can write through ctx.fs and the live watcher above. |
| `/deep-research` as a local dynamic workflow | doable | Same skill entry can start the DSH WorkflowEngine, whose public start request takes script/meta/args/parent and returns a cancellable live run: `packages/workflow/workflow/src/index.ts:150-168` and `packages/workflow/workflow/src/runtime-types.ts:15-48`. |
| `/workflows` progress/pause/resume/save | DSH gap | WorkflowEngine exposes only caller-held start/cancel/dispose; no process run registry, list, pause, resume, or save API: `packages/workflow/workflow/src/index.ts:150-168` and `packages/workflow/workflow/src/runtime-types.ts:36-48`. |
| `--agent` | doable | SessionCreateRequest already accepts agentPreset at `packages/api/session-controller/src/types.ts:254-260`; SessionController.create owns the bindable session at `packages/api/session-controller/src/index.ts:229-237`. |
| `--session-id` | doable | Same SessionCreateRequest accepts sessionId at `packages/api/session-controller/src/types.ts:254-260`. |
| `--fork-session` with resume/continue | doable | SessionController.fork owns a cold-readable completed-turn fork at `packages/api/session-controller/src/index.ts:310-317` and `packages/api/session-controller/src/types.ts:290-299`. |
| `--tools`; bare-name portion of `--disallowedTools` | doable | ToolRuntime.restrict is deliberately agent-scoped and accepts allow/deny masks at `packages/core/tools/src/index.ts:1054-1088`. |
| `--allowedTools`; scoped-pattern portion of `--disallowedTools`; `/permissions` and `/allowed-tools` rule editor; `/fewer-permission-prompts` | DSH gap | Tool restriction only masks whole registered names. Permission presets choose coarse modes, but rc.1 has no per-tool/path/command-pattern allow/ask/deny rule registry or mutation API. |
| `--system-prompt[-file]`, `--append-system-prompt[-file]` | doable | SystemPrompt sections are ordered, scoped, and can declare one complete replacement at `packages/core/system-prompt/src/index.ts:52-74` and `:424-440`; scoped assembly is authoritative at `:526-585`. |
| `--autocompact`; `/autocompact` | DSH gap | rc.1 has automatic compaction policy internally, but no session-scoped threshold/window read-write service or command API. |
| `--add-dir`; `/add-dir`; `/cd` | DSH gap | SessionCreateRequest has one immutable cwd (`packages/api/session-controller/src/types.ts:254-260`); there is no current-session cwd mutation or additional authorized-root service. |
| `/background` and `/bg`; `--background`/`--bg`; Claude `/fork` background copy; `/stop` | DSH gap | SessionController persists and controls sessions, but rc.1 has no root-session supervisor/detach/attach/background-process lifecycle API. Dashi exits with its one process. |
| `/btw`; `/recap` | DSH gap | No auxiliary, context-aware, no-history model-call service exists. Sending through Agent/Session changes the durable conversation; raw ctx.llm would require dashi to reconstruct context ownership. |
| `/mcp` status/reconnect/enable/disable | DSH gap | mcp-client keeps per-server state private (`packages/mcp/mcp-client/src/index.ts:137-150` and `:192-224`); no public status, reconnect, or enable/disable service exists. |
| `/list-agents`, `/peers`; `--teammate-mode` | DSH gap | Core DSH has subagent lineage, not a cross-session peer roster/messaging/display service. W-036’s external dsh-comms plugin is the planned owner, not rc.1 core. |
| `/fast` | DSH gap | Model selection has provider/model/effort only (`packages/api/session-controller/src/types.ts:268-275`); no session route-speed mode exists. |
| `/usage`, `/cost`, `/stats`: local tokens/turn timing | done / doable | Dashi `/status` already shows token usage. Richer local totals are owned by tokenUsageProjection at `packages/llm/token-meter/src/usage-projection.ts:121-158` and SessionStats at `packages/session/session-stats/src/types.ts:15-45`. |
| `/usage` plan limits/cost; `/status` account/connectivity | DSH gap | rc.1 exposes no provider billing, plan quota, account-status, or public MCP connectivity service. |
| `--verbose` full expansion | doable | The lossless document is already available through SessionController page/follow (`packages/api/session-controller/src/index.ts:362-381`); this is a launch-scoped initial presentation choice over DSH-owned history. |
| `--ax-screen-reader` | done | Capability exists as dashi `--accessible` and is documented from the shared flag list at `packages/dashi/src/help.ts:4-5`; rendering mode parsing is `packages/dashi/src/index.ts:30-48`. Exact Claude spelling is only an alias if desired. |
| `/tui`; renderer selection | done / DSH gap | Launch-scoped inline/fullscreen is `packages/dashi/src/index.ts:46-48`. Live relaunch with conversation intact is a DSH gap: no app-host respawn/relaunch handoff API. |
| `/color`, `/focus`, `/keybindings`, `/scroll-speed`, `/statusline`, `/theme` | DSH gap | rc.1 has no DSH-owned terminal presentation preferences/keymap/statusline service. Persisting these in dashi would violate one-owner/zero-state; launch-only renderer/accessibility are the existing bounded exceptions. |
| `/voice` | DSH gap | No DSH voice-capture/transcription/input service exists. |
| `/debug`; `--debug`, `--debug-file` | DSH gap | Cordis supplies a logger to plugins, but rc.1 exposes no runtime log-level/category/sink control service to the app. |
| `--agents` inline JSON | DSH gap | AgentPresets re-reads filesystem compositions live (`packages/preset/agent-presets/src/index.ts:93-100`) and can copy/delete authored presets, but has no launch-scoped ephemeral preset-definition API. |
| `--disable-slash-commands` | DSH gap | CommandRuntime can register/list scoped definitions (`packages/interaction/commands/src/index.ts:249-293`) but has no scoped restriction/suppression operation for commands plus skills. |
| `--fallback-model` | DSH gap | rc.1 RequestErrorAction can only retry or stop (`packages/core/agent/src/runtime-types.ts:66`); llm-retry implements provider policy retries, not route switching (`packages/llm/llm-retry/src/index.ts:194-223`). |
| `--bare`; `--safe-mode` | DSH gap | They require launch-scoped suppression of an already composed profile (instructions, skills, hooks, plugins, MCP, presets). rc.1 Loader exposes no transactional “compose this root without these rows” app API. |
| `--mcp-config`, `--strict-mcp-config` | DSH gap | MCP servers are profile plugin rows and mcp-client has no launch-scoped ephemeral config owner or strict-overlay API. |
| `--plugin-dir`, `--plugin-url` | DSH gap | DSH plugin management durably mutates the profile for next launch; there is no per-session ephemeral plugin-loader surface. |
| `--setting-sources`, `--settings` | DSH gap | SettingsProvider owns the active durable document and per-namespace writes, but exposes no launch-scoped source-selection or JSON-overlay layer. |
| `--from-pr`; `--worktree`/`-w`; `--tmux` | DSH gap | rc.1 has no PR linkage, git-worktree lifecycle, or terminal-multiplexer session service. Shelling out would leave dashi owning durable lifecycle facts. |

Reviewed and excluded by W-035’s “driving DSH from a terminal” boundary, not
left unknown:

- Claude/Anthropic account, cloud, browser, IDE, marketing, updater, or
  product-diagnostics commands: `/advisor`, `/artifacts`, `/autofix-pr`, `/bug`
  and `/share`, `/chrome`, `/claude-api`, `/design`, `/design-login`,
  `/design-sync`, `/desktop` and `/app`, `/heapdump`, `/ide`, `/import`,
  `/insights`, `/install-github-app`, `/install-slack-app`, `/mobile`, `/passes`,
  `/powerup`, `/privacy-settings`, `/radio`, `/rate-limit-options`,
  `/release-notes`, `/remote-control` and `/rc`, `/remote-env`, `/schedule` and
  `/routines` (cloud; local `/loop` is in the table), `/setup-bedrock`,
  `/setup-vertex`, `/stickers`, `/team-onboarding`, `/teleport` and `/tp`,
  `/terminal-setup`, `/ultrareview` cloud mode, `/upgrade`, `/usage-credits`,
  `/web-setup`. Removed `/pr-comments`, `/ultraplan`, and `/vim` were also
  checked and excluded.
- Non-interactive/headless/server/evaluation launch flags:
  `--append-subagent-system-prompt`, `--betas`, `--channels`,
  `--chrome`/`--no-chrome`, `--cloud`/`--remote`,
  `--dangerously-load-development-channels`, `--environment`,
  `--exclude-dynamic-system-prompt-sections`, `--exec`,
  `--forward-subagent-text`, `--ide`, `--init`/`--init-only`,
  `--include-hook-events`, `--include-partial-messages`, `--input-format`,
  `--json-schema`, `--maintenance`, `--max-budget-usd`, `--max-turns`,
  `--no-session-persistence`, `--output-format`, `--permission-prompt-tool`,
  `--print`/`-p`, `--prompt-suggestions`, `--ref`,
  `--remote-control`/`--rc` and its name-prefix, `--replay-user-messages`,
  `--restricted`, `--teleport`. `--advisor` is likewise
  Anthropic/Fable-specific rather than a DSH terminal contract.

Three findings reverse the initial guesses:

- `/login` and `/logout` are doable because rc.1 has real authorization and
  credential seams.
- `/hooks` is a DSH gap because the exact loaded hook set is closure-private.
- Whole-tool `--tools`/deny is doable because ToolRuntime has an agent-scoped
  restriction seam, while pattern permission rules remain a gap.
