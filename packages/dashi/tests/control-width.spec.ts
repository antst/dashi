import { Terminal } from '@xterm/headless'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer } from '../src/renderer.js'
import { initialViewState, type Overlay, type OverlayOption, type ViewState } from '../src/state.js'

const now = 1_800_000_000_000
const working = { phase: 'Waiting for model', startedAt: now - 20_000, phaseStartedAt: now - 10_000 }
const transcript = [{ key: 'answer', kind: 'assistant' as const, text: 'Recorded answer' }]
const draft = 'draft stays here'
type Shape = { name: string; state: ViewState }

function shapes(stress = false): Shape[] {
  const text = stress ? 'A lengthy label with wide 界 glyphs and enough words to exceed a narrow terminal' : 'Short label'
  const state = { ...initialViewState('/fixture', true, {
    cwd: '/fixture', id: 'root', model: 'recorded', status: 'idle', contextPercent: 47,
    jobs: [{ id: 'bash-1', kind: 'bash', label: text, status: 'stopping', startedAt: now - 40_000 }],
    subagents: [{ id: 'agent-1', label: text, mode: 'one-shot', state: 'running' }],
  }), composer: draft, cells: transcript }
  const result: Shape[] = []
  const add = (name: string, delta: Partial<ViewState>) => { result.push({ name, state: { ...state, ...delta } }) }
  const attachment = { bytes: 1, data: new Uint8Array([0]), mediaType: 'image/png' as const, name: text, path: '/fixture/image.png' }
  result.push({ name: 'no session', state: { ...initialViewState('/fixture', true), composer: draft, cells: [] } })
  add('idle empty', { cells: [] })
  add('idle transcript', {})
  add('running', { root: { ...state.root!, status: 'running' } })
  add('working', { root: { ...state.root!, status: 'running', working } })
  add('pending command', { cells: [...transcript, { key: 'command', kind: 'command', text: '/compact', pending: true, startedAt: now - 4_000 }] })
  add('exit armed', { exitArmed: true })
  add('attachments empty', { cells: [], attachments: [attachment] })
  add('attachments transcript', { attachments: [attachment] })
  add('new output', { newOutput: 2 })
  for (const cursor of [0, 1, 2]) add(`approval ${cursor}`, { decisions: [{ id: 'approval', kind: 'approval', owner: { id: 'root' }, cursor, prompt: text, toolName: 'bash' }] })
  const question = { id: 'question', kind: 'question' as const, owner: { id: 'root' }, answers: [], cursor: 0, index: 0, custom: '', selected: [],
    questions: [{ id: 'q', question: text, multiSelect: false, options: [{ label: text, description: 'Description' }] }] }
  add('question', { decisions: [question] })
  add('question multi', { decisions: [{ ...question, selected: [text], questions: [{ ...question.questions[0]!, multiSelect: true }] }] })
  add('question custom', { decisions: [{ ...question, cursor: 1, custom: draft }] })
  add('question secret', { decisions: [{ ...question, cursor: 1, custom: draft, questions: [{ ...question.questions[0]!, secret: true }] }] })
  add('question plan', { decisions: [{ ...question, questions: [{ ...question.questions[0]!, detail: text, intent: { kind: 'plan-review', approve: 'Proceed' } }] }] })
  add('question empty', { decisions: [{ ...question, questions: [] }] })
  for (const expanded of [false, true]) {
    add(`history ${expanded}`, { overlay: { kind: 'history', cursor: 0, expanded }, cells: [{ ...transcript[0]!, text }] })
    add(`activity ${expanded}`, { overlay: { kind: 'details', cursor: 0, expanded } })
  }
  add('info', { overlay: { kind: 'info', title: text, lines: [text, 'Second line'] } })
  add('info cells', { overlay: { kind: 'info', title: 'Output', lines: [], cells: [{ key: 'output', kind: 'context', text }], scrollOffset: 1 } })
  for (const cursor of [0, 1]) add(`confirm ${cursor}`, { overlay: { kind: 'confirm', title: text, detail: [text], acceptLabel: text, cursor, value: { kind: 'new' } } })
  const options: OverlayOption[] = [{ group: 'Commands', label: text, detail: text, active: true, danger: true, value: { kind: 'insert', text: '/help' } },
    { group: 'Skills', label: 'Second', value: { kind: 'insert', text: '/skills' } }]
  const purposes: Extract<Overlay, { kind: 'list' }>['purpose'][] = ['agents', 'completion', 'copy', 'memory', 'model', 'permission', 'resume', 'rewind', 'rewind-action', 'search', 'skills']
  for (const purpose of purposes) add(`list ${purpose}`, { overlay: { kind: 'list', purpose, title: text, cursor: 0, notice: text, options } })
  for (const scope of ['history', 'transcript'] as const) for (const matched of [false, true]) add(`search ${scope} ${matched}`, {
    search: { scope, query: draft, cursor: 0, matches: matched ? [0] : [] },
    ...(scope === 'history' ? { overlay: { kind: 'history', cursor: 0, expanded: false } as const } : {}),
  })
  return result
}

