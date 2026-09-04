import {
  Editor,
  Markdown,
  TuiAltScreen,
  TuiMainScreen,
  stripTerminalSequences,
  truncateToWidth,
  wrapTextWithAnsi,
  type EditorTheme,
  type MarkdownTheme,
  type Terminal,
  type TUI,
} from '@earendil-works/pi-tui'
import { caretOffset, installInput, type InputBindings } from './input.js'
import { hasCompletionTrigger } from './completion-trigger.js'
import type {
  ComposerCursor, JobView, Overlay, PendingDecision, SubagentView, TerminalCell, ToolMode, ViewState,
} from './state.js'
import { createProcessTerminal, type TerminalSession } from './terminal-guard.js'

const RESET = '\u001B[0m'
const BOLD_CYAN = '\u001B[1;36m'
const DIM = '\u001B[2m'
const FAINT_BORDER = '\u001B[90m'
const GREEN = '\u001B[32m'
const RED = '\u001B[31m'
const YELLOW = '\u001B[33m'
const COPY_LIMIT = 64 * 1024
const OVERSCAN_CELLS = 8
const THEME_GENERATION = 1
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const
const SPINNER_INTERVAL_MS = 80
const MASK_TOKEN = new RegExp(String.raw`\u001B(?:\[[0-?]*[ -/]*[@-~]|[_P^X][^\u0007]*(?:\u0007|\u001B\\))|[^\s]`, 'gu')

const markdownTheme: MarkdownTheme = {
  heading: text => `\u001B[36m${text}${RESET}`,
  link: text => `\u001B[36m${text}${RESET}`,
  linkUrl: text => `${DIM}${text}${RESET}`,
  code: text => `${YELLOW}${text}${RESET}`,
  codeBlock: text => `${GREEN}${text}${RESET}`,
  codeBlockBorder: text => `${DIM}${text}${RESET}`,
  quote: text => `${DIM}${text}${RESET}`,
  quoteBorder: text => `${DIM}${text}${RESET}`,
  hr: text => `${DIM}${text}${RESET}`,
  listBullet: text => `\u001B[36m${text}${RESET}`,
  bold: text => `\u001B[1m${text}\u001B[22m`,
  italic: text => `\u001B[3m${text}\u001B[23m`,
  strikethrough: text => `\u001B[9m${text}\u001B[29m`,
  underline: text => `\u001B[4m${text}\u001B[24m`,
}

export type CopyResult = 'ok' | 'too-large' | 'unsupported'

export interface Renderer extends TerminalSession {
  bell(): void
  copy(text: string): CopyResult
  discardSecretComposer(): void
  materializedCells(): number
  setComposer(text: string, cursor?: ComposerCursor): void
}

export interface RendererOptions extends InputBindings {
  readonly accessible?: boolean
  readonly inline: boolean
  readonly terminal?: Terminal
  readonly terminalType?: string
}

export function supportsOsc52(terminalType: string | undefined): boolean {
  return terminalType?.toLocaleLowerCase() !== 'dumb'
}

function setEditor(editor: Editor, text: string, cursor?: ComposerCursor): void {
  editor.setText(text)
  if (cursor === undefined) return
  const lines = text.split('\n')
  const lineIndex = Math.max(0, Math.min(cursor.line, lines.length - 1))
  const line = lines[lineIndex] ?? ''
  const col = Math.max(0, Math.min(cursor.col, line.length))
  const suffix = `${line.slice(col)}${lines.slice(lineIndex + 1).map(value => `\n${value}`).join('')}`
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(suffix)].length
  for (let step = 0; step < graphemes; step++) editor.handleInput('\u001B[D')
}

function toolText(cell: TerminalCell, mode: ToolMode, accessible: boolean): string {
  const card = cell.tool
  const color = cell.kind === 'error' ? RED : cell.pending ? YELLOW : GREEN
  const marker = accessible
    ? `[${cell.kind === 'error' ? 'error' : cell.pending === true ? 'pending' : 'done'}]`
    : cell.pending === true ? '○' : '●'
  if (card === undefined) return `${color}${marker} ${plain(cell.text)}${RESET}`
  const status = card.status === undefined ? '' : `  ${DIM}${plain(card.status)}${RESET}`
  const summaries = card.diffs?.map(diff => `${plain(diff.path)} ${GREEN}+${String(diff.added)}${RESET} ${RED}-${String(diff.removed)}${RESET}`) ?? []
  const head = `${color}${marker} ${plain(card.title)}${RESET}${status}${summaries.length === 0 ? '' : `  ${summaries.join(' · ')}`}`
  if (mode !== 'expanded' || cell.collapsed === true) return head
  const body = card.diffs === undefined
    ? card.body
    : card.diffs.flatMap(diff => [`${FAINT_BORDER}── ${plain(diff.path)}${RESET}`, ...diff.lines.map(value => plain(value))]).join('\n')
  return body === undefined || body === '' ? head : `${head}\n${DIM}${plain(body, true)}${RESET}`
}

