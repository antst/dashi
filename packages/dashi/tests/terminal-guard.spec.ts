import { describe, expect, it } from 'vitest'
import { createTerminalGuard, type TerminalSession } from '../src/terminal-guard.js'

function session(log: string[]): TerminalSession {
  return {
    drainInput: async () => { log.push('drain') },
    render: force => { log.push(`render:${force}`) },
    start: () => { log.push('start') },
    stop: preserve => { log.push(`stop:${preserve}`) },
  }
}

function ownedExitListener(before: readonly Function[]): () => void {
  const added = process.listeners('exit').filter(listener => !before.includes(listener))
  expect(added).toHaveLength(1)
  return added[0] as () => void
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('TerminalGuard', () => {
  it('starts and disposes once in release order', async () => {
    const log: string[] = []
    const guard = createTerminalGuard(session(log))
    guard.start()
    guard.start()
    await Promise.all([guard.dispose(), guard.dispose()])
    guard.start()
    expect(log).toEqual(['start', 'drain', 'stop:true'])
  })

  it('uses the same cooked handoff for suspend and redraws on resume', async () => {
    const log: string[] = []
    const guard = createTerminalGuard(session(log))
    guard.start()
    await guard.withCookedTerminal(async () => { log.push('suspended') })
    await guard.dispose()
    expect(log).toEqual([
      'start', 'drain', 'stop:true', 'suspended', 'start', 'render:true', 'drain', 'stop:true',
    ])
  })

  it('owns an exit listener only while started and restores synchronously at exit', async () => {
    const before = process.listeners('exit')
    const log: string[] = []
    const guard = createTerminalGuard(session(log))
    try {
      expect(process.listeners('exit')).toEqual(before)
      guard.start()
      guard.start()
      const listener = ownedExitListener(before)
      listener()
      expect(log).toEqual(['start', 'stop:true'])
      expect(process.listeners('exit')).toEqual(before)
      listener()
      await guard.dispose()
      guard.start()
      expect(log).toEqual(['start', 'stop:true'])
      expect(process.listeners('exit')).toEqual(before)
    } finally {
      await guard.dispose()
    }
  })

  it('removes the listener after ordinary disposal without stopping at a later exit', async () => {
    const before = process.listeners('exit')
    const log: string[] = []
    const guard = createTerminalGuard(session(log))
    try {
      guard.start()
      const listener = ownedExitListener(before)
      await guard.dispose()
      expect(process.listeners('exit')).toEqual(before)
      listener()
      expect(log).toEqual(['start', 'drain', 'stop:true'])
    } finally {
      await guard.dispose()
    }
  })

  it('restores at exit during a pending drain and stops once when that drain settles', async () => {
    const before = process.listeners('exit')
    const log: string[] = []
    const drained = deferred()
    const guard = createTerminalGuard({
      ...session(log), drainInput: () => { log.push('drain'); return drained.promise },
    })
    try {
      guard.start()
      const listener = ownedExitListener(before)
      const disposal = guard.dispose()
      expect(process.listeners('exit')).toContain(listener)
      expect(log).toEqual(['start', 'drain'])
      listener()
      expect(log).toEqual(['start', 'drain', 'stop:true'])
      expect(process.listeners('exit')).toEqual(before)
      drained.resolve()
      await disposal
      expect(log).toEqual(['start', 'drain', 'stop:true'])
    } finally {
      drained.resolve()
      await guard.dispose()
    }
  })

  it('releases the exit listener while cooked and reacquires a fresh one on resume', async () => {
    const before = process.listeners('exit')
    const log: string[] = []
    const guard = createTerminalGuard(session(log))
    try {
      guard.start()
      const first = ownedExitListener(before)
      await guard.withCookedTerminal(async () => {
        expect(process.listeners('exit')).toEqual(before)
        first()
        expect(log).toEqual(['start', 'drain', 'stop:true'])
      })
      const resumed = ownedExitListener(before)
      expect(resumed).not.toBe(first)
      resumed()
      expect(log).toEqual(['start', 'drain', 'stop:true', 'start', 'render:true', 'stop:true'])
      expect(process.listeners('exit')).toEqual(before)
    } finally {
      await guard.dispose()
    }
  })

  it('does not restart or register a listener after disposal during a cooked operation', async () => {
    const before = process.listeners('exit')
    const log: string[] = []
    const operation = deferred()
    const entered = deferred()
    const guard = createTerminalGuard(session(log))
    let handoff: Promise<void> | undefined
    try {
      guard.start()
      handoff = guard.withCookedTerminal(async () => { entered.resolve(); await operation.promise })
      await entered.promise
      expect(process.listeners('exit')).toEqual(before)
      await guard.dispose()
      operation.resolve()
      await handoff
      expect(log).toEqual(['start', 'drain', 'stop:true'])
      expect(process.listeners('exit')).toEqual(before)
    } finally {
      operation.resolve()
      await handoff
      await guard.dispose()
    }
  })
})
