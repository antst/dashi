# Changelog

## 0.1.0-alpha.12 — 2026-09-04

- Window list and info overlays to the viewport with hidden-row markers; PageUp/PageDown scroll info overlays.
- Render completed assistant responses as markdown.
- Add a persistent status line with model, permission preset, context use, cache-hit rate, and git branch.
- Document that stdio MCP server logs inherit the terminal (a DSH gap) with a regression fixture.

## 0.1.0-alpha.11 — 2026-09-04

- Add `/btw` and `/recap`: ask a side question in a fork of the session without touching the conversation.
- Add `/loop` fixed-rate reminders over DSH's schedule service.
- Add `/usage` session token and timing totals.
- Add `/clear NAME`, `/reset NAME`, and `/new NAME` to name the previous conversation before starting fresh.
- Add `/agents new`, `copy`, and `delete` over DSH's preset authoring.
- Add `--system-prompt`, `--system-prompt-file`, `--append-system-prompt`, and `--append-system-prompt-file`.
- Add `--verbose` to start with tool cards expanded.
- Fix `/plugin` failing with a read-only profile directory under the session sandbox.

## 0.1.0-alpha.10 — 2026-09-04

- Add `--tools` and `--disallowedTools` launch flags over DSH's tool restriction.
- Add job output and `kill` to `/tasks`, the `/bashes` alias, and `/subtask`.
- Expire the shared Ctrl+C/Ctrl+D exit arm after 1.5 seconds.

## 0.1.0-alpha.9 — 2026-09-04

- Add `/login` and `/logout` over DSH's authorization and credential services.
- Add `/skills` to list and filter the skills DSH resolved for the session.
- Add `/init` to create a starter `AGENTS.md`.
- Extend `/copy` with `/copy N` and a `/copy code` block picker.
- Add the `/quit`, `/reset`, `/continue`, `/branch`, and `/effort` aliases and the `-n`, `--agent`, `--session-id`, and `--fork-session` flags.

## 0.1.0-alpha.8 — 2026-09-04

- Load DSH agent instructions, including workspace `AGENTS.md`, in dashi sessions.
- Add `/memory` for inspecting and editing the instruction files DSH loaded.
- Add `/config` for reading and updating native DSH settings.
- Add `/diff` and `/diff turn` for working-tree and last-turn changes.
- Add `/plugins`, `/plugin`, and launcher help through `--help` and `-h`.

## 0.1.0-alpha.7 — 2026-09-03

- Add launch flags for model, provider, effort, and permission selection.
- Collapse DSH-injected context rows while preserving expansion and history.
- Run CI and release gates in the shared container environment.

## 0.1.0-alpha.6 — 2026-09-03

- First version published by the tag workflow with npm provenance.

## 0.1.0-alpha.5 — 2026-09-03

- Add GitHub CI, pkg.pr.new previews, and provenance-ready npm publishing.
- Expire the shared Ctrl+C/Ctrl+D exit arm after two seconds.
- Create GitHub releases and publish all three packages from version tag pushes.

## 0.1.0-alpha.4 — 2026-09-03

- Require a two-stage Ctrl+D exit, sharing the same armed state as Ctrl+C.
- Open the session picker for bare `--resume`/`-r`, accept session names for
  launch and `/resume`, and support `--continue`/`-c`.
- Add the Claude Code-style rewind flow for restoring conversation, code, or
  both while leaving the chosen prompt in the composer.
- Bundle `@antst/roller` in `@antst/dashi-app` for file rewind by default.

## 0.1.0-alpha.3 — 2026-09-03

- Track and pin the validated DSH 0.1.2-rc.1 package set.
- Reject mixed DSH dependency graphs during the release gate and clean-install
  test, and warn when the running CLI loads a different `dsh-base` version.
- Document the pnpm override and clean upgrade procedure required for
  prerelease DSH.

## 0.1.0-alpha.2 — 2026-09-03

This alpha contains:

- the `@antst/dashi` TUI plugin, installable `@antst/dashi-app` profile bundle,
  and zero-dependency `@antst/dashi-launcher` command;
- streaming chat, presenter-owned tool and diff cards, approvals, questions,
  model and permission selection, session create/list/resume/fork/rewind,
  history/search, completion, skills, images, shell commands, plans, todos,
  jobs, subagents, context estimates, and transcript export;
- main-screen inline rendering by default with terminal-owned scrollback and
  selection, plus an optional mouse-enabled full-screen viewport;
- DSH service peer dependencies, installed-profile drift checks, packed-package
  clean-install coverage, terminal matrices, performance gates, and shutdown
  fault injection.

Known DSH gaps:

- no cross-process session-writer ownership;
- conversation-only native rewind; workspace restore requires an external
  plugin such as roller;
- no root-release operation, so replaced roots remain idle until teardown;
- no native MCP roster/management, login, hooks, add-dir, memory editing, Git
  diff, or autocompact-tuning surface for dashi.
