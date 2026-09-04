import { FLAG_HELP, VERSION_LINE } from './help.js'
export interface RootView {
  readonly contextPercent?: number
  readonly cwd: string
  readonly effort?: string
  readonly id: string
  readonly model: string
  readonly jobs?: readonly JobView[]
  readonly parent?: string
  readonly parentTurn?: number
  readonly permission?: string
  readonly provider?: string
  readonly status: 'idle' | 'running'
  readonly subagents?: readonly SubagentView[]
  readonly title?: string
}

export interface JobView {
  readonly detail?: string
  readonly finishedAt?: number
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly startedAt: number
  readonly status: 'running' | 'stopping' | 'completed' | 'killed' | 'failed'
}

export interface SubagentView {
  readonly active?: { readonly since: number; readonly through: number }
  readonly elapsedMs?: number
  readonly id: string
  readonly label: string
  readonly mode: 'continuable' | 'one-shot'
  readonly state: 'inactive' | 'running'
  readonly summary?: string
  readonly tokens?: number
}

export interface ToolDiff {
  readonly added: number
  readonly lines: readonly string[]
  readonly path: string
  readonly removed: number
}

export interface ToolCard {
  readonly body?: string
  readonly card: 'diff' | 'generic' | 'read' | 'search' | 'terminal' | 'web'
  readonly diffs?: readonly ToolDiff[]
  readonly status?: string
  readonly title: string
}

export interface TerminalCell {
  readonly collapsed?: boolean
  readonly detail?: string
  readonly elapsedMs?: number
  readonly key: string
  readonly kind: 'assistant' | 'command' | 'compaction' | 'context' | 'error' | 'outcome' | 'reasoning' | 'shell' | 'todo' | 'tool' | 'user'
  readonly pending?: boolean
  readonly startedAt?: number
  readonly text: string
  readonly tool?: ToolCard
}

export interface DraftAttachment {
  readonly bytes: number
  readonly data: Uint8Array
  readonly mediaType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp'
  readonly name: string
  readonly path: string
}

export interface ComposerCursor {
  readonly col: number
  readonly line: number
}

export interface DecisionOwner {
  readonly id: string
  readonly label?: string
}

export interface ApprovalDecision {
  readonly cursor: number
  readonly id: string
  readonly kind: 'approval'
  readonly owner: DecisionOwner
  readonly prompt: string
  readonly toolName: string
}

export interface QuestionOption {
  readonly description?: string
  readonly label: string
}

export interface QuestionItem {
  readonly allowCustom?: boolean
  readonly detail?: string
  readonly header?: string
  readonly id: string
  readonly intent?: { readonly approve: string; readonly kind: 'plan-review' }
  readonly multiSelect: boolean
  readonly options: readonly QuestionOption[]
  readonly question: string
  readonly secret?: boolean
}

export interface QuestionAnswer {
  readonly custom?: string
  readonly id: string
  readonly selected: readonly string[]
}

export interface QuestionDecision {
  readonly answers: readonly QuestionAnswer[]
  readonly cursor: number
  readonly custom: string
  readonly id: string
  readonly index: number
  readonly kind: 'question'
  readonly owner: DecisionOwner
  readonly questions: readonly QuestionItem[]
  readonly selected: readonly string[]
}

export type PendingDecision = ApprovalDecision | QuestionDecision
export type ApprovalOutcome = 'allowed-once' | 'cancelled' | 'rejected'
export type DecisionAnswer = ApprovalOutcome | { readonly answers: readonly QuestionAnswer[] }
export type SendMode = 'next-turn' | 'steer'
export type ToolMode = 'collapsed' | 'expanded' | 'hidden'

export type OverlayValue =
  | { readonly kind: 'agent-preset'; readonly preset: string }
  | { readonly kind: 'attach'; readonly path: string; readonly source: string; readonly text: string }
  | { readonly kind: 'insert'; readonly text: string }
  | { readonly kind: 'model'; readonly effort?: string; readonly model: string; readonly provider: string }
  | { readonly kind: 'open-file'; readonly path: string }
  | { readonly interrupt?: true; readonly kind: 'fork' }
  | { readonly agentPreset?: string; readonly interrupt?: true; readonly kind: 'new'; readonly title?: string }
  | { readonly all?: boolean; readonly interrupt?: true; readonly kind: 'open-resume' }
  | { readonly interrupt?: true; readonly kind: 'open-rewind' }
  | { readonly kind: 'permission'; readonly preset: string }
  | { readonly all?: boolean; readonly interrupt?: true; readonly kind: 'resume'; readonly sessionId: string }
  | {
    readonly atSeq?: number
    readonly kind: 'rewind-boundary'
    readonly prompt: string
    readonly roller: boolean
  }
  | {
    readonly atSeq?: number
    readonly interrupt?: true
    readonly kind: 'rewind'
    readonly mode: 'both' | 'code' | 'conversation'
    readonly prompt: string
  }
  | { readonly kind: 'search-result'; readonly rootId: string; readonly seq: number; readonly sessionId: string }

export type ActivatableOverlayValue = Exclude<OverlayValue, { kind: 'attach' } | { kind: 'insert' }>

export interface OverlayOption {
  readonly active?: boolean
  readonly confirmDetail?: readonly string[]
  readonly danger?: boolean
  readonly detail?: string
  readonly group?: 'Commands' | 'Files' | 'Skills'
  readonly label: string
  readonly submitOnEnter?: boolean
  readonly value: OverlayValue
}