// Component-only stress, not native frames: the group type permits only the
// three short literals. This adversarial group pins the composition boundary.
function rawPaths(): { name: string; accessible: boolean; width: number; state: ViewState; prefix: string; occurrences?: number }[] {
  const base = shapes()[2]!.state
  const long = 'LONG raw control label '.repeat(3)
  const list = { kind: 'list' as const, purpose: 'model' as const, title: 'List', cursor: 0,
    options: [{ label: 'Choice', value: { kind: 'insert' as const, text: 'choice' } }] }
  return [
    { name: 'history heading', accessible: true, width: 48, state: { ...base, cells: [{ ...transcript[0]!, text: long }], overlay: { kind: 'history', cursor: 0, expanded: false } }, prefix: 'History' },
    { name: 'history help', accessible: false, width: 48, state: { ...base, overlay: { kind: 'history', cursor: 0, expanded: false } }, prefix: '↑↓ select' },
    { name: 'info heading', accessible: false, width: 48, state: { ...base, overlay: { kind: 'info', title: long, lines: ['Body'] } }, prefix: 'LONG', occurrences: 2 },
    { name: 'info help', accessible: false, width: 32, state: { ...base, overlay: { kind: 'info', title: 'Info', lines: ['Body'] } }, prefix: '↑↓ scroll' },
    { name: 'confirm heading', accessible: true, width: 48, state: { ...base, overlay: { kind: 'confirm', title: long, detail: [], acceptLabel: 'Accept', cursor: 0, value: { kind: 'new' } } }, prefix: 'LONG', occurrences: 2 },
    { name: 'confirm accept label', accessible: false, width: 48, state: { ...base, overlay: { kind: 'confirm', title: 'Confirm', detail: [], acceptLabel: long, cursor: 0, value: { kind: 'new' } } }, prefix: '› 1 [ ] LONG' },
    { name: 'list notice', accessible: false, width: 48, state: { ...base, overlay: { ...list, notice: long } }, prefix: 'LONG' },
    { name: 'adversarial list group', accessible: false, width: 48, state: { ...base, overlay: { ...list, options: [{ ...list.options[0]!, group: long as NonNullable<OverlayOption['group']> }] } }, prefix: 'LONG' },
    { name: 'search hint', accessible: false, width: 45, state: { ...base, search: { scope: 'transcript', query: draft, matches: [], cursor: 0 } }, prefix: 'no matches' },
    { name: 'search announcement', accessible: true, width: 46, state: { ...base, search: { scope: 'transcript', query: draft, matches: [0], cursor: 0 } }, prefix: 'Search transcript' },
  ]
}

class Screen {
  readonly screen: Terminal
  // The same bytes, without terminal auto-wrap concealing an over-wide row.
  readonly mirror = new Terminal({ allowProposedApi: true, cols: 1_024, rows: 24, convertEol: true })
  output = ''
  private pending = Promise.resolve()
  constructor(public columns: number, public rows = 24) {
    this.screen = new Terminal({ allowProposedApi: true, cols: columns, rows, convertEol: true })
  }
  get kittyProtocolActive(): boolean { return false }
  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> { return Promise.resolve() }
  write(data: string): void {
    this.output += data
    this.pending = this.pending.then(() => Promise.all([this.screen, this.mirror].map(screen => new Promise<void>(resolve => { screen.write(data, resolve) })))).then(() => {})
  }
  moveBy(n: number): void { this.write(`\u001B[${Math.abs(n)}${n < 0 ? 'A' : 'B'}`) }
  hideCursor(): void { this.write('\u001B[?25l') }
  showCursor(): void { this.write('\u001B[?25h') }
  clearLine(): void { this.write('\u001B[2K') }
  clearFromCursor(): void { this.write('\u001B[0J') }
  clearScreen(): void { this.write('\u001B[2J\u001B[H') }
  setTitle(): void {}
  setProgress(): void {}
  async flush(): Promise<void> { await new Promise(resolve => { setImmediate(resolve) }); await this.pending }
  dispose(): void { this.screen.dispose(); this.mirror.dispose() }
  lines(): string[] {
    const buffer = this.mirror.buffer.active
    return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
  }
  widths(): number[] {
    const buffer = this.mirror.buffer.active
    return Array.from({ length: buffer.length }, (_, row) => {
      const line = buffer.getLine(row)
      for (let column = (line?.length ?? 0) - 1; column >= 0; column--) {
        const cell = line?.getCell(column)
        if (cell !== undefined && cell.getChars().trim() !== '') return column + cell.getWidth()
      }
      return 0
    })
  }
}

