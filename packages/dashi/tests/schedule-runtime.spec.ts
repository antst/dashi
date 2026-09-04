import { Context, Service } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as SchedulePlugin from '@deepseek-ai/dsh-schedule'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class PersistenceProbe extends Service {
  constructor(ctx: Context) {
    super(ctx, 'sessionPersistence')
  }
}

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index++) await Promise.resolve()
  await vi.advanceTimersByTimeAsync(0)
  for (let index = 0; index < 8; index++) await Promise.resolve()
}

describe('DSH fixed-rate schedule runtime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:00:00.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires twice and stops through the native durable schedule tools', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PersistenceProbe)
    ctx.on('session/flush', () => {})
    await ctx.plugin(AgentLoop, { agents: [] })
    const plugin = await ctx.plugin(SchedulePlugin)
    const root = await ctx.agents.create({ sessionId: SessionId('dashi-loop-runtime') })
    const followup = vi.spyOn(root.agent, 'followup').mockImplementation(() => {})
    const execute = (name: string, arguments_: unknown) => ctx.agents.withInitiator(root.agent, () => ctx.tools.execute({
      agent: root.agent,
      arguments: arguments_,
      callId: ToolCallId(`dashi-${name}`),
      name,
      signal: new AbortController().signal,
    }))

    try {
      await settle()
      const created = await execute('schedule_create', { every_seconds: 300, prompt: 'check the build' })
      expect(created).toMatchObject({ isError: false, value: { id: 'schedule-1', kind: 'every' } })

      await vi.advanceTimersByTimeAsync(300_000)
      await settle()
      await vi.advanceTimersByTimeAsync(300_000)
      await settle()
      const followed = followup.mock.calls.map(([message]) => message)
      expect(followed).toHaveLength(2)
      expect(followed.every(message => message.source.kind === 'plugin'
        && message.source.plugin === 'schedule')).toBe(true)
      expect(followed.every(message => JSON.stringify(message.content).includes('check the build'))).toBe(true)

      const deleted = await execute('schedule_delete', { id: 'schedule-1' })
      expect(deleted).toMatchObject({ isError: false, value: { id: 'schedule-1', deleted: true } })
      expect(await execute('schedule_list', {})).toMatchObject({ isError: false, value: [] })
      await vi.advanceTimersByTimeAsync(300_000)
      await settle()
      expect(followup).toHaveBeenCalledTimes(2)
      expect(root.agent.session.snapshotEvents().filter(event => event.type === 'schedule/change')
        .map(event => event.data.operation)).toEqual(['create', 'dispatch', 'dispatch', 'delete'])
    } finally {
      await root.dispose()
      await plugin.dispose()
      await ctx.fiber.dispose()
    }
  })
})
