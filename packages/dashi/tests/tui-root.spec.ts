import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import { TuiRoot } from '../src/tui-root.js'

function agent(id: string): Agent {
  return { id } as unknown as Agent
}

describe('TuiRoot host contract', () => {
  it('lets a fixture plugin observe one post-swap event at bind and exit', async () => {
    const ctx = new Context()
    const root = new TuiRoot(ctx)
    const seen: string[] = []
    await ctx.plugin((fixture) => {
      fixture.on('tui/root-changed', (previous, current) => {
        expect(ctx.tuiRoot.current()).toBe(current)
        seen.push(`${String(previous?.id)}>${String(current?.id)}`)
      })
    })
    const current = agent('session-current')
    root.bind(current)
    root.clear(current)
    root.clear(current)
    expect(seen).toEqual(['undefined>session-current', 'session-current>undefined'])
    await ctx.fiber.dispose()
  })

  it('clears a bound root once on native disposal', () => {
    const ctx = new Context()
    const root = new TuiRoot(ctx)
    const current = agent('session-current')
    let changes = 0
    ctx.on('tui/root-changed', () => { changes++ })
    root.bind(current)
    ctx.emit('agent/disposed', { agent: current })
    ctx.emit('agent/disposed', { agent: current })
    expect(root.current()).toBeUndefined()
    expect(changes).toBe(2)
  })
})