export type Overlay =
  | {
    readonly cursor: number
    readonly kind: 'list'
    readonly notice?: string
    readonly options: readonly OverlayOption[]
    readonly purpose: 'agents' | 'completion' | 'memory' | 'model' | 'permission' | 'resume' | 'rewind' | 'rewind-action' | 'search'
    readonly title: string
  }
  | { readonly cells?: readonly TerminalCell[]; readonly kind: 'info'; readonly lines: readonly string[]; readonly title: string }
  | { readonly cursor: number; readonly expanded: boolean; readonly kind: 'details' }
  | { readonly cursor: number; readonly expanded: boolean; readonly kind: 'history' }
  | {
    readonly acceptLabel: string
    readonly cursor: number
    readonly detail: readonly string[]
    readonly kind: 'confirm'
    readonly title: string
    readonly value: ActivatableOverlayValue
  }

export interface ViewState {
  readonly attachments: readonly DraftAttachment[]
  readonly cells: readonly TerminalCell[]
  readonly composer: string
  readonly cwd: string
  readonly decisions: readonly PendingDecision[]
  readonly exitArmed: boolean
  readonly historyHasMore: boolean
  readonly inline: boolean
  readonly newOutput: number
  readonly overlay?: Overlay
  readonly prompts: readonly string[]
  readonly recall?: { readonly cursor: number; readonly draft: string } | undefined
  readonly rewindArmed: boolean
  readonly root?: RootView
  readonly scrollOffset: number
  readonly search?: {
    readonly cursor: number
    readonly matches: readonly number[]
    readonly query: string
    readonly scope: 'history' | 'transcript'
  } | undefined
  readonly sendMode: SendMode
  readonly stash?: {
    readonly attachments: readonly DraftAttachment[]
    readonly composer: string
    readonly cursor: ComposerCursor
  }
  readonly toolMode: ToolMode
}

export type UiAction =
  | { readonly attachment: DraftAttachment; readonly source?: string; readonly text?: string; readonly type: 'attachment-added' }
  | { readonly index: number; readonly type: 'attachment-remove' }
  | { readonly type: 'clipboard-paste' }
  | { readonly caret?: number; readonly completion?: boolean; readonly type: 'composer-changed'; readonly text: string }
  | { readonly cursor?: ComposerCursor; readonly type: 'composer-set'; readonly text: string }
  | { readonly type: 'ctrl-c' }
  | { readonly type: 'ctrl-d' }
  | { readonly type: 'decision-cancel' }
  | { readonly type: 'decision-enqueued'; readonly decision: PendingDecision }
  | { readonly type: 'decision-move'; readonly offset: number }
  | { readonly type: 'decision-number'; readonly number: number }
  | { readonly type: 'decision-submit' }
  | { readonly type: 'decision-toggle' }
  | { readonly type: 'decision-withdrawn'; readonly id: string }
  | { readonly type: 'disarm-exit' }
  | { readonly type: 'escape' }
  | { readonly type: 'exit' }
  | { readonly type: 'external-edit' }
  | { readonly type: 'help' }
  | { readonly type: 'history-copy' }
  | { readonly type: 'history-move'; readonly offset: -1 | 1 }
  | { readonly type: 'history-page'; readonly cells: readonly TerminalCell[]; readonly hasMore: boolean; readonly rootId: string }
  | { readonly type: 'history-toggle' }
  | { readonly type: 'open-history' }
  | { readonly type: 'open-details' }
  | { readonly type: 'completion-ready'; readonly options: readonly OverlayOption[]; readonly query: string }
  | { readonly type: 'open-overlay'; readonly overlay: Overlay }
  | { readonly type: 'overlay-close' }
  | { readonly type: 'overlay-move'; readonly offset: number }
  | { readonly type: 'overlay-number'; readonly number: number }
  | { readonly execute?: boolean; readonly type: 'overlay-submit' }
  | { readonly type: 'redraw' }
  | { readonly type: 'prompt-recorded'; readonly rootId: string; readonly text: string }
  | { readonly type: 'recall-move'; readonly offset: -1 | 1 }
  | { readonly caret: number; readonly type: 'request-completion' }
  | { readonly type: 'request-search' }
  | { readonly type: 'root-bound'; readonly cells: readonly TerminalCell[]; readonly hasMore: boolean; readonly prompts: readonly string[]; readonly root: RootView }
  | { readonly type: 'root-cleared' }
  | { readonly type: 'root-model'; readonly effort?: string; readonly model: string; readonly provider: string; readonly rootId: string }
  | {
    readonly contextPercent?: number | null
    readonly jobs?: readonly JobView[]
    readonly rootId: string
    readonly subagents?: readonly SubagentView[]
    readonly type: 'root-presentation'
  }
  | { readonly type: 'root-permission'; readonly preset: string; readonly rootId: string }
  | { readonly type: 'root-status'; readonly rootId: string; readonly status: 'idle' | 'running' }
  | { readonly type: 'root-title'; readonly rootId: string; readonly title: string }
  | { readonly type: 'runtime-error'; readonly message: string; readonly rootId?: string }
  | { readonly type: 'scroll'; readonly direction: 'end' | 'home' | 'page-down' | 'page-up'; readonly lines?: number }
  | { readonly type: 'search-close' }
  | { readonly type: 'search-move'; readonly offset: -1 | 1 }
  | { readonly type: 'search-open'; readonly scope: 'history' | 'transcript' }
  | { readonly type: 'submit' }
  | { readonly type: 'suspend' }
  | { readonly cursor: ComposerCursor; readonly type: 'stash-toggle' }
  | { readonly type: 'terminal-lost' }
  | { readonly type: 'cycle-permission' }
  | { readonly type: 'toggle-send-mode' }
  | { readonly type: 'toggle-tool-mode' }
  | { readonly durationMs: number; readonly rootId: string; readonly type: 'turn-ended' }
  | { readonly type: 'transcript-changed'; readonly cells: readonly TerminalCell[]; readonly hasMore?: boolean; readonly rootId?: string }
  | { readonly type: 'copy-latest' }

