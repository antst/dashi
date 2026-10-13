import { Terminal } from '@xterm/headless'
import { describe, expect, it } from 'vitest'
import { createRenderer } from '../src/renderer.js'
import { initialViewState } from '../src/state.js'

describe('working row', () => {
  it('shows a native open-turn working row above the model status, not just a running footer', async () => {
    const screen = new Terminal({ allowProposedApi: true, cols: 80, rows: 24, convertEol: true })
    let pending = Promise.resolve()
    const write = (data: string) => { pending = pending.then(() => new Promise<void>(resolve => { screen.write(data, resolve) })) }
    const terminal = {
      columns: 80, rows: 24, kittyProtocolActive: false,
      start() {}, stop() {}, drainInput: async () => {}, write,
      moveBy: (n: number) => { write(`\u001B[${Math.abs(n)}${n < 0 ? 'A' : 'B'}`) },
      hideCursor: () => { write('\u001B[?25l') }, showCursor: () => { write('\u001B[?25h') },
      clearLine: () => { write('\u001B[2K') }, clearFromCursor: () => { write('\u001B[0J') },
      clearScreen: () => { write('\u001B[2J\u001B[H') }, setTitle() {}, setProgress() {},
    }
    const state = initialViewState('/fixture', true, {
      cwd: '/fixture', id: 'root', model: 'recorded', status: 'running',
      ...{ working: { startedAt: Date.now() - 30_000, phase: 'Waiting for model', phaseStartedAt: Date.now() - 20_000 } },
    })
    const renderer = createRenderer({ inline: true, terminal, readState: () => state, dispatch() {}, statusLine: () => 'MODEL_STATUS' })
    try {
      renderer.start(); renderer.render(true)
      await new Promise(resolve => { setImmediate(resolve) }); await pending
      const b = screen.buffer.active
      const rows = Array.from({ length: b.length }, (_, i) => b.getLine(i)?.translateToString(true) ?? '')
      const row = rows.findIndex(value => value.includes('Waiting for model'))
      expect(row).toBeGreaterThan(0)
      expect(rows[row - 1]).toBe('')
      expect(rows[row]).toMatch(/[·•●] Waiting for model · 20s · turn 30s/u)
      expect(rows[row + 1]).toBe('MODEL_STATUS')
      expect(rows.find(value => value.startsWith('running ·'))).toBe('running · Enter steer · Ctrl+T steer/queue · Ctrl+O cards collapsed · Esc inter…')
    } finally { renderer.stop(true); screen.dispose() }
  })
})
