import type { Context } from '@deepseek-ai/cordis'
import type { SessionFollowFrame } from '@deepseek-ai/dsh-api-session-controller'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm/assistant-stream'
import { describe, expect, it, vi } from 'vitest'
import { createSessionRuntime } from '../src/session-runtime.js'
import type { TuiRoot } from '../src/tui-root.js'
import type { UiAction } from '../src/state.js'

const id = SessionId('working-open')
const events = [
  { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 2000, data: { turn: 1, step: 1 } },
  { type: 'tool/call', seq: 3, time: 2500, data: { turn: 1, step: 1, callId: 'settled', name: 'read', arguments: '{}' } },
  { type: 'tool/result', seq: 4, time: 2600, data: { turn: 1, step: 1,
    message: { id: 'settled-result', role: 'tool', source: { callId: 'settled' }, content: [] } } },
] as SessionEvent[]
type Page = { records: SessionEvent[]; hasMore: boolean }

async function openFixture(records: SessionEvent[], hasMore: boolean, pages: Array<Page | Error>, waiting = false, boundary: { start: number | null | undefined } = { start: 1 }) {
  const openTurnStart = boundary.start
  const cursor = Math.max(4, records.at(-1)?.seq ?? 0)
  const stream = new AssistantStreamAccumulator()
  if (!waiting) stream.push({ time: 3000, chunk: { type: 'text-delta', index: 0, text: 'already streaming' } })
  // Native wire values omit host-only turnBoundary; transport and host services are fakes.
  const opening = { type: 'snapshot', header: { id, cwd: '/fixture' }, cursor,
    records: records.map(event => ({ type: 'event', event })), hasMore,
    projections: { asOfSeq: cursor, values: {} },
    ...(openTurnStart == null ? {} : { assistantStream: { revision: 1, activeAttempt: { attemptId: 'native-attempt', startedAfterSeq: 4, turn: 1, step: 1, nextIndex: waiting ? 0 : 1, stream: stream.snapshot() } } }),
  } as unknown as SessionFollowFrame
  const once = async function* (value: unknown) { yield value }
  let finishTurn!: () => void
  const completed = new Promise<void>(resolve => { finishTurn = resolve })
  const follow = async function* () {
    yield opening
    if (openTurnStart != null) yield { type: 'event', event: { type: 'tool/call', seq: 5, time: 4000,
      data: { turn: 1, step: 1, callId: 'pending', name: 'read', arguments: '{}' } } } as unknown as SessionFollowFrame
    await completed
    yield { type: 'event', event: { type: 'turn/end', seq: 6, time: 5000,
      data: { turn: 1, reason: { kind: 'completed' } } } } as unknown as SessionFollowFrame
  }
  const scope = Object.assign(Promise.resolve(), { dispose: vi.fn(async () => {}) })
  const snapshotEvents = vi.fn(() => { throw new Error('deprecated read forbidden in this path') })
  const session = { id, header: { id, cwd: '/fixture' }, snapshotEvents }
  const agent = { id, session, status: openTurnStart == null ? 'idle' : 'running', options: { provider: 'replay' }, inbox: { nextStep: [] },
    ctx: { inject: () => scope }, cancel: vi.fn(), whenIdle: vi.fn(async () => {}) }
  const page = vi.fn(async () => {
    const next = pages.shift()
    if (next instanceof Error) throw next
    if (next === undefined) throw new Error('unexpected additional page')
    return { records: next.records.map(event => ({ type: 'event', event })), hasMore: next.hasMore }
  })
  const ctx = {
    llm: { listConfigurableProviders: () => [] }, logger: { warn: vi.fn() },
    sessions: { flush: vi.fn(async () => {}), get: () => session },
    sessionProjections: { stateOf: vi.fn((subject: unknown, key: string) => {
      expect(subject).toBe(session)
      expect(key).toBe('turnBoundary')
      return openTurnStart === undefined ? undefined : { openTurnStartSeq: openTurnStart }
    }) },
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
  return { runtime, page, snapshotEvents, ctx, root, agent, actions, finishTurn }
}

describe('working facts at the runtime opening boundary', () => {
  it.each([false, true])('opens an already-running turn through Controller records, truncated=%s', async truncated => {
    const f = await openFixture(events.slice(truncated ? 1 : 0), truncated, [{ records: [events[0]!], hasMore: false }])
    try {
      expect(f.root.bind).toHaveBeenCalledWith(f.agent)
      expect(f.ctx.sessionProjections.stateOf).toHaveBeenCalledWith(f.agent.session, 'turnBoundary')
      expect(f.runtime.root.working).toEqual({ startedAt: 1000, phase: 'Receiving text', lastChunkAt: 3000 })
      expect(f.runtime.root.working).not.toHaveProperty('phaseStartedAt')
      expect(f.runtime.initialCells.some(cell => cell.text === 'already streaming')).toBe(true)
      expect(f.snapshotEvents).not.toHaveBeenCalled()
      expect(f.ctx.logger.warn).not.toHaveBeenCalled()
      expect(f.page).toHaveBeenCalledTimes(truncated ? 1 : 0)
      expect(f.runtime.initialHasMore).toBe(false)
      if (truncated) expect(f.page).toHaveBeenCalledWith({ address: { kind: 'session', sessionId: id }, throughSeq: 4, beforeSeq: 2, maxMessages: 50 }, expect.any(AbortSignal))
      f.runtime.start()
      await vi.waitFor(() => { expect(f.runtime.root.working).toEqual({ startedAt: 1000, phase: 'Tool pending', phaseStartedAt: 4000, tail: 'read' }) })
      expect(f.actions.some(action => action.type === 'transcript-changed' && action.working?.phase === 'Tool pending')).toBe(true)
      expect(f.snapshotEvents).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('pages more than once at the opening cursor and keeps page order and the final hasMore', async () => {
    const f = await openFixture(events.slice(3), true, [
      { records: [events[2]!], hasMore: true }, { records: events.slice(0, 2), hasMore: false },
    ])
    try {
      expect(f.page).toHaveBeenCalledTimes(2)
      for (const [index, beforeSeq] of [4, 3].entries()) expect(f.page).toHaveBeenNthCalledWith(index + 1,
        { address: { kind: 'session', sessionId: id }, throughSeq: 4, beforeSeq, maxMessages: 50 }, expect.any(AbortSignal))
      expect(f.runtime.root.working).toEqual({ startedAt: 1000, phase: 'Receiving text', lastChunkAt: 3000 })
      expect(f.runtime.initialHasMore).toBe(false)
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it.each([
    ['exhausted', [{ records: [events[2]!], hasMore: false }], false],
    ['empty', [{ records: [], hasMore: true }], true],
    ['non-progressing', [{ records: [events[3]!], hasMore: true }], true],
    ['rejected', [new Error('page unavailable')], true],
  ] as const)('opens without inventing request facts when an earlier page is %s', async (_name, pages, expectedHasMore) => {
    const f = await openFixture(events.slice(3), true, [...pages] as Array<Page | Error>)
    try {
      expect(f.page).toHaveBeenCalledTimes(1)
      expect(f.runtime.initialHasMore).toBe(expectedHasMore)
      expect(f.runtime.root.working).toEqual({ phase: 'Working' })
      expect(f.runtime.initialCells.some(cell => cell.text === 'already streaming')).toBe(true)
      expect(f.root.bind).toHaveBeenCalledWith(f.agent)
      f.runtime.start()
      await vi.waitFor(() => { expect(f.actions.some(action => action.type === 'transcript-changed' && action.working?.phase === 'Working')).toBe(true) })
      expect(f.runtime.root.working).toEqual({ phase: 'Working' })
      f.finishTurn()
      await vi.waitFor(() => { expect(f.runtime.root.working).toBeUndefined() })
      expect(f.snapshotEvents).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('gives a waiting attempt found at open no request age from the attach time', async () => {
    const f = await openFixture(events, false, [], true)
    try {
      expect(f.runtime.root.working).toEqual({ startedAt: 1000, phase: 'Waiting for model' })
      expect(f.page).not.toHaveBeenCalled()
      expect(f.snapshotEvents).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('also proceeds when the opening history itself is empty', async () => {
    const f = await openFixture([], true, [{ records: [], hasMore: true }])
    try {
      expect(f.page).toHaveBeenCalledWith({ address: { kind: 'session', sessionId: id }, throughSeq: 4, beforeSeq: 5, maxMessages: 50 }, expect.any(AbortSignal))
      expect(f.runtime.root.working).toEqual({ phase: 'Working' })
      expect(f.runtime.initialHasMore).toBe(true)
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it.each([null, undefined])('opens without a row or pages when the host has no open turn: %s', async boundary => {
    const closed = [...events, { type: 'turn/end', seq: 5, time: 3500,
      data: { turn: 1, reason: { kind: 'completed' } } } as SessionEvent]
    const f = await openFixture(boundary === null ? closed : [], true, [], false, { start: boundary })
    try {
      expect(f.runtime.root.working).toBeUndefined()
      expect(f.page).not.toHaveBeenCalled()
      expect(f.root.bind).toHaveBeenCalledWith(f.agent)
      expect(f.ctx.sessionProjections.stateOf).toHaveBeenCalledWith(f.agent.session, 'turnBoundary')
      expect(f.snapshotEvents).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })
})