export type UiEffect =
  | { readonly type: 'activate-overlay'; readonly value: ActivatableOverlayValue }
  | { readonly type: 'bell' }
  | { readonly path: string; readonly source: string; readonly text: string; readonly type: 'attach' }
  | { readonly type: 'clipboard-image' }
  | { readonly caret: number; readonly query: string; readonly type: 'complete' }
  | { readonly type: 'copy'; readonly text: string }
  | { readonly type: 'cycle-permission' }
  | { readonly type: 'exit' }
  | { readonly armed: boolean; readonly type: 'exit-timer' }
  | { readonly cwd: string; readonly text: string; readonly type: 'external-edit' }
  | { readonly type: 'interrupt' }
  | { readonly type: 'load-history'; readonly rootId: string }
  | { readonly type: 'redraw'; readonly force: boolean }
  | { readonly type: 'reject-decision'; readonly id: string; readonly reason: 'terminal' | 'withdrawn' }
  | { readonly cursor?: ComposerCursor; readonly type: 'set-composer'; readonly text: string }
  | { readonly type: 'search'; readonly query: string; readonly rootId: string }
  | { readonly type: 'settle-decision'; readonly answer: DecisionAnswer; readonly id: string }
  | { readonly attachments: readonly DraftAttachment[]; readonly type: 'submit'; readonly mode: SendMode; readonly text: string }
  | { readonly type: 'suspend' }

export function initialViewState(
  cwd: string,
  inline: boolean,
  root?: RootView,
  cells: readonly TerminalCell[] = [],
  prompts: readonly string[] = [],
  historyHasMore = false,
  attachments: readonly DraftAttachment[] = [],
): ViewState {
  return {
    attachments, cells, composer: '', cwd, decisions: [], exitArmed: false, historyHasMore, inline,
    newOutput: 0, prompts, rewindArmed: false, scrollOffset: 0,
    sendMode: 'steer', toolMode: 'collapsed',
    ...(root === undefined ? {} : { root }),
  }
}

export const TURN_BELL_THRESHOLD_MS = 10_000

function redraw(): readonly UiEffect[] {
  return [{ type: 'redraw', force: false }]
}

function focusAfter(state: ViewState, decisions: readonly PendingDecision[]): UiEffect {
  const next = decisions[0]
  return { type: 'set-composer', text: next?.kind === 'question' ? next.custom : state.composer }
}

function removeHead(state: ViewState, effect: UiEffect): readonly [ViewState, readonly UiEffect[]] {
  const decisions = state.decisions.slice(1)
  return [{ ...state, decisions }, [effect, focusAfter(state, decisions), ...redraw()]]
}

function moveCursor(decision: PendingDecision, cursor: number): PendingDecision {
  if (decision.kind === 'approval') return { ...decision, cursor: Math.max(0, Math.min(2, cursor)) }
  const question = decision.questions[decision.index]
  if (question === undefined) return decision
  return { ...decision, cursor: Math.max(0, Math.min(question.options.length - (question.allowCustom === false ? 1 : 0), cursor)) }
}

function help(): Overlay {
  return {
    kind: 'info',
    title: 'Help',
    lines: [
      VERSION_LINE,
      'Enter send · Ctrl+J newline · Ctrl+T steer/next turn',
      'Esc interrupt · Ctrl+C clear/interrupt · Ctrl+C/D again within 2s to exit',
      '/ and @ complete live · Tab insert · Shift+Tab permission · Ctrl+O cards',
      '↑↓ prompt recall · Ctrl+R recall search · Ctrl+F transcript search',
      'PageUp/PageDown scroll · Ctrl+Home/Ctrl+End ends · Esc Esc rewind/draft recall',
      'Ctrl+B activity details for jobs and subagents',
      '@ paths require DSH file-reference · Ctrl+V pastes an image · Backspace removes it',
      'Ctrl+S stash · Ctrl+G editor · F1 help · Ctrl+L redraw · Ctrl+Z suspend',
      '/new /clear /reset /resume /continue [--all] [NAME|UUID] /fork /branch /rewind /rename /model /effort /permission /agents /queue /status /context',
      '/init /memory /config /login /logout /diff /plugins /plugin /tasks /history /export /copy /exit /quit',
      ...FLAG_HELP,
    ],
  }
}

function moveOverlay(overlay: Overlay, cursor: number, detailsCount = 0): Overlay {
  if (overlay.kind === 'info' || overlay.kind === 'history') return overlay
  const limit = overlay.kind === 'confirm' ? 1
    : overlay.kind === 'details' ? Math.max(0, detailsCount - 1)
      : Math.max(0, overlay.options.length - 1)
  return { ...overlay, cursor: Math.max(0, Math.min(limit, cursor)) }
}