function cellText(cell: TerminalCell, toolMode: ToolMode, accessible: boolean, now = Date.now()): string {
  if (cell.tool !== undefined || cell.kind === 'tool') return toolText(cell, toolMode, accessible)
  const raw = accessible && cell.kind === 'todo'
    ? cell.text.replace(/^✓ /gmu, '[done] ').replace(/^● /gmu, '[active] ').replace(/^○ /gmu, '[pending] ')
    : cell.text
  const safe = plain(raw, true)
  switch (cell.kind) {
    case 'user': return `${BOLD_CYAN}You${RESET}\n${safe}`
    case 'assistant': return `${BOLD_CYAN}Assistant${RESET}\n${safe}`
    case 'command': {
      const elapsed = cell.elapsedMs ?? (cell.startedAt === undefined ? undefined : Math.max(0, now - cell.startedAt))
      const marker = cell.pending === true
        ? accessible ? '[running]' : SPINNER_FRAMES[Math.floor(now / SPINNER_INTERVAL_MS) % SPINNER_FRAMES.length]
        : accessible ? '[done]' : '◆'
      return `${cell.pending === true ? YELLOW : DIM}${marker} ${safe}${elapsed === undefined ? '' : ` · ${duration(elapsed)}`}${RESET}`
    }
    case 'context': {
      if (cell.collapsed !== true || cell.detail === undefined) return `${DIM}Context · ${safe}${RESET}`
      const head = `${DIM}Context · ${plain(cell.detail, true)}${RESET}`
      return toolMode === 'expanded' ? `${head}\n${safe}` : head
    }
    case 'shell': return `${DIM}Shell${RESET}\n${safe}`
    case 'compaction': return `${DIM}${accessible ? '[compacted]' : '↻'} ${safe}${RESET}`
    case 'reasoning': return cell.collapsed
      ? `${DIM}Thinking · ${[...safe].length} characters${RESET}`
      : `${DIM}Thinking${RESET}\n${safe}`
    case 'outcome': return `${DIM}${accessible ? '[done]' : '✓'} ${safe}${RESET}`
    case 'todo': return cell.collapsed ? `${DIM}${safe}${RESET}` : `${BOLD_CYAN}${safe}${RESET}`
    case 'error': return `${RED}Error · ${safe}${RESET}${cell.detail === undefined ? '' : `\n${DIM}${plain(cell.detail)}${RESET}`}`
  }
}

