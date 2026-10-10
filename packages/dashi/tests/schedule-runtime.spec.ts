import { Context } from '@deepseek-ai/cordis'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ScheduleService from '@deepseek-ai/dsh-schedule'
import * as ScheduleTools from '@deepseek-ai/dsh-tool-schedule'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import * as JsonStorage from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
    const storageRoot = mkdtempSync(join(tmpdir(), 'dashi-native-schedule-'))
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(Storage)
    await ctx.plugin(JsonStorage, { root: storageRoot })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    ctx.provide('sessionPersistence', {
      create: async (header: unknown) => ({
        header,
        inheritedEventCount: 0,
        append: async () => {},
        close: async () => {},
      }),
    } as never)
    ctx.on('session/flush', () => {})
    await ctx.plugin(AgentLoop, { agents: [] })
    // The unit owns one known Agent; only native controller resolution is substituted.
    ctx.provide('sessionController', { resolveAgent: async (id: SessionId) => ({ agent: ctx.agents.get(id) }) } as never)
    const plugin = await ctx.plugin(ScheduleService)
    await ctx.plugin(ScheduleTools)
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
      const created = await execute('schedule_create', { title: 'check the build', every_seconds: 300, prompt: 'check the build' })
      expect(created.error, JSON.stringify(created)).toBeUndefined()
      expect(created).toMatchObject({ isError: false, value: { kind: 'every', title: 'check the build' } })
      const id = (created.value as { id: string }).id
      expect(id).toMatch(/^schedule-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u)

      await vi.advanceTimersByTimeAsync(300_000)
      await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(1) })
      await vi.waitFor(() => { expect(vi.getTimerCount()).toBeGreaterThan(0) })
      await vi.advanceTimersByTimeAsync(300_000)
      await vi.waitFor(() => { expect(followup).toHaveBeenCalledTimes(2) })
      const followed = followup.mock.calls.map(([message]) => message)
      expect(followed).toHaveLength(2)
      expect(followed.map(message => message.source)).toEqual([{ kind: 'schedule' }, { kind: 'schedule' }])
      expect(followed.every(message => JSON.stringify(message.content).includes('check the build'))).toBe(true)
      await vi.waitFor(async () => {
        expect(await ctx.schedule.history({ sessionId: root.agent.id, id: id as never, limit: 10 }))
          .toMatchObject({ records: [expect.anything(), expect.anything()] })
      })

      const deleted = await execute('schedule_delete', { id })
      expect(deleted).toMatchObject({ isError: false, value: { id, deleted: true } })
      expect(await execute('schedule_list', {})).toMatchObject({ isError: false, value: [] })
      await vi.advanceTimersByTimeAsync(300_000)
      await settle()
      expect(followup).toHaveBeenCalledTimes(2)
      expect(await ctx.schedule.catalog()).toEqual([])
    } finally {
      await root.dispose()
      await plugin.dispose()
      await ctx.fiber.dispose()
      rmSync(storageRoot, { recursive: true, force: true })
    }
  })
})