const PAGE_CELLS = 8

function matches(cells: readonly TerminalCell[], query: string): readonly number[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle === '') return []
  const found: number[] = []
  cells.forEach((cell, index) => {
    const tool = cell.tool
    const haystack = [cell.text, cell.detail, tool?.title, tool?.body,
      ...(tool?.diffs?.flatMap(diff => [diff.path, ...diff.lines]) ?? [])]
      .filter((value): value is string => value !== undefined).join('\n').toLocaleLowerCase()
    if (haystack.includes(needle)) found.push(index)
  })
  return found
}

function copyText(cell: TerminalCell): string {
  const card = cell.tool
  if (card === undefined) return cell.text
  const detail = card.diffs === undefined
    ? card.body
    : card.diffs.flatMap(diff => [diff.path, ...diff.lines]).join('\n')
  return detail === undefined || detail === '' ? card.title : `${card.title}\n${detail}`
}

function refreshSearch(search: ViewState['search'], cells: readonly TerminalCell[]): ViewState['search'] {
  if (search === undefined) return undefined
  const found = matches(cells, search.query)
  return { ...search, cursor: Math.min(search.cursor, Math.max(0, found.length - 1)), matches: found }
}

function latestCompletedAssistant(cells: readonly TerminalCell[]): TerminalCell | undefined {
  for (let index = cells.length - 1; index >= 0; index--) {
    const cell = cells[index]
    if (cell?.kind === 'assistant' && cell.pending !== true) return cell
  }
}

