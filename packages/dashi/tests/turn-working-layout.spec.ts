import { Terminal } from '@xterm/headless'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer } from '../src/renderer.js'
import { createTerminalShell } from '../src/application.js'
import { initialViewState, reduce, type JobView, type ViewState } from '../src/state.js'
import { createTerminalGuard } from '../src/terminal-guard.js'
import { foldCells } from '../src/transcript.js'
import { recordedEvents } from './fixtures/session-format.js'

const now = 1_800_000_000_000
let clock = now
let previousColor: string | undefined
const working = { startedAt: now - 30_000, phase: 'Waiting for model', phaseStartedAt: now - 20_000 }
const cells = foldCells(recordedEvents(new URL('./fixtures/live-activity-session.jsonl', import.meta.url)))
const jobs = (JSON.parse(readFileSync(new URL('./fixtures/live-activity-frames.json', import.meta.url), 'utf8')) as {
  frames: [readonly JobView[], readonly JobView[]]
}).frames[1]

class Screen {
  readonly screen: Terminal
  output = ''
  private pending = Promise.resolve()
  constructor(public columns = 80, public rows = 24) {
    this.screen = new Terminal({ allowProposedApi: true, cols: columns, rows, convertEol: true })
  }
  get kittyProtocolActive(): boolean { return false }
  start(): void {}
  stop(): void {}
  drainInput(): Promise<void> { return Promise.resolve() }
  write(data: string): void {
    this.output += data
    this.pending = this.pending.then(() => new Promise<void>(resolve => { this.screen.write(data, resolve) }))
  }
  moveBy(n: number): void { this.write(`\u001B[${Math.abs(n)}${n < 0 ? 'A' : 'B'}`) }
  hideCursor(): void { this.write('\u001B[?25l') }
  showCursor(): void { this.write('\u001B[?25h') }
  clearLine(): void { this.write('\u001B[2K') }
  clearFromCursor(): void { this.write('\u001B[0J') }
  clearScreen(): void { this.write('\u001B[2J\u001B[H') }
  setTitle(): void {}
  setProgress(): void {}
  async flush(): Promise<void> {
    await new Promise(resolve => { setImmediate(resolve) })
    await this.pending
  }
  lines(): string[] {
    const buffer = this.screen.buffer.active
    return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
  }
}

const rootState = (inline = false): ViewState => initialViewState('/fixture', inline, {
  cwd: '/fixture', id: 'root', model: 'recorded', status: 'running', jobs, working,
})
const rowOf = (lines: readonly string[]): number => lines.findIndex(value => /^[·•●*] Waiting for model/u.test(value))

