import type { Context } from '@deepseek-ai/cordis'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm/assistant-stream'
import { describe, expect, it, vi } from 'vitest'
import { createSessionRuntime } from '../src/session-runtime.js'
import type { TuiRoot } from '../src/tui-root.js'
import type { UiAction } from '../src/state.js'

describe('working facts at the runtime opening boundary', () => {
  it.each([false, true])('opens an already-running turn through Controller records, truncated=%s', async truncated => {
    const id = SessionId('working-open')
    const events = [
      { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
      { type: 'step/start', seq: 2, time: 2000, data: { turn: 1, step: 1 } },
    ] as SessionEvent[]
    const stream = new AssistantStreamAccumulator()
    stream.push({ time: 3000, chunk: { type: 'text-delta', index: 0, text: 'already streaming' } })
    // Public native frame shapes, fake transport only: no host, boot or network.
    const opening = { type: 'snapshot', header: { id, cwd: '/fixture' }, cursor: 2,
      records: events.slice(truncated ? 1 : 0).map(event => ({ type: 'event', event })), hasMore: truncated,
      projections: { asOfSeq: 2, values: { turnBoundary: { openTurnStartSeq: 1 } } },
      assistantStream: { revision: 1, activeAttempt: { attemptId: 'native-attempt', startedAfterSeq: 2, turn: 1, step: 1, nextIndex: 1, stream: stream.snapshot() } },
    } as unknown as SessionFollowFrame
    const once = async function* (value: unknown) { yield value }
    const follow = async function* () {
      yield opening
      yield { type: 'event', event: { type: 'tool/call', seq: 3, time: 4000,
        data: { turn: 1, step: 1, callId: 'pending', name: 'read', arguments: '{}' } } } as unknown as SessionFollowFrame
    }
    const scope = Object.assign(Promise.resolve(), { dispose: vi.fn(async () => {}) })
    const snapshotEvents = vi.fn(() => { throw new Error('deprecated read forbidden in this path') })
    const session = { id, header: { id, cwd: '/fixture' }, snapshotEvents }
    const agent = { id, session, status: 'running', options: { provider: 'replay' }, inbox: { nextStep: [] },
      ctx: { inject: () => scope }, cancel: vi.fn(), whenIdle: vi.fn(async () => {}) }
    const page = vi.fn(async () => ({ records: [{ type: 'event', event: events[0] }], hasMore: false }))
    const ctx = {
      llm: { listConfigurableProviders: () => [] }, logger: { warn: vi.fn() },
      sessions: { flush: vi.fn(async () => {}), get: () => session },
      sessionController: { resolveAgent: async () => ({ agent }), follow, page,
        control: () => once({ type: 'baseline', value: { projections: {} } }), list: async () => ({ items: [] }) },
      jobController: { list: () => once({ jobs: [] }) },
      get: (name: string) => name === 'subagents' ? { listChildren: async () => [] } : undefined,
      permissionPresets: { current: () => 'workspace-write' },
      commands: { find: () => ({ name: 'permission', handler: () => ({ kind: 'success' }) }) },
      on: () => () => {},
    } as unknown as Context
    const root = { bind: vi.fn(), clear: vi.fn() } as unknown as TuiRoot
    const actions: UiAction[] = []
    const runtime = await createSessionRuntime(ctx, { cwd: '/fixture', resume: id, continue: false, forkSession: false }, root, action => { actions.push(action) })
    try {
      expect(root.bind).toHaveBeenCalledWith(agent)
      expect(runtime.root.working).toEqual({ startedAt: 1000, phase: 'Receiving text', lastChunkAt: 3000 })
      expect(runtime.root.working).not.toHaveProperty('phaseStartedAt')
      expect(runtime.initialCells.some(cell => cell.text === 'already streaming')).toBe(true)
      expect(snapshotEvents).not.toHaveBeenCalled()
      expect(ctx.logger.warn).not.toHaveBeenCalled()
      expect(page).toHaveBeenCalledTimes(truncated ? 1 : 0)
      if (truncated) expect(page).toHaveBeenCalledWith({ address: { kind: 'session', sessionId: id }, throughSeq: 2, beforeSeq: 2, maxMessages: 50 }, expect.any(AbortSignal))
      runtime.start()
      await vi.waitFor(() => { expect(runtime.root.working).toEqual({ startedAt: 1000, phase: 'Tool pending', phaseStartedAt: 4000, tail: 'read' }) })
      expect(actions.some(action => action.type === 'transcript-changed' && action.working?.phase === 'Tool pending')).toBe(true)
      expect(snapshotEvents).not.toHaveBeenCalled()
    } finally { await runtime.shutdown() }
  })
})