async function render(state: ViewState, columns: number, accessible: boolean, changed = false): Promise<Screen> {
  const terminal = new Screen(columns)
  let current = changed ? shapes()[2]!.state : state
  const renderer = createRenderer({ inline: true, accessible, terminal, readState: () => current, dispatch() {}, statusLine: () => 'MODEL_STATUS' })
  try {
    renderer.start(); renderer.setComposer(draft, { line: 0, col: 5 }); renderer.render(true); await terminal.flush()
    if (changed) { current = state; renderer.render(false); await terminal.flush() }
    return terminal
  } catch (error) { terminal.dispose(); throw error }
  finally { renderer.stop(true) }
}

describe('control-region width at the composition boundary', () => {
  let crashDirectory: string
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    vi.stubEnv('PI_HARDWARE_CURSOR', '0')
    vi.stubEnv('PI_CLEAR_ON_SHRINK', '0')
    crashDirectory = mkdtempSync(join(tmpdir(), 'dashi-control-width-'))
    vi.stubEnv('PI_CODING_AGENT_DIR', crashDirectory)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    rmSync(crashDirectory, { recursive: true, force: true })
  })

  for (const accessible of [false, true]) for (const width of [32, 45, 46, 48, 80]) {
    it(`bounds every inline state at ${width} columns, accessible=${accessible}`, async () => {
      const failures: string[] = []
      for (const shape of shapes(true)) for (const open of [false, true]) {
        const state = open && shape.state.root !== undefined ? { ...shape.state, root: { ...shape.state.root, working } } : shape.state
        let screen: Screen | undefined
        try {
          screen = await render(state, width, accessible, true)
          const oversized = screen.widths().filter(value => value > width)
          if (oversized.length > 0) failures.push(`${shape.name}, open=${open}: widths ${oversized.join(', ')}`)
        } catch (error) { failures.push(`${shape.name}, open=${open}: ${String(error).split('\n')[0]}`) }
        finally { screen?.dispose() }
      }
      expect(failures).toEqual([])
    })
  }

  for (const path of rawPaths()) it(`cuts the raw ${path.name} path with the existing ellipsis, not wrapping`, async () => {
    const screen = await render(path.state, path.width, path.accessible)
    try {
      expect(screen.widths().every(width => width <= path.width)).toBe(true)
      const rows = screen.lines().filter(line => line.startsWith(path.prefix))
      // Info/confirm titles also appear in their unchanged footer.
      expect(rows).toHaveLength(path.occurrences ?? 1)
      expect(rows.every(row => row.endsWith('…'))).toBe(true)
      const buffer = screen.screen.buffer.active
      expect(Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.isWrapped).some(Boolean)).toBe(false)
    } finally { screen.dispose() }
  })

  // Captured before the fix, from develop 7c1f577. These fixtures fit at 80/200.
  // Hashes bind every output byte (including colour and cursor movement), and
  // the actual-width terminal's visible rows and cursor (including the draft).
  for (const accessible of [false, true]) for (const width of [80, 200]) {
    it(`preserves fitting bytes, cursor and draft at ${width}, accessible=${accessible}`, async () => {
      const frames: Record<string, string> = {}
      for (const shape of shapes()) for (const open of [false, true]) {
        const state = open && shape.state.root !== undefined ? { ...shape.state, root: { ...shape.state.root, working } } : shape.state
        const screen = await render(state, width, accessible, true)
        try {
          expect(screen.widths().every(value => value <= width)).toBe(true)
          const buffer = screen.screen.buffer.active
          const lines = Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
          frames[`${shape.name}, open=${open}`] = createHash('sha256').update(JSON.stringify({
            output: screen.output, lines, cursor: [buffer.cursorX, buffer.cursorY],
          })).digest('hex')
        } finally { screen.dispose() }
      }
      expect(frames).toMatchSnapshot()
    })
  }
})
