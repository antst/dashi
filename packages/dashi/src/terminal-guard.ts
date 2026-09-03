import { ProcessTerminal, type Terminal } from '@earendil-works/pi-tui'
import { filterWheelInput } from './mouse-input.js'

export interface TerminalSession {
  drainInput(): Promise<void>
  render(force: boolean): void
  start(): void
  stop(preserveScreen: boolean): void
}

export interface TerminalGuard {
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

  const stopActive = async (): Promise<void> => {
    try {
      await session.drainInput()
    } finally {
      session.stop(true)
    }
  }

  return {
    start() {
      if (phase !== 'fresh') return
      phase = 'active'
      session.start()
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
          session.start()
          session.render(true)
        }
      }
    },
  }
}