export function reduce(state: ViewState, action: UiAction): readonly [ViewState, readonly UiEffect[]] {
  const head = state.decisions[0]
  switch (action.type) {
    case 'attachment-added': {
      const replace = action.source !== undefined && action.text !== undefined && state.composer === action.source
      return [{
        ...state, attachments: [...state.attachments, action.attachment],
        ...(replace ? { composer: action.text } : {}),
      }, [...(replace ? [{ type: 'set-composer', text: action.text } as const] : []), ...redraw()]]
    }
    case 'attachment-remove': {
      if (action.index < 0 || action.index >= state.attachments.length) return [state, []]
      return [{ ...state, attachments: state.attachments.filter((_item, index) => index !== action.index) }, redraw()]
    }
    case 'composer-changed': {
      if (head?.kind === 'question') {
        if (head.custom === action.text) return [state, []]
        return [{ ...state, decisions: [{ ...head, custom: action.text }, ...state.decisions.slice(1)] }, redraw()]
      }
      if (state.search !== undefined) {
        const found = matches(state.cells, action.text)
        const cursor = found.length === 0 ? 0 : Math.min(state.search.cursor, found.length - 1)
        const index = found[cursor]
        return [{
          ...state,
          search: { ...state.search, cursor, matches: found, query: action.text },
          ...(index === undefined ? {} : state.search.scope === 'history'
            ? { overlay: { cursor: index, expanded: false, kind: 'history' as const } }
            : { scrollOffset: Math.max(0, state.cells.length - 1 - index) }),
        }, redraw()]
      }
      if (action.text === state.composer && !state.exitArmed && !state.rewindArmed) return [state, []]
      const next = {
        ...state, composer: action.text, exitArmed: false, recall: undefined, rewindArmed: false,
      }
      if (action.completion === true) return [next, [
        { type: 'complete', caret: action.caret ?? action.text.length, query: action.text }, ...redraw(),
      ]]
      if (state.overlay?.kind === 'list' && state.overlay.purpose === 'completion') {
        const { overlay: _overlay, ...withoutOverlay } = next
        return [withoutOverlay, redraw()]
      }
      return [next, redraw()]
    }
    case 'composer-set':
      return [{ ...state, composer: action.text, exitArmed: false, rewindArmed: false }, [
        { type: 'set-composer', text: action.text, ...(action.cursor === undefined ? {} : { cursor: action.cursor }) }, ...redraw(),
      ]]
    case 'clipboard-paste':
      return head === undefined && state.overlay === undefined && state.search === undefined
        ? [state, [{ type: 'clipboard-image' }]] : [state, []]
    case 'ctrl-c': {
      if (state.root?.status === 'running') return [state, [{ type: 'interrupt' }]]
      if (state.composer !== '' || state.attachments.length > 0) {
        return [{
          ...state, attachments: [], composer: '', exitArmed: false, recall: undefined, rewindArmed: false,
        }, [{ type: 'set-composer', text: '' }, ...redraw()]]
      }
      if (state.exitArmed) return reduce(state, { type: 'exit' })
      return [{ ...state, exitArmed: true, rewindArmed: false }, [{ type: 'exit-timer', armed: true }, ...redraw()]]
    }
    case 'ctrl-d':
      if (state.composer !== '') return [state, []]
      if (state.root?.status !== 'idle' || state.attachments.length > 0) return reduce(state, { type: 'exit' })
      return reduce(state, { type: 'ctrl-c' })
    case 'decision-cancel': {
      if (head === undefined) return [state, []]
      return head.kind === 'approval'
        ? removeHead(state, { type: 'settle-decision', id: head.id, answer: 'cancelled' })
        : removeHead(state, { type: 'reject-decision', id: head.id, reason: 'withdrawn' })
    }
    case 'decision-enqueued': {
      if (state.decisions.some(decision => decision.id === action.decision.id)) return [state, []]
      const decisions = [...state.decisions, action.decision]
      const effects = [
        ...(state.root?.status === 'running' ? [{ type: 'bell' as const }] : []),
        ...(head === undefined ? [focusAfter(state, decisions), ...redraw()] : redraw()),
      ]
      const { overlay: _overlay, search: _search, ...withoutOverlay } = state
      return [{ ...withoutOverlay, decisions, exitArmed: false, rewindArmed: false }, effects]
    }
    case 'decision-move': {
      if (head === undefined) return [state, []]
      const next = moveCursor(head, head.cursor + action.offset)
      return [{ ...state, decisions: [next, ...state.decisions.slice(1)] }, redraw()]
    }
    case 'decision-number': {
      if (head === undefined || action.number < 1) return [state, []]
      const next = moveCursor(head, action.number - 1)
      return [{ ...state, decisions: [next, ...state.decisions.slice(1)] }, redraw()]
    }
    case 'decision-toggle': {
      if (head?.kind !== 'question') return [state, []]
      const question = head.questions[head.index]
      const option = question?.options[head.cursor]
      if (question?.multiSelect !== true || option === undefined) return [state, []]
      const selected = head.selected.includes(option.label)
        ? head.selected.filter(label => label !== option.label)
        : [...head.selected, option.label]
      return [{ ...state, decisions: [{ ...head, selected }, ...state.decisions.slice(1)] }, redraw()]
    }
    case 'decision-submit': {
      if (head === undefined) return [state, []]
      if (head.kind === 'approval') {
        const answer: ApprovalOutcome = head.cursor === 0 ? 'allowed-once' : head.cursor === 1 ? 'rejected' : 'cancelled'
        return removeHead(state, { type: 'settle-decision', id: head.id, answer })
      }
      const question = head.questions[head.index]
      if (question === undefined) return [state, []]
      const custom = question.allowCustom !== false && head.cursor === question.options.length ? question.secret === true ? head.custom : head.custom.trim() : undefined
      if (custom !== undefined && custom === '') return [state, []]
      const option = question.options[head.cursor]
      const selected = question.multiSelect
        ? head.selected.length === 0 && option !== undefined ? [option.label] : head.selected
        : option === undefined ? [] : [option.label]
      const answer: QuestionAnswer = { id: question.id, selected, ...(custom === undefined ? {} : { custom }) }
      const answers = [...head.answers, answer]
      if (head.index + 1 < head.questions.length) {
        const next = { ...head, answers, cursor: 0, custom: '', index: head.index + 1, selected: [] }
        return [{ ...state, decisions: [next, ...state.decisions.slice(1)] }, [{ type: 'set-composer', text: '' }, ...redraw()]]
      }
      return removeHead(state, { type: 'settle-decision', id: head.id, answer: { answers } })
    }
    case 'decision-withdrawn': {
      const index = state.decisions.findIndex(decision => decision.id === action.id)
      if (index === -1) return [state, []]
      const decisions = state.decisions.filter(decision => decision.id !== action.id)
      const effects: UiEffect[] = [{ type: 'reject-decision', id: action.id, reason: 'withdrawn' }]
      if (index === 0) effects.push(focusAfter(state, decisions), ...redraw())
      return [{ ...state, decisions }, effects]
    }
    case 'disarm-exit':
      return state.exitArmed || state.rewindArmed
        ? [{ ...state, exitArmed: false, rewindArmed: false }, [
          { type: 'exit-timer', armed: false }, ...redraw(),
        ]] : [state, []]
    case 'escape':
      if (head !== undefined) return reduce(state, { type: 'decision-cancel' })
      if (state.search !== undefined) return reduce(state, { type: 'search-close' })
      if (state.overlay !== undefined) return reduce(state, { type: 'overlay-close' })
      if (state.root?.status === 'running') {
        return [{ ...state, rewindArmed: false }, [{ type: 'interrupt' }]]
      }
      if (state.root !== undefined) {
        if (state.rewindArmed) {
          if (state.composer !== '') return [{
            ...state, attachments: [], composer: '', prompts: [...state.prompts, state.composer],
            recall: undefined, rewindArmed: false,
          }, [{ type: 'set-composer', text: '' }, ...redraw()]]
          return [{ ...state, rewindArmed: false }, [
            { type: 'activate-overlay', value: { kind: 'open-rewind' } }, ...redraw(),
          ]]
        }
        return [{ ...state, rewindArmed: true }, redraw()]
      }
      return [state, []]
    case 'exit': {
      const effects: UiEffect[] = state.decisions.map(decision => ({ type: 'reject-decision', id: decision.id, reason: 'terminal' }))
      return [{ ...state, decisions: [] }, [...effects, { type: 'exit' }]]
    }
    case 'external-edit':
      return head === undefined && state.overlay === undefined && state.search === undefined
        ? [state, [{ type: 'external-edit', cwd: state.root?.cwd ?? state.cwd, text: state.composer }]]
        : [state, []]
    case 'help':
      return head === undefined
        ? [{ ...state, overlay: help(), search: undefined, exitArmed: false, rewindArmed: false }, [
          ...(state.search === undefined ? [] : [{ type: 'set-composer', text: state.composer } as const]),
          ...redraw(),
        ]]
        : [state, []]
    case 'history-copy': {
      if (state.overlay?.kind !== 'history') return [state, []]
      const cell = state.cells[state.overlay.cursor]
      return cell === undefined ? [state, []] : [state, [{ type: 'copy', text: copyText(cell) }]]
    }
    case 'history-move': {
      if (state.overlay?.kind !== 'history' || state.cells.length === 0) return [state, []]
      const cursor = Math.max(0, Math.min(state.cells.length - 1, state.overlay.cursor + action.offset))
      const load = cursor === 0 && action.offset < 0 && state.historyHasMore && state.root !== undefined
        ? [{ type: 'load-history', rootId: state.root.id } as const] : []
      return [{ ...state, overlay: { ...state.overlay, cursor, expanded: false } }, [...load, ...redraw()]]
    }
    case 'history-page': {
      if (state.root?.id !== action.rootId) return [state, []]
      const added = Math.max(0, action.cells.length - state.cells.length)
      let overlay = state.overlay?.kind === 'history'
        ? { ...state.overlay, cursor: Math.max(0, added - 1) }
        : state.overlay
      const search = refreshSearch(state.search, action.cells)
      if (search?.scope === 'history' && overlay?.kind === 'history') {
        overlay = { ...overlay, cursor: search.matches[search.cursor] ?? overlay.cursor }
      }
      return [{
        ...state, cells: action.cells, historyHasMore: action.hasMore,
        scrollOffset: action.cells.length === 0 ? 0 : action.cells.length - 1,
        ...(overlay === undefined ? {} : { overlay }),
        ...(search === undefined ? {} : { search }),
      }, redraw()]
    }
    case 'history-toggle':
      return state.overlay?.kind !== 'history' ? [state, []] : [{
        ...state, overlay: { ...state.overlay, expanded: !state.overlay.expanded },
      }, redraw()]
    case 'open-history':
      return head !== undefined ? [state, []] : [{
        ...state, overlay: {
          cursor: Math.max(0, state.cells.length - 1), expanded: false, kind: 'history',
        }, search: undefined, exitArmed: false, rewindArmed: false,
      }, redraw()]
    case 'open-details': {
      if (head !== undefined || state.root === undefined) return [state, []]
      const count = (state.root.jobs?.length ?? 0) + (state.root.subagents?.length ?? 0)
      return count === 0 ? [state, []] : [{
        ...state, overlay: { cursor: 0, expanded: false, kind: 'details' },
        search: undefined, exitArmed: false, rewindArmed: false,
      }, redraw()]
    }
    case 'completion-ready': {
      if (head !== undefined || state.composer !== action.query) return [state, []]
      if (action.options.length === 0) {
        if (state.overlay?.kind !== 'list' || state.overlay.purpose !== 'completion') return [state, []]
        const { overlay: _overlay, ...withoutOverlay } = state
        return [withoutOverlay, redraw()]
      }
      return [{ ...state, overlay: {
        cursor: 0, kind: 'list', options: action.options, purpose: 'completion', title: 'Complete',
      } }, redraw()]
    }
    case 'open-overlay':
      return head === undefined
        ? [{ ...state, overlay: action.overlay, exitArmed: false, rewindArmed: false }, redraw()]
        : [state, []]
    case 'overlay-close': {
      if (state.overlay === undefined) return [state, []]
      const { overlay: _overlay, ...withoutOverlay } = state
      return [withoutOverlay, redraw()]
    }
    case 'overlay-move': {
      if (state.overlay === undefined) return [state, []]
      const count = (state.root?.jobs?.length ?? 0) + (state.root?.subagents?.length ?? 0)
      const overlay = moveOverlay(state.overlay, state.overlay.kind === 'info' ? 0 : state.overlay.cursor + action.offset, count)
      return overlay === state.overlay ? [state, []] : [{ ...state, overlay }, redraw()]
    }
    case 'overlay-number': {
      if (state.overlay === undefined || state.overlay.kind === 'info' || action.number < 1) return [state, []]
      const count = (state.root?.jobs?.length ?? 0) + (state.root?.subagents?.length ?? 0)
      return [{ ...state, overlay: moveOverlay(state.overlay, action.number - 1, count) }, redraw()]
    }
    case 'overlay-submit': {
      const overlay = state.overlay
      if (overlay === undefined) return [state, []]
      if (overlay.kind === 'history') return reduce(state, { type: 'history-toggle' })
      if (overlay.kind === 'info') return reduce(state, { type: 'overlay-close' })
      if (overlay.kind === 'details') return [{
        ...state, overlay: { ...overlay, expanded: !overlay.expanded },
      }, redraw()]
      if (overlay.kind === 'confirm') {
        if (overlay.cursor !== 0) return reduce(state, { type: 'overlay-close' })
        const { overlay: _overlay, ...withoutOverlay } = state
        return [withoutOverlay, [{ type: 'activate-overlay', value: overlay.value }, ...redraw()]]
      }
      const option = overlay.options[overlay.cursor]
      if (option === undefined) return [state, []]
      if (option.value.kind === 'insert') {
        const { overlay: _overlay, ...withoutOverlay } = state
        if (action.execute === true && option.submitOnEnter === true) {
          return reduce({ ...withoutOverlay, composer: option.value.text.trimEnd() }, { type: 'submit' })
        }
        return [{ ...withoutOverlay, composer: option.value.text, recall: undefined }, [
          { type: 'set-composer', text: option.value.text }, ...redraw(),
        ]]
      }
      if (option.value.kind === 'attach') {
        const { overlay: _overlay, ...withoutOverlay } = state
        return [withoutOverlay, [{
          type: 'attach', path: option.value.path, source: option.value.source, text: option.value.text,
        }, ...redraw()]]
      }
      if (option.value.kind === 'permission' && option.danger === true) {
        return [{ ...state, overlay: {
          acceptLabel: 'Enable',
          cursor: 1,
          detail: option.confirmDetail ?? ['This preset disables approval prompts.'],
          kind: 'confirm',
          title: `Enable ${option.label}?`,
          value: option.value,
        } }, redraw()]
      }
      const { overlay: _overlay, ...withoutOverlay } = state
      return [withoutOverlay, [{ type: 'activate-overlay', value: option.value }, ...redraw()]]
    }
    case 'redraw': return [state, [{ type: 'redraw', force: true }]]
    case 'prompt-recorded':
      return state.root?.id !== action.rootId
        ? [state, []] : [{ ...state, prompts: [...state.prompts, action.text], recall: undefined }, []]
    case 'recall-move': {
      if (state.prompts.length === 0) return [state, []]
      const current = state.recall?.cursor ?? state.prompts.length
      const cursor = Math.max(0, Math.min(state.prompts.length, current + action.offset))
      const draft = state.recall?.draft ?? state.composer
      const text = cursor === state.prompts.length ? draft : state.prompts[cursor]
      if (text === undefined) return [state, []]
      return [{
        ...state, composer: text,
        ...(cursor === state.prompts.length ? { recall: undefined } : { recall: { cursor, draft } }),
      }, [{ type: 'set-composer', text }, ...redraw()]]
    }
    case 'request-completion':
      return head === undefined && state.overlay === undefined && state.composer !== ''
        ? [state, [{ type: 'complete', caret: action.caret, query: state.composer }]] : [state, []]
    case 'request-search':
      return head === undefined && state.overlay === undefined && state.root !== undefined
        && state.composer.trim() !== ''
        ? [state, [{ type: 'search', query: state.composer, rootId: state.root.id }]] : [state, []]
    case 'scroll': {
      if (state.cells.length === 0) return [state, []]
      const limit = state.cells.length - 1
      const scrollOffset = action.direction === 'end' ? 0
        : action.direction === 'home' ? limit
          : Math.max(0, Math.min(limit, state.scrollOffset
            + (action.direction === 'page-up' ? 1 : -1) * (action.lines ?? PAGE_CELLS)))
      const load = state.root !== undefined && state.historyHasMore
        && (action.direction === 'home' || action.direction === 'page-up' && scrollOffset === limit)
        ? [{ type: 'load-history', rootId: state.root.id } as const] : []
      return [{
        ...state, scrollOffset,
        ...(scrollOffset === 0 ? { newOutput: 0 } : {}),
      }, [...load, ...redraw()]]
    }
    case 'search-close': {
      if (state.search === undefined) return [state, []]
      const { search: _search, ...withoutSearch } = state
      return [withoutSearch, [{ type: 'set-composer', text: state.composer }, ...redraw()]]
    }
    case 'search-move': {
      const search = state.search
      if (search === undefined || search.matches.length === 0) return [state, []]
      const cursor = (search.cursor + action.offset + search.matches.length) % search.matches.length
      const index = search.matches[cursor]
      if (index === undefined) return [state, []]
      return [{
        ...state, search: { ...search, cursor },
        ...(search.scope === 'history'
          ? { overlay: { cursor: index, expanded: false, kind: 'history' as const } }
          : { scrollOffset: Math.max(0, state.cells.length - 1 - index) }),
      }, redraw()]
    }
    case 'search-open': {
      if (head !== undefined || action.scope === 'history' && state.overlay?.kind !== 'history') return [state, []]
      const found = matches(state.cells, '')
      const next = { ...state, search: { cursor: 0, matches: found, query: '', scope: action.scope } }
      if (action.scope === 'history') return [next, [{ type: 'set-composer', text: '' }, ...redraw()]]
      const { overlay: _overlay, ...withoutOverlay } = next
      return [withoutOverlay, [{ type: 'set-composer', text: '' }, ...redraw()]]
    }
    case 'suspend': return [state, [{ type: 'suspend' }]]
    case 'stash-toggle': {
      const current = { attachments: state.attachments, composer: state.composer, cursor: action.cursor }
      if (state.stash === undefined) {
        if (current.composer === '' && current.attachments.length === 0) return [state, []]
        return [{ ...state, attachments: [], composer: '', stash: current }, [
          { type: 'set-composer', text: '' }, ...redraw(),
        ]]
      }
      const restored = state.stash
      if (current.composer === '' && current.attachments.length === 0) {
        const { stash: _stash, ...withoutStash } = state
        return [{ ...withoutStash, attachments: restored.attachments, composer: restored.composer }, [
          { type: 'set-composer', text: restored.composer, cursor: restored.cursor }, ...redraw(),
        ]]
      }
      return [{
        ...state, attachments: restored.attachments, composer: restored.composer, stash: current,
      }, [{ type: 'set-composer', text: restored.composer, cursor: restored.cursor }, ...redraw()]]
    }
    case 'terminal-lost':
      return state.decisions.length === 0 ? [state, []] : [
        { ...state, decisions: [] },
        state.decisions.map(decision => ({ type: 'reject-decision', id: decision.id, reason: 'terminal' })),
      ]
    case 'cycle-permission':
      if (head !== undefined) return [state, []]
      if (state.overlay === undefined) return [state, [{ type: 'cycle-permission' }]]
      {
        const { overlay: _overlay, ...withoutOverlay } = state
        return [withoutOverlay, [{ type: 'cycle-permission' }]]
      }
    case 'toggle-send-mode': {
      if (state.root?.status !== 'running') return [state, []]
      const sendMode = state.sendMode === 'steer' ? 'next-turn' : 'steer'
      return [{ ...state, sendMode }, redraw()]
    }
    case 'toggle-tool-mode': {
      const toolMode = state.toolMode === 'collapsed' ? 'expanded' : state.toolMode === 'expanded' ? 'hidden' : 'collapsed'
      return [{ ...state, toolMode }, redraw()]
    }
    case 'turn-ended':
      return state.root?.id === action.rootId && action.durationMs >= TURN_BELL_THRESHOLD_MS
        ? [state, [{ type: 'bell' }]] : [state, []]
    case 'submit': {
      if (head !== undefined) return reduce(state, { type: 'decision-submit' })
      if (state.root === undefined || state.composer === '' && state.attachments.length === 0) return [state, []]
      const mode = state.root.status === 'running' ? state.sendMode : 'next-turn'
      return [{
        ...state, attachments: [], composer: '', exitArmed: false, recall: undefined, rewindArmed: false,
      }, [
        { type: 'set-composer', text: '' }, {
          type: 'submit', attachments: state.attachments, text: state.composer, mode,
        }, ...redraw(),
      ]]
    }
    case 'root-bound':
      {
        const { overlay: _overlay, ...withoutOverlay } = state
        return [{
          ...withoutOverlay, cells: action.cells, historyHasMore: action.hasMore,
          newOutput: 0, prompts: action.prompts, recall: undefined,
          rewindArmed: false, root: action.root, scrollOffset: 0, search: undefined,
        }, redraw()]
      }
    case 'root-cleared': {
      if (state.root === undefined) return [state, []]
      const { root: _root, ...withoutRoot } = state
      return [{
        ...withoutRoot, historyHasMore: false, newOutput: 0, prompts: [],
        recall: undefined, rewindArmed: false, scrollOffset: 0, search: undefined,
      }, redraw()]
    }
    case 'root-model':
      if (state.root?.id !== action.rootId) return [state, []]
      {
        const { effort: _effort, ...root } = state.root
        return [{ ...state, root: {
          ...root,
          model: action.model,
          provider: action.provider,
          ...(action.effort === undefined ? {} : { effort: action.effort }),
        } }, redraw()]
      }
    case 'root-presentation': {
      if (state.root?.id !== action.rootId) return [state, []]
      const { contextPercent: _contextPercent, ...root } = state.root
      const contextPercent = action.contextPercent === null
        ? undefined
        : action.contextPercent ?? state.root.contextPercent
      return [{ ...state, root: {
        ...root,
        ...(action.jobs === undefined && state.root.jobs === undefined ? {} : { jobs: action.jobs ?? state.root.jobs }),
        ...(action.subagents === undefined && state.root.subagents === undefined
          ? {} : { subagents: action.subagents ?? state.root.subagents }),
        ...(contextPercent === undefined ? {} : { contextPercent }),
      } }, redraw()]
    }
    case 'root-status':
      return state.root?.id !== action.rootId || state.root.status === action.status
        ? [state, []] : [{ ...state, root: { ...state.root, status: action.status } }, redraw()]
    case 'root-permission':
      return state.root?.id !== action.rootId || state.root.permission === action.preset
        ? [state, []] : [{ ...state, root: { ...state.root, permission: action.preset } }, redraw()]
    case 'root-title':
      return state.root?.id !== action.rootId || state.root.title === action.title
        ? [state, []] : [{ ...state, root: { ...state.root, title: action.title } }, redraw()]
    case 'runtime-error':
      if (action.rootId !== undefined && state.root?.id !== action.rootId) return [state, []]
      return [{
        ...state, cells: [...state.cells, {
          key: `runtime-error:${state.cells.length}`, kind: 'error', text: action.message,
        }],
        ...(state.scrollOffset === 0 ? {} : {
          newOutput: state.newOutput + 1, scrollOffset: state.scrollOffset + 1,
        }),
      }, redraw()]
    case 'transcript-changed': {
      if (action.rootId !== undefined && state.root?.id !== action.rootId) return [state, []]
      const added = Math.max(0, action.cells.length - state.cells.length)
      const search = refreshSearch(state.search, action.cells)
      return [{
        ...state, cells: action.cells,
        ...(action.hasMore === undefined ? {} : { historyHasMore: action.hasMore }),
        ...(search === undefined ? {} : { search }),
        ...(state.scrollOffset === 0 ? { newOutput: 0 } : {
          newOutput: state.newOutput + 1, scrollOffset: state.scrollOffset + added,
        }),
      }, redraw()]
    }
    case 'copy-latest': {
      const cell = latestCompletedAssistant(state.cells)
      return cell === undefined ? [state, []] : [state, [{ type: 'copy', text: cell.text }]]
    }
  }
}