function duration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1_000))
  if (seconds < 60) return `${String(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${String(minutes)}m ${String(seconds % 60)}s`
  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`
}

function jobElapsed(job: JobView, now: number): number {
  return Math.max(0, (job.finishedAt ?? now) - job.startedAt)
}

function subagentElapsed(subagent: SubagentView, now: number): number | undefined {
  if (subagent.elapsedMs === undefined) return undefined
  if (subagent.active === undefined) return subagent.elapsedMs
  const through = subagent.state === 'running' ? now : subagent.active.through
  return subagent.elapsedMs + Math.max(0, through - subagent.active.since)
}

type Activity = { readonly kind: 'job'; readonly value: JobView } | { readonly kind: 'subagent'; readonly value: SubagentView }

function activities(state: ViewState): readonly Activity[] {
  return [
    ...(state.root?.subagents ?? []).map(value => ({ kind: 'subagent' as const, value })),
    ...(state.root?.jobs ?? []).map(value => ({ kind: 'job' as const, value })),
  ]
}

function latestPendingCommand(cells: readonly TerminalCell[]): TerminalCell | undefined {
  for (let index = cells.length - 1; index >= 0; index--) {
    const cell = cells[index]
    if (cell?.kind === 'command' && cell.pending === true) return cell
  }
}

function activityText(activity: Activity, now: number): string {
  if (activity.kind === 'job') {
    const job = activity.value
    return `Job · ${job.label} · ${job.status} · ${duration(jobElapsed(job, now))}${job.detail === undefined ? '' : ` · ${job.detail}`}`
  }
  const subagent = activity.value
  const elapsed = subagentElapsed(subagent, now)
  return `Subagent · ${subagent.label} · ${subagent.state}${elapsed === undefined ? '' : ` · ${duration(elapsed)}`}${subagent.summary === undefined ? '' : ` · ${subagent.summary}`}`
}

function plain(text: string, preserveNewlines = false): string {
  const withoutC1 = text
    .replace(/\u009B[0-?]*[ -/]*[@-~]/gu, '')
    .replace(/[\u0080-\u009F]/gu, '')
  return [...stripTerminalSequences(withoutC1)].map(character => {
    const code = character.codePointAt(0) ?? 0
    if (preserveNewlines && character === '\n') return character
    return code < 32 || code === 127 ? ' ' : character
  }).join('')
}

function line(text: string, width: number): string {
  return truncateToWidth(text, Math.max(1, width), '…')
}

function windowRows(values: readonly string[], size: number, position: number, follow: boolean): string[] {
  if (values.length <= size) return [...values]
  if (size < 3) return [values[Math.max(0, Math.min(values.length - 1, position))] ?? '']
  const start = Math.max(0, Math.min(values.length - Math.max(1, size - 1), follow ? position - Math.floor((size - 2) / 2) : position))
  const above = start > 0
  let end = Math.min(values.length, start + size - Number(above))
  if (end < values.length) end--
  return [
    ...(above ? [`${DIM}↑ ${String(start)} more${RESET}`] : []),
    ...values.slice(start, end),
    ...(end < values.length ? [`${DIM}↓ ${String(values.length - end)} more${RESET}`] : []),
  ]
}

function theme(): EditorTheme {
  const identity = (text: string): string => text
  return {
    borderColor: text => `${FAINT_BORDER}${text}${RESET}`,
    selectList: {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    },
  }
}

export function createRenderer(options: RendererOptions): Renderer {
  const terminal = options.terminal ?? createProcessTerminal(options.inline ? undefined : lines => {
    options.dispatch({ type: 'scroll', direction: lines > 0 ? 'page-up' : 'page-down', lines: Math.abs(lines) })
  })
  const terminalType = options.terminalType ?? (options.terminal === undefined ? process.env.TERM : undefined)
  const accessible = options.accessible === true || terminalType?.toLocaleLowerCase() === 'dumb'
  const osc52 = supportsOsc52(terminalType)
  const tui: TUI = options.inline
    ? new TuiMainScreen(terminal, true)
    : new class extends TuiAltScreen {
      protected override isOverlayFocused(): boolean { return options.readState().overlay !== undefined || super.isOverlayFocused() }
    }(terminal, true, undefined, { mouse: true })
  let editor = new Editor(tui, theme(), { paddingX: 1 })
  editor.disableSubmit = true
  editor.onChange = text => {
    const decision = options.readState().decisions[0]
    const caret = caretOffset(text, editor.getCursor())
    options.dispatch({
      type: 'composer-changed', text: decision?.kind === 'question' && decision.questions[decision.index]?.secret === true ? editor.getExpandedText() : text, caret, completion: hasCompletionTrigger(text, caret),
    })
  }
  const replaceEditor = (): void => {
    const discarded = editor
    editor = new Editor(tui, theme(), { paddingX: 1 })
    editor.disableSubmit = true
    editor.onChange = discarded.onChange!
    tui.setFocus(editor)
  }
  const lineCache = new Map<string, string[]>()
  let animationTimer: ReturnType<typeof setTimeout> | undefined

  const cellLines = (cell: TerminalCell, width: number, toolMode: ToolMode, now: number): string[] => {
    const key = `${THEME_GENERATION}:${accessible}:${width}:${toolMode}:${cell.key}:${cell.kind}:${cell.pending === true}:${cell.collapsed === true}:${cell.startedAt ?? ''}:${cell.elapsedMs ?? ''}:${cell.text}:${cell.detail ?? ''}:${JSON.stringify(cell.tool)}`
    const cached = cell.pending === true ? undefined : lineCache.get(key)
    if (cached !== undefined) return cached
    const cellWidth = Math.max(1, width - 2)
    const lines = !accessible && cell.kind === 'assistant' && cell.pending !== true
      ? [`${BOLD_CYAN}Assistant${RESET}`, ...new Markdown(plain(cell.text, true), 0, 0, markdownTheme).render(cellWidth).map(value => value.trimEnd())]
      : wrapTextWithAnsi(cellText(cell, toolMode, accessible, now), cellWidth)
    const rendered = lines.map(value => `  ${value}`)
    if (cell.pending !== true) {
      lineCache.set(key, rendered)
      if (lineCache.size > 512) lineCache.delete(lineCache.keys().next().value as string)
    }
    return rendered
  }

  const optionLine = (label: string, number: number, cursor: boolean, selected: boolean): string =>
    `${cursor ? BOLD_CYAN : DIM}${cursor ? accessible ? '>' : '›' : ' '} ${String(number)} ${selected ? '[x]' : '[ ]'} ${plain(label)}${RESET}`

  const announcement = (title: string, count: number, selected?: string, cursor = 0): string => {
    if (!accessible) return title
    const items = `${String(count)} item${count === 1 ? '' : 's'}`
    return selected === undefined ? `${title} · ${items}`
      : `${title} · ${items} · selected ${String(cursor + 1)}: ${selected}`
  }

  const decisionPanel = (decision: PendingDecision, width: number, rows: number): string[] => {
    if (decision.kind === 'approval') {
      const choices = ['Allow once', 'Reject', 'Cancel']
      const heading = announcement(
        `Approval · ${plain(decision.toolName)}`, choices.length, choices[decision.cursor], decision.cursor,
      )
      const prompt = wrapTextWithAnsi(`${BOLD_CYAN}${heading}${RESET}\n${plain(decision.prompt, true)}`, width)
      return [...prompt, ...choices.map((choice, index) => optionLine(choice, index + 1, decision.cursor === index, false))]
    }
    const question = decision.questions[decision.index]
    if (question === undefined) return [`${RED}Invalid empty question batch${RESET}`]
    const planReview = question.intent?.kind === 'plan-review'
    const heading = planReview ? 'Plan review' : question.header ?? `Question ${String(decision.index + 1)}/${String(decision.questions.length)}`
    const customAllowed = question.allowCustom !== false
    const selected = question.options[decision.cursor]?.label ?? 'Other (type an answer)'
    const announced = announcement(plain(heading), question.options.length + Number(customAllowed), selected, decision.cursor)
    const prompt = wrapTextWithAnsi(`${BOLD_CYAN}${announced}${RESET}\n${plain(question.question, true)}`, width)
    const choiceRows = question.options.map((option, index) => optionLine(
      option.description === undefined ? option.label : `${option.label} — ${option.description}`,
      index + 1, decision.cursor === index, decision.selected.includes(option.label),
    ))
    if (customAllowed) choiceRows.push(optionLine(
      'Other (type an answer)', question.options.length + 1,
      decision.cursor === question.options.length, false,
    ))
    const detailLimit = planReview ? Math.max(3, rows - prompt.length - choiceRows.length - 5) : 3
    const detail = question.detail === undefined ? [] : wrapTextWithAnsi(`${DIM}${plain(question.detail, true)}${RESET}`, width).slice(0, detailLimit)
    const editorLines = decision.cursor === question.options.length ? editor.render(width) : []
    const custom = question.secret === true
      ? editorLines.map((value, index) => index === 0 || index === editorLines.length - 1 ? value : value.replace(MASK_TOKEN, token => token.startsWith('\u001B') ? token : '•')) : editorLines
    const rendered = [...prompt, ...detail, ...choiceRows, ...custom]
    return rows < 12 ? rendered.slice(0, Math.max(2, rows - 4)) : rendered
  }

  const historyPanel = (overlay: Extract<Overlay, { kind: 'history' }>, state: ViewState, width: number, rows: number): string[] => {
    const selected = state.cells[overlay.cursor]
    const radius = Math.max(1, Math.min(4, Math.floor((rows - 6) / 2)))
    const start = Math.max(0, overlay.cursor - radius)
    const end = Math.min(state.cells.length, overlay.cursor + radius + 1)
    const selectedSummary = selected === undefined ? undefined
      : `${selected.kind} · ${plain(selected.tool?.title ?? selected.text).split('\n')[0] ?? ''}`
    const result = [`${BOLD_CYAN}${announcement('History', state.cells.length, selectedSummary, overlay.cursor)}${RESET}`]
    for (let index = start; index < end; index++) {
      const cell = state.cells[index]
      if (cell === undefined) continue
      const summary = plain(cell.tool?.title ?? cell.text).split('\n')[0] ?? ''
      result.push(line(`${index === overlay.cursor ? accessible ? '>' : '›' : ' '} ${cell.kind} · ${summary}`, width))
    }
    if (overlay.expanded && selected !== undefined) {
      result.push('', ...wrapTextWithAnsi(cellText(selected, 'expanded', accessible), width).slice(0, Math.max(2, rows - result.length - 4)))
    }
    result.push(`${DIM}↑↓ select · Enter expand · / search · y copy · Esc close${RESET}`)
    return result
  }

  const detailsPanel = (overlay: Extract<Overlay, { kind: 'details' }>, state: ViewState, width: number, rows: number): string[] => {
    const items = activities(state)
    const cursor = Math.min(overlay.cursor, Math.max(0, items.length - 1))
    const radius = Math.max(1, Math.floor((rows - 7) / 2))
    const start = Math.max(0, cursor - radius)
    const end = Math.min(items.length, cursor + radius + 1)
    const now = Date.now()
    const selectedItem = items[cursor]
    const result = [`${BOLD_CYAN}${announcement(
      'Activity', items.length,
      selectedItem === undefined ? undefined : activityText(selectedItem, now), cursor,
    )}${RESET}`]
    for (let index = start; index < end; index++) {
      const item = items[index]
      if (item !== undefined) result.push(line(`${index === cursor ? accessible ? '>' : '›' : ' '} ${activityText(item, now)}`, width))
    }
    const selected = items[cursor]
    if (overlay.expanded && selected !== undefined) {
      const detail = selected.kind === 'job'
        ? [selected.value.id, `kind: ${selected.value.kind}`, `state: ${selected.value.status}`,
            ...(selected.value.detail === undefined ? [] : [selected.value.detail])]
        : [selected.value.id, `mode: ${selected.value.mode}`, `state: ${selected.value.state}`,
            ...(selected.value.tokens === undefined ? [] : [`tokens: ${String(selected.value.tokens)}`]),
            ...(selected.value.summary === undefined ? [] : [selected.value.summary])]
      result.push('', ...detail.flatMap(value => wrapTextWithAnsi(`${DIM}${plain(value)}${RESET}`, width)))
    }
    result.push(`${DIM}↑↓ select · Enter details · Esc close${RESET}`)
    return result.slice(0, Math.max(2, rows - 3))
  }

  const infoRows = (overlay: Extract<Overlay, { kind: 'info' }>, state: ViewState, width: number): string[] =>
    overlay.lines.flatMap(value => wrapTextWithAnsi(plain(value, true), width)).concat(overlay.cells?.flatMap(cell => wrapTextWithAnsi(cellText(cell, state.toolMode, accessible), width)) ?? [])

  const overlayPanel = (overlay: Overlay, state: ViewState, width: number, rows: number): string[] => {
    if (overlay.kind === 'history') return historyPanel(overlay, state, width, rows)
    if (overlay.kind === 'details') return detailsPanel(overlay, state, width, rows)
    if (overlay.kind === 'info') {
      const body = infoRows(overlay, state, width)
      return [
        `${BOLD_CYAN}${announcement(plain(overlay.title), overlay.lines.length + (overlay.cells?.length ?? 0))}${RESET}`,
        ...windowRows(body, Math.max(1, rows - 5), overlay.scrollOffset ?? 0, false),
        `${DIM}↑↓ scroll · PageUp/PageDown · Enter or Esc close${RESET}`,
      ]
    }
    if (overlay.kind === 'confirm') {
      const choices = [overlay.acceptLabel, 'Cancel']
      return [
        `${YELLOW}${announcement(
          plain(overlay.title), choices.length, choices[overlay.cursor], overlay.cursor,
        )}${RESET}`,
        ...overlay.detail.flatMap(value => wrapTextWithAnsi(plain(value, true), width)),
        optionLine(overlay.acceptLabel, 1, overlay.cursor === 0, false),
        optionLine('Cancel', 2, overlay.cursor === 1, false),
      ].slice(0, Math.max(2, rows - 3))
    }
    const selected = overlay.options[overlay.cursor]
    const result: string[] = [
      line(`${BOLD_CYAN}${announcement(
        plain(overlay.title), overlay.options.length,
        selected === undefined ? undefined : plain(selected.label), overlay.cursor,
      )}${RESET}`, width),
      ...(overlay.notice === undefined ? [] : [`${DIM}${plain(overlay.notice)}${RESET}`]),
    ]
    const body: string[] = []
    let selectedRow = 0
    let group: string | undefined
    for (const [index, option] of overlay.options.entries()) {
      if (option.group !== undefined && option.group !== group) {
        group = option.group
        body.push(`${DIM}${plain(group)}${RESET}`)
      }
      const detail = option.detail === undefined ? '' : ` — ${plain(option.detail)}`
      const active = option.active === true ? accessible ? ' [active]' : ' ●' : ''
      const danger = option.danger === true ? ` ${YELLOW}${accessible ? '[danger]' : '!'}${RESET}` : ''
      if (index === overlay.cursor) selectedRow = body.length
      body.push(line(`${index === overlay.cursor ? BOLD_CYAN : DIM}${index === overlay.cursor ? accessible ? '>' : '›' : ' '} ${String(index + 1)} ${plain(option.label)}${active}${detail}${RESET}${danger}`, width))
    }
    const limit = Math.max(2, rows - (overlay.purpose === 'completion' ? 6 : 3))
    return [...result, ...windowRows(body, Math.max(1, limit - result.length), selectedRow, true)]
  }

  const document = {
    invalidate() { editor.invalidate() },
    render(width: number): string[] {
      const state = options.readState()
      const now = Date.now()
      const pendingCommand = latestPendingCommand(state.cells)
      if (pendingCommand !== undefined && animationTimer === undefined) {
        animationTimer = setTimeout(() => {
          animationTimer = undefined
          tui.requestRender()
        }, accessible ? 1_000 : SPINNER_INTERVAL_MS)
      } else if (pendingCommand === undefined && animationTimer !== undefined) {
        clearTimeout(animationTimer)
        animationTimer = undefined
      }
      const rows = Math.max(1, terminal.rows)
      if (width < 32 || rows < 8) return [line('dashi — enlarge terminal to continue', width)]

      const root = state.root
      const cwd = plain(root?.cwd ?? state.cwd)
      const title = root === undefined
        ? `${BOLD_CYAN}dashi${RESET}  ${DIM}no session${RESET}`
        : `${BOLD_CYAN}dashi${RESET}  ${plain(root.title ?? root.id)}`
      const identity = root === undefined ? cwd : `${plain(root.id)}  ${DIM}${cwd}${RESET}`
      const header = width >= 100
        ? [line(`${title}  ${DIM}${identity}${RESET}`, width)]
        : [line(title, width), line(`${DIM}${identity}${RESET}`, width)]
      const baseStatusText = state.exitArmed
        ? `${DIM}Ctrl+C or Ctrl+D again to exit${RESET}`
        : state.decisions.length > 0
          ? `${DIM}decision 1/${String(state.decisions.length)} · ↑↓/1-9 choose · Enter answer · Esc cancel${RESET}`
          : state.search !== undefined
            ? `${DIM}${state.search.scope} search · Enter next · Shift+Enter previous · Esc close${RESET}`
          : state.overlay !== undefined
            ? `${DIM}${plain(state.overlay.kind === 'list' ? state.overlay.purpose : state.overlay.kind === 'history'
              ? 'history' : state.overlay.kind === 'details' ? 'activity' : state.overlay.title)} · ↑↓ choose · Enter select · Esc close${RESET}`
        : pendingCommand !== undefined
          ? `${DIM}running ${plain(pendingCommand.text).split(/\s/u)[0] ?? 'command'}${pendingCommand.startedAt === undefined ? '' : ` · ${duration(now - pendingCommand.startedAt)}`}${RESET}`
        : root === undefined
          ? `${DIM}no session · cards ${state.toolMode} · Ctrl+J newline · Ctrl+L redraw${RESET}`
          : root.status === 'running'
            ? `${DIM}running · ${plain(root.model)} · Enter ${state.sendMode === 'steer' ? 'steer' : 'queue next turn'} · Ctrl+T toggle · cards ${state.toolMode} · Esc interrupt${RESET}`
            : `${DIM}idle · ${plain(root.model)} · Enter send · cards ${state.toolMode}${RESET}`
      const activityCount = activities(state).length
      const baseStatus = `${baseStatusText}${root?.contextPercent === undefined ? '' : ` · ${String(root.contextPercent)}% context`}${activityCount === 0 ? '' : ' · Ctrl+B activity'}`
      const status = state.newOutput === 0 ? baseStatus
        : `${YELLOW}${accessible ? '[new]' : '↓'} ${String(state.newOutput)} new output${state.newOutput === 1 ? '' : 's'} · Ctrl+End${RESET} · ${baseStatus}`
      const decision = state.decisions[0]
      const attachmentRows = state.attachments.map((attachment, index) => line(
        `${YELLOW}[image ${String(index + 1)}]${RESET} ${plain(attachment.name)} · ${attachment.mediaType} · ${String(attachment.bytes)} B · ${plain(attachment.path)}`,
        width,
      ))
      const activityRows = decision !== undefined || state.search !== undefined || state.overlay !== undefined
        ? [] : activities(state).map(item => line(`${DIM}${activityText(item, now)}${RESET}`, width))
      const control = decision !== undefined
        ? decisionPanel(decision, width, rows)
        : state.search !== undefined
          ? [
            ...(state.search.scope === 'history' && state.overlay?.kind === 'history'
              ? historyPanel(state.overlay, state, width, rows).slice(0, Math.max(2, rows - 8)) : []),
            `${BOLD_CYAN}${announcement(
              `Search ${state.search.scope}`, state.search.matches.length,
              state.search.matches.length === 0 ? undefined : `match ${String(state.search.cursor + 1)}`,
              state.search.cursor,
            )}${RESET}`,
            ...editor.render(width),
            `${DIM}${state.search.matches.length === 0 ? 'no matches' : `${String(state.search.cursor + 1)}/${String(state.search.matches.length)}`} · Enter next · Shift+Enter previous${RESET}`,
          ]
        : state.overlay === undefined
          ? [...activityRows, ...attachmentRows, ...editor.render(width)]
          : [
            ...overlayPanel(state.overlay, state, width, rows),
            ...(state.overlay.kind === 'list' && state.overlay.purpose === 'completion'
              ? [...attachmentRows, ...editor.render(width)]
              : []),
          ]
      const fixedRows = header.length + control.length + 2
      const filtered = state.cells
        .filter(cell => !(state.toolMode === 'hidden' && (cell.tool !== undefined || cell.kind === 'tool')))
      const available = Math.max(0, rows - fixedRows)
      const end = Math.max(0, filtered.length - Math.min(state.scrollOffset, Math.max(0, filtered.length - 1)))
      const start = Math.max(0, end - available - OVERSCAN_CELLS)
      const materialized = options.inline ? filtered : filtered.slice(start, end)
      materializedCount = materialized.length
      const transcript = materialized.flatMap(cell => [...cellLines(cell, width, state.toolMode, now), ''])
      const visible = options.inline ? transcript : transcript.slice(-available)
      const spacerRows = options.inline ? 0 : Math.max(0, available - visible.length)
      return [...header, '', ...Array.from({ length: spacerRows }, () => ''), ...visible, ...control, line(status, width)]
    },
  }

  let materializedCount = 0

  tui.addChild(document)
  tui.setFocus(editor)
  installInput(tui, {
    ...options,
    dispatch: action => {
      const overlay = options.readState().overlay
      const size = Math.max(1, terminal.rows - 5)
      options.dispatch(action.type === 'overlay-move' && overlay?.kind === 'info'
        ? { ...action, limit: Math.max(0, infoRows(overlay, options.readState(), terminal.columns).length - Math.max(1, size - 1)) }
        : action)
    },
    insertNewline: () => { editor.insertTextAtCursor('\n') },
    readComposerCursor: () => editor.getCursor(),
  })

  return {
    bell: () => { terminal.write('\u0007') },
    copy(text) {
      if (!osc52) return 'unsupported'
      const safe = plain(text, true)
      if (Buffer.byteLength(safe, 'utf8') > COPY_LIMIT) return 'too-large'
      terminal.write(`\u001B]52;c;${Buffer.from(safe).toString('base64')}\u0007`)
      return 'ok'
    },
    discardSecretComposer: replaceEditor,
    drainInput: () => terminal.drainInput(),
    materializedCells: () => materializedCount,
    render: force => { tui.renderNow(force) },
    setComposer: (text, cursor) => { setEditor(editor, text, cursor) },
    start: () => { tui.start() },
    stop: preserveScreen => {
      if (animationTimer !== undefined) clearTimeout(animationTimer)
      animationTimer = undefined
      tui.stop({ preserveScreen })
    },
  }
}
