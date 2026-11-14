import type { Context } from '@deepseek-ai/cordis'
import type { SessionControlFrame, SessionFollowFrame, SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import type { CommandDefinition, CommandInvocation } from '@deepseek-ai/dsh-commands'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { AssistantStreamAccumulator } from '@deepseek-ai/dsh-llm/assistant-stream'
import { describe, expect, it, vi } from 'vitest'
import { createSessionRuntime, type DecisionBindings } from '../src/session-runtime.js'
import type { TuiRoot } from '../src/tui-root.js'
import type { PendingDecision, UiAction } from '../src/state.js'

const id = SessionId('working-open')
const events = [
  { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
  { type: 'step/start', seq: 2, time: 2000, data: { turn: 1, step: 1 } },
  { type: 'tool/call', seq: 3, time: 2500, data: { turn: 1, step: 1, callId: 'settled', name: 'read', arguments: '{}' } },
  { type: 'tool/result', seq: 4, time: 2600, data: { turn: 1, step: 1,
    message: { id: 'settled-result', role: 'tool', source: { callId: 'settled' }, content: [] } } },
] as SessionEvent[]
type Page = { records: SessionEvent[]; hasMore: boolean }

async function openFixture(records: SessionEvent[], hasMore: boolean, pages: Array<Page | Error>, waiting = false, boundary: { start: number | null | undefined } = { start: 1 }, options: {
  control?: SessionControlFrame[]; decisions?: DecisionBindings; diagnostics?: () => { count: number; lines: string[] }
  continuation?: { items: SessionSummary[]; archived: string[] }
} = {}) {
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
  const definitions = new Map<string, CommandDefinition>()
  const listeners = new Map<string, (...args: any[]) => any>()
  const snapshotEvents = vi.fn(() => { throw new Error('deprecated read forbidden in this path') })
  const session = { id, header: { id, cwd: '/fixture', ...(options.continuation === undefined ? {} : { isSeeded: true }) }, snapshotEvents }
  const agent = { id, session, status: openTurnStart == null ? 'idle' : 'running', options: { provider: 'replay' }, inbox: { nextStep: [] },
    ctx: { inject: (_services: string[], apply: (ctx: unknown) => void) => {
      apply({ commands: { register: (definition: CommandDefinition) => { definitions.set(definition.name, definition) } } })
      return scope
    } }, cancel: vi.fn(), whenIdle: vi.fn(async () => {}) }
  const page = vi.fn(async () => {
    const next = pages.shift()
    if (next instanceof Error) throw next
    if (next === undefined) throw new Error('unexpected additional page')
    return { records: next.records.map(event => ({ type: 'event', event })), hasMore: next.hasMore }
  })
  const ctx = {
    llm: { listConfigurableProviders: () => [] }, logger: { warn: vi.fn() },
    sessions: { flush: vi.fn(async () => {}), get: () => session },
    agents: { turnBoundaryOf: vi.fn((subject: unknown) => {
      expect(subject).toBe(session)
      return { openTurnStartSeq: openTurnStart ?? null }
    }), withInitiator: vi.fn(async (_agent: unknown, operation: () => unknown) => operation()) },
    tools: { execute: vi.fn() },
    workspaceRegistry: { archivedSessionIds: options.continuation?.archived ?? [], archiveSession: vi.fn(async () => {}) },
    sessionController: { resolveAgent: vi.fn(async () => ({ agent })), follow, events: page, fork: vi.fn(),
      control: async function* () {
        yield { type: 'baseline', value: { projections: {} } }
        for (const frame of options.control ?? []) yield frame
      }, list: vi.fn(async () => ({ items: options.continuation?.items ?? [] })), rename: vi.fn(async () => ({})) },
    jobController: { list: () => once({ jobs: [] }) },
    get: (name: string) => name === 'subagents' ? {} : undefined,
    sessionQuery: { observeSession: vi.fn(async () => ({ events: records, projections: { values: { subagentCatalog: [] } }, [Symbol.dispose]() {} })) },
    sessionProjections: { snapshot: () => ({ values: {} }) },
    fs: { resolve: vi.fn(async (path: string) => path), contains: vi.fn(() => true), writeText: vi.fn(async () => {}), processPath: (path: string) => path },
    sandboxPolicy: { resolve: () => ({}) },
    permissionPresets: { current: () => 'workspace-write' },
    commands: { find: () => ({ name: 'permission', handler: () => ({ kind: 'success' }) }), execute: vi.fn() },
    on: (name: string, listener: (...args: any[]) => any) => { listeners.set(name, listener); return () => {} },
  } as unknown as Context
  const root = { bind: vi.fn(), clear: vi.fn() } as unknown as TuiRoot
  const actions: UiAction[] = []
  const runtime = await createSessionRuntime(ctx, { cwd: '/fixture', ...(options.continuation === undefined ? { resume: id } : {}),
    continue: options.continuation !== undefined, forkSession: false }, root, action => { actions.push(action) }, options.decisions, options.diagnostics)
  const command = (name: string, rawInput = '', signal = new AbortController().signal) => definitions.get(name)!.handler({ agent, rawInput,
    commandId: 'native-command', signal } as unknown as CommandInvocation)
  return { runtime, page, snapshotEvents, ctx, root, agent, actions, finishTurn, command, listeners }
}

async function asideFixture() {
  const inherited = [{ type: 'turn/end', seq: 1, time: 1000,
    data: { turn: 1, reason: { kind: 'completed' } } }] as SessionEvent[]
  const f = await openFixture(inherited, false, [], false, { start: null })
  f.snapshotEvents.mockImplementation(() => inherited as never)
  const child = { id: SessionId('native-side'), cancel: vi.fn(), whenIdle: vi.fn(async () => {}), steer: vi.fn(),
    session: { seq: 1, inheritedEventCount: 1, snapshotEvents: () => inherited } }
  const iterator = { next: vi.fn(async () => ({ done: false, value: { type: 'snapshot' } } as unknown)),
    return: vi.fn(async () => ({ done: true })) }
  iterator.next.mockResolvedValueOnce({ done: false, value: { type: 'snapshot' } })
    .mockResolvedValueOnce({ done: false, value: { type: 'event', event: inherited[0] } })
  vi.mocked(f.ctx.sessionController.fork).mockResolvedValueOnce({ sessionId: child.id } as never)
  vi.mocked(f.ctx.sessionController.resolveAgent).mockResolvedValueOnce({ agent: child } as never)
  f.ctx.sessionController.follow = vi.fn(() => ({ [Symbol.asyncIterator]: () => iterator })) as never
  return { ...f, child, iterator }
}

describe('working facts at the runtime opening boundary', () => {
  it('continues the ordinary seeded child rather than a newer archived side session', async () => {
    const row = (sessionId: string, updatedAt: number): SessionSummary => ({ sessionId: SessionId(sessionId), updatedAt,
      cwd: '/fixture', agentAvailable: true, blank: false, running: false })
    const f = await openFixture([], false, [], false, { start: null }, { continuation: {
      items: [row('archived-side', 10), row(id, 9), row('older-root', 1)], archived: ['archived-side'],
    } })
    try {
      expect(f.runtime.root.id).toBe(id)
      expect(f.ctx.sessionController.resolveAgent).toHaveBeenCalledExactlyOnceWith(id)
      await f.runtime.activate({ kind: 'open-resume' })
      expect(JSON.stringify(f.actions.at(-1))).not.toContain('archived-side')
      expect(JSON.stringify(f.actions.at(-1))).toContain(id)
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('does not create a fresh root when every continuation candidate is archived', async () => {
    await expect(openFixture([], false, [], false, { start: null }, { continuation: {
      items: [{ sessionId: id, updatedAt: 10, cwd: '/fixture', agentAvailable: true,
        blank: false, running: false }], archived: [id],
    } })).rejects.toThrow('no resumable DSH session in /fixture')
  })

  it.each(['btw', 'recap'])('archives /%s only after showing the answer and native idle', async name => {
    const f = await asideFixture()
    let idle!: () => void
    f.child.whenIdle.mockImplementationOnce(() => new Promise<void>(resolve => { idle = resolve }))
    const command = f.command(name, name === 'btw' ? 'side question' : '')
    try {
      await vi.waitFor(() => {
        expect(f.actions.at(-1)).toMatchObject({ type: 'open-overlay', overlay: { title: 'Btw · turn 1' } })
        expect(f.child.whenIdle).toHaveBeenCalledOnce()
      })
      expect(f.ctx.workspaceRegistry.archiveSession).not.toHaveBeenCalled()
      idle()
      await expect(command).resolves.toEqual({ kind: 'success' })
      expect(f.ctx.workspaceRegistry.archiveSession).toHaveBeenCalledExactlyOnceWith(f.child.id)
      expect(f.child.cancel).not.toHaveBeenCalled()
    } finally { idle?.(); await command; f.finishTurn(); await f.runtime.shutdown() }
  })

  it('reports default archival refusal without pretending the side is hidden', async () => {
    const f = await asideFixture()
    vi.mocked(f.ctx.workspaceRegistry.archiveSession).mockRejectedValueOnce(new Error('native activity remains'))
    try {
      await expect(f.command('btw', 'side question')).rejects.toThrow('answer shown; side session not archived: native activity remains')
      expect(f.actions.at(-1)).toMatchObject({ type: 'open-overlay', overlay: { title: 'Btw · turn 1' } })
      expect(f.ctx.workspaceRegistry.archiveSession).toHaveBeenCalledExactlyOnceWith(f.child.id)
      expect(f.child.cancel).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it.each([[true, true], [true, false], [false, true], [false, false]])(
    'preserves primary failure=%s with archive failure=%s', async (primaryFails, archiveFails) => {
      const f = await asideFixture(), primary = new Error('native request failed')
      if (primaryFails) f.iterator.next.mockReset()
        .mockResolvedValueOnce({ done: false, value: { type: 'snapshot' } }).mockRejectedValueOnce(primary)
      if (archiveFails) vi.mocked(f.ctx.workspaceRegistry.archiveSession).mockRejectedValueOnce(new Error('native archive refused'))
      try {
        const command = f.command('btw', 'error ordering')
        if (primaryFails && archiveFails) await expect(command).rejects.toMatchObject({
          message: 'native request failed\nanswer shown; side session not archived: native archive refused', cause: primary,
        })
        else if (primaryFails) await expect(command).rejects.toBe(primary)
        else if (archiveFails) await expect(command).rejects.toThrow('answer shown; side session not archived: native archive refused')
        else await expect(command).resolves.toEqual({ kind: 'success' })
        expect(f.ctx.workspaceRegistry.archiveSession).toHaveBeenCalledExactlyOnceWith(f.child.id)
        expect(f.child.whenIdle).toHaveBeenCalledOnce()
        expect(f.actions.some(action => action.type === 'open-overlay')).toBe(!primaryFails)
      } finally { f.finishTurn(); await f.runtime.shutdown() }
    },
  )

  it('cancels the side once on invocation abort, then waits for idle and archives by default', async () => {
    const f = await asideFixture()
    const abort = new AbortController(), order: string[] = []
    f.iterator.next.mockReset().mockImplementationOnce(async () => ({ done: false, value: { type: 'snapshot' } }))
      .mockImplementationOnce(async () => { abort.abort(new Error('UI aborted')); throw abort.signal.reason })
    f.child.cancel.mockImplementationOnce(() => { order.push('cancel') })
    f.child.whenIdle.mockImplementationOnce(async () => { order.push('idle') })
    vi.mocked(f.ctx.workspaceRegistry.archiveSession).mockImplementationOnce(async () => { order.push('archive') })
    try {
      await expect(f.command('btw', 'cancelled side', abort.signal)).rejects.toThrow('UI aborted')
      expect(f.child.cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' })
      expect(order).toEqual(['cancel', 'idle', 'archive'])
      expect(f.ctx.workspaceRegistry.archiveSession).toHaveBeenCalledExactlyOnceWith(f.child.id)
      expect(f.actions.some(action => action.type === 'open-overlay')).toBe(false)
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })
  it.each(['refused', 'failed'] as const)('does not fork when the source journal restore is %s', async outcome => {
    const f = await openFixture([], false, [], false, { start: null })
    try {
      const message = 'native source journal unavailable'
      if (outcome === 'refused') vi.mocked(f.ctx.commands.execute).mockResolvedValueOnce({ result: { kind: 'error', text: message } } as never)
      else vi.mocked(f.ctx.commands.execute).mockRejectedValueOnce(new Error(message))
      await f.runtime.activate({ kind: 'rewind', mode: 'both', atSeq: 7, prompt: 'second prompt' })
      expect(f.ctx.commands.execute).toHaveBeenCalledExactlyOnceWith(f.agent, '/roller-restore 7', [], expect.any(AbortSignal))
      expect(f.ctx.sessionController.fork).not.toHaveBeenCalled()
      expect(f.actions.at(-1)).toEqual({ type: 'runtime-error', rootId: id, message })
      expect(f.root.bind).toHaveBeenCalledTimes(1)
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it.each(['code', 'both'] as const)('uses the same source boundary for %s and reports a post-restore fork failure', async mode => {
    const f = await openFixture([], false, [], false, { start: null })
    let release!: () => void
    const restored = new Promise<void>(resolve => { release = resolve })
    vi.mocked(f.ctx.commands.execute).mockImplementationOnce(async () => {
      await restored
      return { result: { kind: 'success' } } as never
    })
    vi.mocked(f.ctx.sessionController.fork).mockRejectedValueOnce(new Error('native fork refused'))
    const activation = f.runtime.activate({ kind: 'rewind', mode, atSeq: 7, prompt: 'second prompt' })
    try {
      await vi.waitFor(() => { expect(f.ctx.commands.execute).toHaveBeenCalledOnce() })
      expect(f.ctx.sessionController.fork).not.toHaveBeenCalled()
      release()
      await activation
      expect(f.ctx.commands.execute).toHaveBeenCalledExactlyOnceWith(f.agent, '/roller-restore 7', [], expect.any(AbortSignal))
      if (mode === 'both') {
        expect(f.ctx.sessionController.fork).toHaveBeenCalledExactlyOnceWith({ atSeq: 7, sessionId: id, allowMigration: false })
        expect(vi.mocked(f.ctx.commands.execute).mock.invocationCallOrder[0])
          .toBeLessThan(vi.mocked(f.ctx.sessionController.fork).mock.invocationCallOrder[0]!)
        expect(f.actions.at(-1)).toEqual({ type: 'runtime-error', rootId: id,
          message: 'files restored, conversation not rewound: native fork refused' })
      } else expect(f.ctx.sessionController.fork).not.toHaveBeenCalled()
      expect(f.runtime.root.id).toBe(id)
      expect(f.root.bind).toHaveBeenCalledTimes(1)
    } finally { release(); await activation; f.finishTurn(); await f.runtime.shutdown() }
  })

  it('starts /subtask through one native tool batch and selects only its matching result', async () => {
    const f = await openFixture(events, false, [])
    try {
      const callId = ToolCallId('native-command:subtask')
      vi.mocked(f.ctx.tools.execute).mockResolvedValueOnce({ results: [
        { callId: ToolCallId('unrelated'), result: { isError: false, value: { kind: 'activation', name: 'foreign' } } },
        { callId, result: { isError: false, value: { kind: 'activation', name: 'native-child' } } },
      ], additionalContexts: [], concluded: false } as never)
      await expect(f.command('subtask', 'investigate\n  parser')).resolves.toEqual({ kind: 'success', text: 'subtask native-child started' })
      expect(f.ctx.agents.withInitiator).toHaveBeenCalledExactlyOnceWith(f.agent, expect.any(Function))
      expect(f.ctx.tools.execute).toHaveBeenCalledExactlyOnceWith({ agent: f.agent, signal: expect.any(AbortSignal), calls: [{
        type: 'tool-call', name: 'subagent', id: callId,
        arguments: JSON.stringify({ description: 'investigate parser', prompt: 'investigate\n  parser' }),
      }] })
      vi.mocked(f.ctx.tools.execute).mockResolvedValueOnce({ results: [], additionalContexts: [], concluded: false } as never)
      await expect(f.command('subtask', 'missing result')).rejects.toThrow('DSH subtask batch returned no matching result')
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('consumes every projection change in each native control frame without treating absence as deletion', async () => {
    const f = await openFixture(events, false, [], true, { start: 1 }, { control: [
      { type: 'projection', sessionId: id, seq: 5, changes: [
        { key: 'unrelated', val: null },
        { key: 'contextPressure', val: { projectedTokens: 42, contextWindow: 100 } },
        { key: 'subagentCatalog', val: [] },
      ] },
      { type: 'projection', sessionId: SessionId('foreign'), seq: 6, changes: [{ key: 'contextPressure', val: null }] },
      { type: 'projection', sessionId: id, seq: 7, changes: [{ key: 'title', val: 'native title' }] },
    ] as SessionControlFrame[] })
    try {
      f.runtime.start()
      await vi.waitFor(() => { expect(f.runtime.root.contextPercent).toBe(42) })
      await vi.waitFor(() => { expect(f.ctx.sessionController.list).toHaveBeenCalledTimes(2) })
      expect(f.actions.filter(action => action.type === 'root-presentation' && 'contextPercent' in action))
        .toEqual([{ type: 'root-presentation', contextPercent: 42, rootId: id }])
      expect(f.ctx.logger.warn).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('clears context occupancy only when this root publishes a null value for that key', async () => {
    const f = await openFixture(events, false, [], true, { start: 1 }, { control: [
      { type: 'projection', sessionId: id, seq: 5, changes: [{ key: 'contextPressure', val: { projectedTokens: 42, contextWindow: 100 } }] },
      { type: 'projection', sessionId: id, seq: 6, changes: [{ key: 'contextPressure', val: null }] },
    ] as SessionControlFrame[] })
    try {
      f.runtime.start()
      await vi.waitFor(() => {
        expect(f.actions.filter(action => action.type === 'root-presentation' && 'contextPercent' in action))
          .toEqual([{ type: 'root-presentation', contextPercent: 42, rootId: id },
            { type: 'root-presentation', contextPercent: null, rootId: id }])
      })
      expect(f.runtime.root).not.toHaveProperty('contextPercent')
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it.each([false, true])('exports from a native observation lease and releases it even when writing fails: %s', async failed => {
    const f = await openFixture(events, false, [])
    const dispose = vi.fn(), error = new Error('native filesystem refused export')
    try {
      vi.mocked(f.ctx.sessionQuery.observeSession).mockResolvedValueOnce({ events: [{ type: 'user/message', seq: 1, time: 1000,
        data: { id: 'export-user', role: 'user', source: { kind: 'human' }, content: [{ type: 'text', text: 'native export history' }] },
      }], [Symbol.dispose]: dispose } as never)
      if (failed) vi.mocked(f.ctx.fs.writeText).mockRejectedValueOnce(error)
      if (failed) await expect(f.command('export', 'out.md')).rejects.toBe(error)
      else await expect(f.command('export', 'out.md')).resolves.toEqual({ kind: 'success', text: 'exported out.md' })
      expect(f.ctx.sessionQuery.observeSession).toHaveBeenLastCalledWith(id, { signal: expect.any(AbortSignal), projectionMode: 'none' })
      expect(f.ctx.fs.writeText).toHaveBeenCalledWith('out.md', expect.stringContaining('native export history'), undefined, expect.any(AbortSignal), {})
      expect(dispose).toHaveBeenCalledOnce()
      expect(f.snapshotEvents).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('keeps native fixed approval actions fixed while preserving ordinary custom answers', async () => {
    const request = vi.fn(async (_decision: PendingDecision) => ({ answers: [{ id: 'approval', selected: ['Allow'] }] }))
    const f = await openFixture(events, false, [], false, { start: 1 }, { decisions: { request, cancel: vi.fn() } })
    try {
      const intent = { kind: 'approval', approve: 'Allow', reject: 'Deny', always: 'Always' } as const
      await f.listeners.get('user-questions/request')!({ agent: f.agent, signal: new AbortController().signal, questions: [
        { id: 'approval', question: 'Approve?', options: [{ label: 'Allow' }, { label: 'Deny' }, { label: 'Always' }], intent },
        { id: 'ordinary', question: 'Choose', options: [{ label: 'One' }] },
      ] }, vi.fn())
      const decision = request.mock.calls[0]?.[0] as unknown as { questions: Record<string, unknown>[] }
      expect(decision.questions[0]).toEqual({ id: 'approval', question: 'Approve?', multiSelect: false,
        options: [{ label: 'Allow' }, { label: 'Deny' }, { label: 'Always' }], intent, allowCustom: false })
      expect(decision.questions[1]).not.toHaveProperty('allowCustom')
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it('makes the owned diagnostic tail visible through the existing Status command', async () => {
    const f = await openFixture(events, false, [], false, { start: 1 }, { diagnostics: () => ({ count: 300, lines: ['[warn] captured native diagnostic'] }) })
    try {
      await f.command('status')
      expect(f.actions.at(-1)).toMatchObject({ type: 'open-overlay', overlay: { kind: 'info', title: 'Status', lines: expect.arrayContaining([
        '300 diagnostics captured (showing last 1; at most 200 lines, 4096 characters each)', '[warn] captured native diagnostic',
      ]) } })
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })

  it.each([false, true])('opens an already-running turn through Controller records, truncated=%s', async truncated => {
    const f = await openFixture(events.slice(truncated ? 1 : 0), truncated, [{ records: [events[0]!], hasMore: false }])
    try {
      expect(f.root.bind).toHaveBeenCalledWith(f.agent)
      expect(f.ctx.agents.turnBoundaryOf).toHaveBeenCalledWith(f.agent.session)
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
      expect(f.ctx.agents.turnBoundaryOf).toHaveBeenCalledWith(f.agent.session)
      expect(f.snapshotEvents).not.toHaveBeenCalled()
    } finally { f.finishTurn(); await f.runtime.shutdown() }
  })
})
