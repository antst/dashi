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
import { turnWorking } from '../src/turn-working.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
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

  it('shows silence only from the current live stream, and removes it on a new chunk', async () => {
    const terminal = new Screen()
    const events = [
      { type: 'turn/start', seq: 1, time: now - 70_000, data: { turn: 1 } },
      { type: 'step/start', seq: 2, time: now - 60_000, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    let state = rootState()
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      for (const [chunk, phase] of [
        [{ type: 'reasoning-delta', index: 0, text: 'reason' }, 'Reasoning'],
        [{ type: 'text-delta', index: 0, text: 'text' }, 'Receiving text'],
        [{ type: 'tool-call-delta', index: 0, id: ToolCallId('call'), name: 'read', argumentsDelta: '{}' }, 'Tool request'],
        [{ type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }, 'Working'],
        [{ type: 'finish', reason: { kind: 'stop' } }, 'Working'],
        [{ type: 'unknown-provider-event' }, 'Working'],
      ] as const) {
        const live = { attemptId: 'current', turn: 1, step: 1, startedAfterSeq: 2, lastChunk: { time: now, chunk } }
        state = { ...state, root: { ...state.root!, working: turnWorking(events, live as never)! } }
        clock = now + 2_999; renderer.render(false); await terminal.flush()
        expect(terminal.lines().join('\n')).not.toContain('no data')
        clock = now + 3_000; renderer.render(false); await terminal.flush()
        expect(terminal.lines().find(line => line.includes(phase))).toContain(`${phase} · no data 3s · turn 1m 13s`)
        clock = now + 11_000; renderer.render(false); await terminal.flush()
        expect(terminal.lines().find(line => line.includes(phase))).toContain(`${phase} · no data 11s · turn 1m 21s`)
        state = { ...state, root: { ...state.root!, working: turnWorking(events, { ...live, lastChunk: { time: clock, chunk } } as never)! } }
        renderer.render(false); await terminal.flush()
        expect(terminal.lines().join('\n')).not.toContain('no data')
      }
      const phases = [
        turnWorking(events, { attemptId: 'new', turn: 1, step: 1, startedAfterSeq: 2, observedAt: now }),
        turnWorking([...events, { type: 'tool/call', seq: 3, time: now, data: { turn: 1, step: 1, callId: 'a', name: 'bash' } } as SessionEvent]),
        turnWorking([...events, { type: 'llm/retry', seq: 3, time: now, data: { turn: 1, step: 1, retry: 1 } } as unknown as SessionEvent]),
      ]
      for (const working of phases) {
        state = { ...state, root: { ...state.root!, working: working! } }
        renderer.render(false); await terminal.flush()
        expect(terminal.lines().join('\n')).not.toContain('no data')
      }
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('keeps unknown turn age absent rather than showing an attach-time clock', async () => {
    const terminal = new Screen()
    const state = { ...rootState(), root: { ...rootState().root!, working: { phase: 'Working' } } }
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      renderer.render(true); await terminal.flush()
      expect(terminal.lines().find(line => /^[·•●] Working/u.test(line))).toMatch(/^[·•●] Working$/u)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('caches the loaded settled cells, but evicts replaced keys at that same bound', async () => {
    const terminal = new Screen()
    let reads = 0
    const settled = (prefix: string) => Array.from({ length: 600 }, (_, index) => ({
      key: `${prefix}-${String(index)}`, kind: 'assistant' as const,
      get text() { reads++; return `${prefix} answer ${String(index)}` },
    }))
    const first = settled('FIRST')
    let state = { ...rootState(true), cells: first, root: { cwd: '/fixture', id: 'root', model: 'recorded', status: 'idle' as const } }
    const renderer = createRenderer({ terminal, inline: true, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      renderer.render(true); await terminal.flush()
      reads = 0 // Each key reads text once; materialising a cache miss reads it again.
      renderer.render(false); await terminal.flush()
      expect(reads).toBe(600)
      state = { ...state, cells: settled('SECOND') }
      reads = 0
      renderer.render(false); await terminal.flush()
      expect(reads).toBe(1200)
      state = { ...state, cells: first }
      reads = 0
      renderer.render(false); await terminal.flush()
      expect(reads).toBe(1200)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('shows the row exactly once with a completion list, and gives every long panel one row', async () => {
    const terminal = new Screen()
    const base = rootState()
    const { working: _working, ...idleRoot } = base.root!
    let state = base
    const options = Array.from({ length: 60 }, (_, index) => ({ label: `ENTRY_${index}`, value: { kind: 'insert' as const, text: `command-${index}` } }))
    const deltas = [
      { overlay: { kind: 'list', purpose: 'completion', title: 'Completion', cursor: 0, options } },
      { overlay: { kind: 'list', purpose: 'model', title: 'Model', cursor: 0, options } },
      { overlay: { kind: 'info', title: 'Info', lines: options.map(option => option.label) } },
      { decisions: [{ id: 'many', kind: 'question', cursor: 0, index: 0, custom: '', selected: [], answers: [], owner: { id: 'root' },
        questions: [{ id: 'q', question: 'Pick', multiSelect: false, options: options.map(option => ({ label: option.label })) }] }] },
    ]
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      for (const delta of deltas) {
        state = { ...base, ...delta, root: idleRoot } as ViewState
        renderer.render(true); await terminal.flush()
        const without = terminal.lines().filter(line => line.includes('ENTRY_')).length
        state = { ...base, ...delta } as ViewState
        renderer.render(true); await terminal.flush()
        const lines = terminal.lines()
        expect(lines.filter(line => /^[·•●] Waiting for model/u.test(line))).toHaveLength(1)
        expect(lines.filter(line => line.includes('ENTRY_'))).toHaveLength(without - 1)
      }
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('does no work before the inline terminal is acquired', async () => {
    const terminal = new Screen()
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const renderer = createRenderer({ terminal, inline: true, readState: rootState, dispatch() {} })
    try {
      renderer.render(false); await terminal.flush()
      expect(terminal.output).toBe('')
      expect(timers.mock.calls.some(call => call[1] === 500)).toBe(false)
      renderer.start(); renderer.render(false); await terminal.flush()
      expect(rowOf(terminal.lines())).toBeGreaterThanOrEqual(0)
      expect(timers.mock.calls.filter(call => call[1] === 500)).toHaveLength(1)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  for (const inline of [true, false]) for (const [columns, rows] of [[80, 24], [200, 60]] as const) {
    it(`redraws one row over seventy jobs for 100 ticks, ${inline ? 'inline' : 'fullscreen'} ${columns}x${rows}`, async () => {
      const terminal = new Screen(columns, rows)
      const base = rootState(inline)
      const state = { ...base, cells, root: { ...base.root!, working: { ...working, startedAt: now - 50_000, phaseStartedAt: now - 50_000 } } }
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
        const ages = new Set<string>()
        const samples: number[] = []
        const bytes: number[] = []
        for (let tick = 1; tick <= 100; tick++) {
          clock = now + tick * 500
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
          expect(lines[row]![0]).toBe(['·', '•', '●', '•'][Math.floor(clock / 500) % 4])
          ages.add(lines[row]!.slice(2))
        }
        expect([...shapes].sort()).toEqual(['·', '•', '●'].sort())
        expect(ages.has('Waiting for model · 59s · turn 59s')).toBe(true)
        expect(ages.has('Waiting for model · 1m 0s · turn 1m 0s')).toBe(true)
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
      expect(handles(500)).toHaveLength(0)
      renderer.start(); renderer.render(true); await terminal.flush()
      expect(handles(500)).toHaveLength(1)
      expect(handles(500)[0]!.hasRef()).toBe(false)
      const expiry = timers.mock.calls.find(call => call[1] === 500)![0] as () => void
      state = reduce(state, { type: 'root-presentation', rootId: 'root', working: null })[0]
      renderer.render(false); await terminal.flush()
      expect(cancelled.mock.calls.some(call => call[0] === handles(500)[0])).toBe(true)
      const count = handles(500).length
      expiry(); renderer.render(false); await terminal.flush()
      expect(handles(500)).toHaveLength(count)
      renderer.stop(true)
      state = { ...rootState(), cells: [{ key: 'cmd', kind: 'command', pending: true, text: '/compact' }] }
      renderer.start(); renderer.render(true); await terminal.flush()
      expect(handles(80)).toHaveLength(1)
      expect(handles(80)[0]!.hasRef()).toBe(false)
      expect(handles(500)).toHaveLength(count)
      renderer.stop(true)
      const commandExpiry = timers.mock.calls.find(call => call[1] === 80)![0] as () => void
      commandExpiry(); renderer.render(false); await terminal.flush()
      expect(handles(80)).toHaveLength(1)
      expect(handles(500)).toHaveLength(count)
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
      expect(timers.mock.calls.some(call => call[1] === 80 || call[1] === 500)).toBe(false)
      expect(terminal.lines().some(line => line.startsWith('* Waiting for model'))).toBe(true)
    } finally { renderer.stop(true); terminal.screen.dispose() }
  })

  it('re-arms that one timer after expiry and switches to the command rate on its next render', async () => {
    const timers = vi.spyOn(globalThis, 'setTimeout')
    const cancelled = vi.spyOn(globalThis, 'clearTimeout')
    const terminal = new Screen()
    let state = rootState()
    const renderer = createRenderer({ terminal, inline: false, readState: () => state, dispatch() {} })
    renderer.start()
    try {
      renderer.render(true); await terminal.flush()
      const first = timers.mock.calls.findIndex(call => call[1] === 500)
      const handle = timers.mock.results[first]!.value as NodeJS.Timeout
      state = { ...state, overlay: { kind: 'list', purpose: 'model', cursor: 0, title: 'Model', options: [] } }
      renderer.render(false); await terminal.flush()
      expect(cancelled.mock.calls.some(call => call[0] === handle)).toBe(false)
      clearTimeout(handle) // Settle the real handle before invoking its own expiry callback.
      clock += 500
      ;(timers.mock.calls[first]![0] as () => void)()
      renderer.render(false); await terminal.flush()
      const pulseTimers = timers.mock.calls.flatMap((call, index) => call[1] === 500 ? [index] : [])
      expect(pulseTimers).toHaveLength(2)
      expect((timers.mock.results[pulseTimers[1]!]!.value as NodeJS.Timeout).hasRef()).toBe(false)
      state = { ...state, cells: [{ key: 'cmd', kind: 'command', pending: true, text: '/compact' }] }
      const next = pulseTimers[1]!
      clearTimeout(timers.mock.results[next]!.value as NodeJS.Timeout)
      ;(timers.mock.calls[next]![0] as () => void)()
      renderer.render(false); await terminal.flush()
      expect(timers.mock.calls.filter(call => call[1] === 80)).toHaveLength(1)
      expect(timers.mock.calls.filter(call => call[1] === 500)).toHaveLength(2)
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
      const first = timers.mock.calls.findIndex(call => call[1] === 500)
      expect(cancelled.mock.calls.some(call => call[0] === timers.mock.results[first]!.value)).toBe(true)
      const from = terminal.output.length
      state = { ...state, root: { ...state.root!, working: { ...working, phase: 'Receiving text' } } }
      const expiry = timers.mock.calls.find(call => call[1] === 500)![0] as () => void
      expiry(); renderer.render(false); await terminal.flush()
      expect(terminal.output.slice(from)).toBe('')
      release(); await edit; await terminal.flush()
      expect(terminal.lines().join('\n')).toContain('Receiving text')
      const listener = process.listeners('exit').find(value => !prior.has(value))!
      expect(listener).toBeTypeOf('function')
      listener(0) // The guard's own callback; never exit the Vitest worker.
      const last = timers.mock.calls.flatMap((call, index) => call[1] === 500 ? [index] : []).at(-1)!
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
      const count = timers.mock.calls.filter(call => call[1] === 500).length
      await guard.dispose()
      release(); await edit; renderer.render(false); await terminal.flush()
      expect(terminal.output.slice(from)).toBe('')
      expect(timers.mock.calls.filter(call => call[1] === 500)).toHaveLength(count)
    } finally { release(); await edit; await guard.dispose(); terminal.screen.dispose() }
  })
})
