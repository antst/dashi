import { ProcessTerminal, type Terminal } from '@earendil-works/pi-tui'
import { formatWithOptions } from 'node:util'
import { filterWheelInput } from './mouse-input.js'

export interface TerminalSession {
  drainInput(): Promise<void>
  render(force: boolean): void
  start(): void
  stop(preserveScreen: boolean): void
}

export interface TerminalGuard {
  diagnostics(): { readonly count: number; readonly lines: readonly string[] }
  dispose(): Promise<void>
  start(): void
  withCookedTerminal(operation: () => Promise<void>): Promise<void>
}

export function createProcessTerminal(onWheel?: (lines: number) => void): Terminal {
  const terminal = new ProcessTerminal()
  if (onWheel === undefined) return terminal
  return {
    get columns() { return terminal.columns },
    get kittyProtocolActive() { return terminal.kittyProtocolActive },
    get rows() { return terminal.rows },
    clearFromCursor: () => { terminal.clearFromCursor() },
    clearLine: () => { terminal.clearLine() },
    clearScreen: () => { terminal.clearScreen() },
    drainInput: (maxMs, idleMs) => terminal.drainInput(maxMs, idleMs),
    hideCursor: () => { terminal.hideCursor() },
    moveBy: lines => { terminal.moveBy(lines) },
    setProgress: active => { terminal.setProgress(active) },
    setTitle: title => { terminal.setTitle(title) },
    showCursor: () => { terminal.showCursor() },
    start(onInput, onResize) {
      terminal.start(data => {
        const filtered = filterWheelInput(data)
        if (typeof filtered === 'string') onInput(filtered)
        else onWheel(filtered)
      }, onResize)
    },
    stop: () => { terminal.stop() },
    write: data => { terminal.write(data) },
  }
}

export function createTerminalGuard(session: TerminalSession): TerminalGuard {
  let phase: 'fresh' | 'active' | 'cooked' | 'released' = 'fresh'
  let disposal: Promise<void> | undefined
  let restoreOnExit: (() => void) | undefined
  const levels = ['log', 'info', 'warn', 'error', 'debug'] as const
  let originals: readonly typeof console.log[] | undefined
  const lines: string[] = []
  let count = 0

  const stopOwned = (): void => {
    if (restoreOnExit === undefined) return
    process.off('exit', restoreOnExit)
    restoreOnExit = undefined
    try {
      session.stop(true)
    } finally {
      levels.forEach((level, index) => { console[level] = originals![index]! })
      originals = undefined
    }
  }

  const startOwned = (): void => {
    restoreOnExit = function restore() {
      if (restoreOnExit !== restore) return
      phase = 'released'
      try { stopOwned() } catch { /* Exit listeners must not throw. */ }
    }
    process.once('exit', restoreOnExit)
    originals = levels.map(level => console[level])
    for (const level of levels) console[level] = (...args: unknown[]) => {
      const text = formatWithOptions({ colors: false, depth: 4, maxArrayLength: 20, maxStringLength: 4_096, customInspect: false }, ...args)
      for (const value of text.split(/\r?\n/u)) {
        count++
        const line = `[${level}] ${value}`
        const suffix = '… [line truncated]'
        lines.push(line.length > 4_096 ? `${line.slice(0, 4_096 - suffix.length)}${suffix}` : line)
        if (lines.length > 200) lines.shift()
      }
    }
    session.start()
  }

  const stopActive = async (): Promise<void> => {
    try {
      await session.drainInput()
    } finally {
      stopOwned()
    }
  }

  return {
    diagnostics: () => ({ count, lines: [...lines] }),
    start() {
      if (phase !== 'fresh') return
      phase = 'active'
      startOwned()
    },

    dispose() {
      if (disposal !== undefined) return disposal
      const wasActive = phase === 'active'
      phase = 'released'
      disposal = wasActive ? stopActive() : Promise.resolve()
      return disposal
    },

    async withCookedTerminal(operation) {
      if (phase !== 'active') return
      phase = 'cooked'
      await stopActive()
      try {
        await operation()
      } finally {
        if (phase === 'cooked') {
          phase = 'active'
          startOwned()
          session.render(true)
        }
      }
    },
  }
}