describe('working row layout and timer ownership', () => {
  beforeEach(() => {
    clock = now; vi.spyOn(Date, 'now').mockImplementation(() => clock)
    previousColor = process.env.NO_COLOR; process.env.NO_COLOR = '1'
  })
  afterEach(() => {
    vi.restoreAllMocks()
    if (previousColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = previousColor
  })

  it('uses native open facts, rejects an old root clear, and clears at end even while the agent runs', async () => {
    const terminal = new Screen()
    let state = rootState(true)
    const renderer = createRenderer({ inline: true, terminal, readState: () => state, dispatch() {}, statusLine: () => 'MODEL_STATUS' })
    renderer.start()
    try {
      renderer.render(true); await terminal.flush()
      const lines = terminal.lines()
      const row = rowOf(lines)
      expect(row).toBeGreaterThan(0)
      expect(lines[row - 1]).toBe('')
      expect(lines[row]).toMatch(/^[·•●] Waiting for model · 20s · turn 30s$/u)
      expect(lines[row + 1]).toBe('MODEL_STATUS')
      const footer = lines.find(value => value.startsWith('running ·'))
      state = { ...state, root: { ...state.root!, status: 'idle' } }
      renderer.render(false); await terminal.flush()
      expect(rowOf(terminal.lines())).toBe(row)
      state = reduce(state, { type: 'root-presentation', rootId: 'wrong-root', working: null })[0]
      expect(state.root?.working).toEqual(working)
      state = { ...state, root: { ...state.root!, status: 'running' } }
      state = reduce(state, { type: 'root-presentation', rootId: 'root', working: null })[0]
      renderer.render(false); await terminal.flush()
      expect(rowOf(terminal.lines())).toBe(-1)
      expect(terminal.lines().find(value => value.startsWith('running ·'))).toBe(footer)
      expect(state.root?.working).toBeUndefined()
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('publishes transcript and working facts atomically with one synchronized frame', async () => {
    const terminal = new Screen()
    const shell = createTerminalShell({ cwd: '/fixture', inline: false, exit() {}, initialRoot: rootState().root,
      createView: bindings => createRenderer({ ...bindings, inline: false, terminal, statusLine: () => 'MODEL_STATUS' }) })
    shell.start()
    try {
      await shell.whenIdle(); await terminal.flush()
      const from = terminal.output.length
      const next = { ...working, phase: 'Receiving text' }
      shell.dispatch({ type: 'transcript-changed', rootId: 'root', working: next, cells: [{ key: 'text', kind: 'assistant', text: 'NATIVE_TEXT' }] })
      await shell.whenIdle(); await terminal.flush()
      expect(terminal.output.slice(from).split('\u001B[?2026h').length - 1).toBe(1)
      expect(shell.readState().root?.working).toEqual(next)
      expect(terminal.lines().join('\n')).toContain('NATIVE_TEXT')
      expect(terminal.lines().join('\n')).toContain('Receiving text')
      shell.dispatch({ type: 'transcript-changed', rootId: 'other-root', working: null, cells: [] })
      expect(shell.readState().root?.working).toEqual(next)
      shell.dispatch({ type: 'transcript-changed', rootId: 'root', cells: [] })
      expect(shell.readState().root?.working).toEqual(next)
      shell.dispatch({ type: 'transcript-changed', rootId: 'root', working: null, cells: [] })
      expect(shell.readState().root?.working).toBeUndefined()
    } finally { await shell.dispose(); terminal.screen.dispose() }
  })

  for (const inline of [true, false]) for (const [columns, rows] of [[80, 24], [200, 60]] as const) {
    it(`redraws one row over seventy jobs for 100 ticks, ${inline ? 'inline' : 'fullscreen'} ${columns}x${rows}`, async () => {
      const terminal = new Screen(columns, rows)
      const state = { ...rootState(inline), cells }
      const renderer = createRenderer({ inline, terminal, readState: () => state, dispatch() {}, statusLine: () => 'MODEL_STATUS' })
      renderer.setComposer('W143_UNSENT_DRAFT', { line: 0, col: 7 })
      renderer.start()
      try {
        renderer.render(true); await terminal.flush()
        const initial = terminal.lines()
        expect(initial.join('\n')).toContain('W143_UNSENT_DRAFT')
        const row = rowOf(initial)
        expect(row).toBeGreaterThan(0)
        expect(initial[row - 1]).toBe('')
        expect(initial[row + 1]).toBe('MODEL_STATUS')
        const scroll = terminal.screen.buffer.active.baseY
        const cursor = [terminal.screen.buffer.active.cursorX, terminal.screen.buffer.active.cursorY]
        const shapes = new Set<string>()
        const samples: number[] = []
        const bytes: number[] = []
        for (let tick = 1; tick <= 100; tick++) {
          clock = now + tick * 250
          const from = terminal.output.length
          const started = performance.now()
          renderer.render(false)
          samples.push(performance.now() - started)
          await terminal.flush()
          const lines = terminal.lines()
          expect(lines.slice(0, row)).toEqual(initial.slice(0, row))
          expect(lines.slice(row + 1)).toEqual(initial.slice(row + 1))
          expect(terminal.screen.buffer.active.baseY).toBe(scroll)
          expect([terminal.screen.buffer.active.cursorX, terminal.screen.buffer.active.cursorY]).toEqual(cursor)
          expect(terminal.output.slice(from).match(new RegExp(String.raw`\u001B\[2K`, 'gu'))).toHaveLength(1)
          expect(terminal.output.slice(from)).not.toContain('MODEL_STATUS')
          bytes.push(Buffer.byteLength(terminal.output.slice(from)))
          expect(lines[row]).toMatch(/^[·•●] Waiting for model · /u)
          shapes.add(lines[row]![0]!)
        }
        expect([...shapes].sort()).toEqual(['·', '•', '●'].sort())
        samples.sort((a, b) => a - b)
        process.stdout.write(`performance: working-row-${inline ? 'inline' : 'fullscreen'}-${columns} median ${samples[50]!.toFixed(3)} ms p95 ${samples[95]!.toFixed(3)} ms bytes/tick ${Math.min(...bytes)}-${Math.max(...bytes)}\n`)
      } finally { renderer.stop(true); terminal.screen.dispose() }
    })
  }

  for (const accessible of [false, true]) for (const columns of [32, 48, 80, 200]) {
    it(`keeps one sanitised row at ${columns} columns, accessible=${accessible}`, async () => {
      const color = process.env.NO_COLOR
      process.env.NO_COLOR = '1'
      const terminal = new Screen(columns)
      const base = rootState(true)
      const state = { ...base, root: { ...base.root!, working: { startedAt: now - 1000, phase: 'Tool request', tail: 'read\nnext\u001B[2J\u009B2J' } } }
      const renderer = createRenderer({ accessible, inline: true, terminal, readState: () => state, dispatch() {} })
      renderer.start()
      try {
        renderer.render(true); await terminal.flush()
        const line = terminal.lines().find(value => value.includes('Tool request'))!
        expect(line).toMatch(accessible ? /^\* Tool request · turn 1s/u : /^[·•●] Tool request · turn 1s/u)
        expect(terminal.lines().filter(value => value.includes('Tool request'))).toHaveLength(1)
        expect(terminal.lines()[terminal.lines().indexOf(line) + 1]).toMatch(/^─+$/u)
        expect(terminal.lines().join('\n')).toContain('dashi')
        if (columns >= 48) expect(line).toContain('read next')
        if (accessible) {
          clock = now + 1000; renderer.render(false); await terminal.flush()
          expect(terminal.lines().find(value => value.includes('Tool request'))).toContain('* Tool request · turn 2s')
        }
      } finally {
        renderer.stop(true); terminal.screen.dispose()
        if (color === undefined) delete process.env.NO_COLOR
        else process.env.NO_COLOR = color
      }
    })
  }

  it('retains the row above panels and preserves the attachment gaps and selection', async () => {
    const terminal = new Screen()
    const base = rootState(true)
    const deltas = [
      { attachments: [{ name: 'image', mediaType: 'image/png', bytes: 1, path: '/fixture/image.png' }] },
      { overlay: { kind: 'list', purpose: 'model', title: 'Model', cursor: 0, options: [{ label: 'SELECTED_MODEL', value: { kind: 'model', provider: 'replay', model: 'm' } }] } },
      { search: { scope: 'transcript', query: '', matches: [], cursor: 0 } },
      { decisions: [{ id: 'permission', kind: 'approval', cursor: 0, owner: { id: 'root' }, prompt: 'NATIVE_APPROVAL', toolName: 'bash' }] },
    ]
    let state = base
    const renderer = createRenderer({ inline: true, terminal, readState: () => state, dispatch() {}, statusLine: () => 'MODEL_STATUS' })
    renderer.start()
    try {
      for (const [index, delta] of deltas.entries()) {
        state = { ...base, ...delta } as ViewState
        renderer.render(true); await terminal.flush()
        const lines = terminal.lines()
        const row = rowOf(lines)
        expect(lines[row - 1]).toBe('')
        expect(lines[row + 1]).toContain(['MODEL_STATUS', 'Model', 'Search transcript', 'Approval'][index]!)
        if (index === 0) {
          expect(lines[row - 2]).toContain('[image 1]')
          expect(lines[row - 3]).toBe('')
        }
        if (index === 1) expect(lines.join('\n')).toContain('SELECTED_MODEL')
        if (index === 3) expect(lines.join('\n')).toContain('NATIVE_APPROVAL')
      }
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('owns one unref animation handle and keeps the pending-command rate without retaining a turn timer', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const cancelled = vi.spyOn(globalThis, 'clearTimeout')
    const terminal = new Screen()
    let state = rootState()
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    const handles = (delay: number) => timers.mock.calls.flatMap((call, index) => call[1] === delay ? [timers.mock.results[index]!.value as NodeJS.Timeout] : [])
    try {
      renderer.render(false)
      expect(handles(250)).toHaveLength(0)
      renderer.start(); renderer.render(true); await terminal.flush()
      expect(handles(250)).toHaveLength(1)
      expect(handles(250)[0]!.hasRef()).toBe(false)
      const expiry = timers.mock.calls.find(call => call[1] === 250)![0] as () => void
      state = reduce(state, { type: 'root-presentation', rootId: 'root', working: null })[0]
      renderer.render(false); await terminal.flush()
      expect(cancelled.mock.calls.some(call => call[0] === handles(250)[0])).toBe(true)
      const count = handles(250).length
      expiry(); renderer.render(false); await terminal.flush()
      expect(handles(250)).toHaveLength(count)
      renderer.stop(true)
      state = { ...rootState(), cells: [{ key: 'cmd', kind: 'command', pending: true, text: '/compact' }] }
      renderer.start(); renderer.render(true); await terminal.flush()
      expect(handles(80)).toHaveLength(1)
      expect(handles(80)[0]!.hasRef()).toBe(false)
      expect(handles(250)).toHaveLength(count)
      renderer.stop(true)
      const commandExpiry = timers.mock.calls.find(call => call[1] === 80)![0] as () => void
      commandExpiry(); renderer.render(false); await terminal.flush()
      expect(handles(80)).toHaveLength(1)
      expect(handles(250)).toHaveLength(count)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('uses a single unref one-second handle in accessible mode, also when a command overlaps', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const terminal = new Screen()
    const state = { ...rootState(), cells: [{ key: 'cmd', kind: 'command' as const, pending: true, text: '/compact' }] }
    const renderer = createRenderer({ accessible: true, terminal, inline: false, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      renderer.render(true); await terminal.flush()
      const indices = timers.mock.calls.flatMap((call, index) => call[1] === 1000 ? [index] : [])
      expect(indices).toHaveLength(1)
      expect((timers.mock.results[indices[0]!]!.value as NodeJS.Timeout).hasRef()).toBe(false)
      expect(timers.mock.calls.some(call => call[1] === 80 || call[1] === 250)).toBe(false)
      expect(terminal.lines().some(line => line.startsWith('* Waiting for model'))).toBe(true)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('re-arms that one timer after expiry and switches to the command rate on its next render', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const terminal = new Screen()
    let state = rootState()
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      renderer.render(true); await terminal.flush()
      const first = timers.mock.calls.findIndex(call => call[1] === 250)
      const handle = timers.mock.results[first]!.value as NodeJS.Timeout
      clearTimeout(handle) // Settle the real handle before invoking its own expiry callback.
      clock += 250
      ;(timers.mock.calls[first]![0] as () => void)()
      renderer.render(false); await terminal.flush()
      const pulseTimers = timers.mock.calls.flatMap((call, index) => call[1] === 250 ? [index] : [])
      expect(pulseTimers).toHaveLength(2)
      expect((timers.mock.results[pulseTimers[1]!]!.value as NodeJS.Timeout).hasRef()).toBe(false)
      state = { ...state, cells: [{ key: 'cmd', kind: 'command', pending: true, text: '/compact' }] }
      const next = pulseTimers[1]!
      clearTimeout(timers.mock.results[next]!.value as NodeJS.Timeout)
      ;(timers.mock.calls[next]![0] as () => void)()
      renderer.render(false); await terminal.flush()
      expect(timers.mock.calls.filter(call => call[1] === 80)).toHaveLength(1)
      expect(timers.mock.calls.filter(call => call[1] === 250)).toHaveLength(2)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('does not keep a plain Node process alive while a native-open presentation row remains', () => {
    // The gate builds these modules first. No DSH boot, profile or model call in this liveness control.
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import { createRenderer } from './packages/dashi/lib/renderer.js';
      import { initialViewState } from './packages/dashi/lib/state.js';
      const terminal = { columns:80, rows:24, kittyProtocolActive:false, start(){}, stop(){},
        drainInput:async()=>{}, write(){}, moveBy(){}, hideCursor(){}, showCursor(){},
        clearLine(){}, clearFromCursor(){}, clearScreen(){}, setTitle(){}, setProgress(){} };
      const state = initialViewState('/fixture', false, { cwd:'/fixture', id:'root', model:'recorded',
        status:'running', working:{startedAt:Date.now(), phase:'Working'} });
      const renderer = createRenderer({terminal, inline:false, readState:()=>state, dispatch(){}});
      renderer.start(); renderer.render(true); console.log('working renderer started');
    `], { cwd: fileURLToPath(new URL('../../..', import.meta.url)), encoding: 'utf8', timeout: 2000, killSignal: 'SIGKILL' })
    expect(output.trim()).toBe('working renderer started')
  })

  it('uses the existing guard for cooked handoff, disposal and its owned exit callback', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const cancelled = vi.spyOn(globalThis, 'clearTimeout')
    const terminal = new Screen()
    let state = rootState()
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    const guard = createTerminalGuard(renderer)
    const prior = new Set(process.listeners('exit'))
    guard.start(); renderer.render(true); await terminal.flush()
    let release!: () => void
    const edit = guard.withCookedTerminal(() => new Promise<void>(resolve => { release = resolve }))
    try {
      await terminal.flush()
      const first = timers.mock.calls.findIndex(call => call[1] === 250)
      expect(cancelled.mock.calls.some(call => call[0] === timers.mock.results[first]!.value)).toBe(true)
      const from = terminal.output.length
      state = { ...state, root: { ...state.root!, working: { ...working, phase: 'Receiving text' } } }
      const expiry = timers.mock.calls.find(call => call[1] === 250)![0] as () => void
      expiry(); renderer.render(false); await terminal.flush()
      expect(terminal.output.slice(from)).toBe('')
      release(); await edit; await terminal.flush()
      expect(terminal.lines().join('\n')).toContain('Receiving text')
      const listener = process.listeners('exit').find(value => !prior.has(value))!
      expect(listener).toBeTypeOf('function')
      listener(0) // The guard's own callback; never exit the Vitest worker.
      const last = timers.mock.calls.flatMap((call, index) => call[1] === 250 ? [index] : []).at(-1)!
      expect(last).toBeGreaterThan(first)
      expect(cancelled.mock.calls.some(call => call[0] === timers.mock.results[last]!.value)).toBe(true)
      const stopped = terminal.output.length
      renderer.render(false); await terminal.flush()
      expect(terminal.output.slice(stopped)).toBe('')
    } finally { release(); await edit; await guard.dispose(); terminal.screen.dispose() }
  })

  it('never re-acquires or re-arms when disposed during a cooked interval', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const terminal = new Screen()
    const renderer = createRenderer({ terminal, inline: false, readState: rootState, dispatch() {} })
    const guard = createTerminalGuard(renderer)
    guard.start(); renderer.render(true); await terminal.flush()
    let release!: () => void
    const edit = guard.withCookedTerminal(() => new Promise<void>(resolve => { release = resolve }))
    try {
      await terminal.flush()
      const from = terminal.output.length
      const count = timers.mock.calls.filter(call => call[1] === 250).length
      await guard.dispose()
      release(); await edit; renderer.render(false); await terminal.flush()
      expect(terminal.output.slice(from)).toBe('')
      expect(timers.mock.calls.filter(call => call[1] === 250)).toHaveLength(count)
    } finally { release(); await edit; await guard.dispose(); terminal.screen.dispose() }
  })
})
