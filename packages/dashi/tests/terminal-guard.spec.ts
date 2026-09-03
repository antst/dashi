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
})
