import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeStorageRecord, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { foldCells, pendingShellCells } from '../src/transcript.js'

function recordedEvents(): SessionEvent[] {
  return readFileSync(new URL('./fixtures/recorded-turn.jsonl', import.meta.url), 'utf8').trim().split('\n')
    .flatMap((line, index) => index === 0 ? [] : decodeStorageRecord(JSON.parse(line)))
}

describe('foldCells', () => {
  it('folds a recorded DSH session log and skips unrelated native events', () => {
    expect(foldCells(recordedEvents())).toEqual([
      expect.objectContaining({ kind: 'user', text: 'History checkpoint 01: verify deterministic preview state.' }),
      expect.objectContaining({ kind: 'assistant', text: 'Checkpoint 01 is recorded.' }),
      expect.objectContaining({ kind: 'outcome', text: 'completed' }),
    ])
  })

  it('coalesces streamed reasoning and text, then pairs a tool result', () => {
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'assistant/chunk', seq: 1, time: 2, data: { turn: 1, step: 1, chunk: { type: 'reasoning-delta', index: 0, text: 'think' } } },
      { type: 'assistant/chunk', seq: 2, time: 3, data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 1, text: 'answer' } } },
      { type: 'assistant/message', seq: 3, time: 4, surfaceOp: 'append', data: {
        turn: 1, step: 1, message: { id: 'a1', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' }, content: [
          { type: 'reasoning', text: 'think' }, { type: 'text', text: 'answer' },
        ] },
      } },
      { type: 'tool/call', seq: 4, time: 5, data: { turn: 1, step: 1, callId: 'call-1', name: 'inspect', arguments: '{"path":"a"}' } },
      { type: 'tool/result', seq: 5, time: 6, surfaceOp: 'append', data: {
        turn: 1, step: 1, message: { id: 'r1', role: 'user', source: { kind: 'tool', callId: 'call-1' }, content: [
          { type: 'tool-result', toolCallId: 'call-1', content: [{ type: 'text', text: 'ok' }] },
        ] },
      } },
      { type: 'turn/end', seq: 6, time: 7, data: { turn: 1, reason: { kind: 'completed' } } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events)).toEqual([
      expect.objectContaining({ collapsed: true, kind: 'reasoning', text: 'think' }),
      expect.objectContaining({ kind: 'assistant', text: 'answer' }),
      expect.objectContaining({
        kind: 'tool', pending: false, text: 'inspect',
        tool: { body: 'ok', card: 'generic', title: 'inspect' },
      }),
      expect.objectContaining({ kind: 'outcome', text: 'completed' }),
    ])
  })

  it('renders structural errors and ignores unknown plugin events without throwing', () => {
    const events = [
      { type: 'plugin/new-fact', seq: 0, time: 1, data: {}, ignorable: false },
      { type: 'tool/result', seq: 1, time: 2, data: { message: { source: { callId: 'missing' }, content: [{ content: [] }] } } },
      { type: 'turn/end', seq: 2, time: 3, data: { turn: 9, reason: { kind: 'completed' } } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events).map(cell => cell.text)).toEqual([
      'tool result missing has no matching call',
      'turn 9 ended without starting',
    ])
  })

  it('accepts a message-aligned truncated prefix while retaining later structural errors', () => {
    const events = [
      { type: 'tool/result', seq: 40, time: 1, data: { message: { source: { callId: 'earlier' }, content: [{ content: [] }] } } },
      { type: 'turn/end', seq: 41, time: 2, data: { turn: 8, reason: { kind: 'completed' } } },
      { type: 'turn/end', seq: 42, time: 3, data: { turn: 9, reason: { kind: 'completed' } } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events, undefined, { truncatedStart: true }).map(cell => cell.text)).toEqual([
      'turn 9 ended without starting',
    ])
  })

  it('marks assistant deltas pending until the durable completed message arrives', () => {
    const events = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
      { type: 'assistant/chunk', seq: 1, time: 2, data: {
        turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'partial' },
      } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events)[0]).toMatchObject({ kind: 'assistant', pending: true, text: 'partial' })
    const complete = [...events, { type: 'assistant/message', seq: 2, time: 3, surfaceOp: 'append', data: {
      turn: 1, step: 1, message: {
        id: 'a', role: 'assistant', source: { kind: 'model', provider: 'p', model: 'm' },
        content: [{ type: 'text', text: 'complete' }],
      },
    } }] as unknown as SessionEvent[]
    expect(foldCells(complete)[0]).toEqual(expect.not.objectContaining({ pending: true }))
  })

  it('pairs native command lifecycle records into one command cell', () => {
    const events = [
      { type: 'command/run', seq: 0, time: 1, data: {
        commandId: 'cmd-1', name: 'compact', source: { kind: 'user' },
      } },
      { type: 'command/done', seq: 1, time: 2, data: {
        commandId: 'cmd-1', kind: 'success', text: 'No compactable history yet.',
      } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events)).toEqual([expect.objectContaining({
      elapsedMs: 1, kind: 'command', pending: false, startedAt: 1,
      text: '/compact\nNo compactable history yet.',
    })])
  })

  it.each(['fork', 'rewind'])('drops an inherited pending /%s run at the seed boundary', (name) => {
    const events = [
      { type: 'command/run', seq: 7, time: 8, data: {
        commandId: `cmd-${name}`, name, source: { kind: 'user' },
      } },
      { type: 'session/end-seed', seq: 8, time: 9, data: {} },
    ] as unknown as SessionEvent[]
    expect(foldCells(events)).toEqual([])
  })

  it('renders dashi shell notices from pending inbox and durable history', () => {
    const message = createUserMessage({
      content: [{ type: 'text', text: '$ echo ok\n[stdout]\nok\n[exit 0]' }],
      source: { form: 'notice', kind: 'plugin', plugin: 'dashi', summary: 'Shell: echo ok' },
    })
    expect(pendingShellCells([message])).toEqual([expect.objectContaining({
      kind: 'shell', pending: true, text: expect.stringContaining('$ echo ok'),
    })])
    const events = [{
      type: 'user/message', seq: 4, time: 5, surfaceOp: 'append', data: message,
    }] as unknown as SessionEvent[]
    expect(foldCells(events)).toEqual([expect.objectContaining({
      kind: 'shell', pending: false, text: expect.stringContaining('[stdout]\nok'),
    })])
  })

  it('collapses earlier plan and todo revisions', () => {
    const events = [
      { type: 'tool/call', seq: 0, time: 1, data: {
        turn: 1, step: 1, callId: 'plan-1', name: 'exit_plan_mode', arguments: '{"plan":"# First\\nold"}',
      } },
      { type: 'tool/call', seq: 1, time: 2, data: {
        turn: 1, step: 2, callId: 'plan-2', name: 'exit_plan_mode', arguments: '{"plan":"# Revised\\ncurrent"}',
      } },
      { type: 'todo/write', seq: 2, time: 3, data: { todos: [{ content: 'old', status: 'pending' }] } },
      { type: 'todo/write', seq: 3, time: 4, data: { todos: [{ content: 'ship', status: 'completed' }] } },
    ] as unknown as SessionEvent[]
    const cells = foldCells(events)
    expect(cells.filter(cell => cell.kind === 'tool')).toEqual([
      expect.objectContaining({ collapsed: true }),
      expect.not.objectContaining({ collapsed: true }),
    ])
    expect(cells.filter(cell => cell.kind === 'todo')).toEqual([
      expect.objectContaining({ collapsed: true, text: 'Todos · previous revision' }),
      expect.objectContaining({ text: 'Todos\n✓ ship' }),
    ])
  })

  it('collapses the current todo list when the next turn starts', () => {
    const events = [
      { type: 'turn/start', seq: 0, time: 0, data: { turn: 1 } },
      { type: 'todo/write', seq: 1, time: 1, data: {
        todos: [{ content: 'ship', status: 'in_progress' }],
      } },
      { type: 'turn/end', seq: 2, time: 2, data: { turn: 1, reason: { kind: 'completed' } } },
      { type: 'turn/start', seq: 3, time: 3, data: { turn: 2 } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events)).toContainEqual(expect.objectContaining({
      collapsed: true, kind: 'todo', text: 'Todos · previous revision',
    }))
  })

  it('renders automatic compaction once and folds manual compaction into its command', () => {
    const summary = (id: string, sourceCommandId?: string) => ({
      type: 'compaction/summary', time: 1, data: {
        compactionId: id, model: 'm', provider: 'p', shadowedRange: { start: 0, end: 1 },
        shadowedSeqs: [0, 1], shadowedTokenCount: 42, summary: [{ type: 'text', text: 'short' }],
        ...(sourceCommandId === undefined ? {} : { sourceCommandId }),
      },
    })
    const checkpoint = (seq: number, id: string, sourceCommandId?: string) => ({
      type: 'user/message', seq, time: seq, surfaceOp: { op: 'replace', start: 0, end: 1 }, data: {
        content: [{ type: 'text', text: 'summary' }], id: `m-${String(seq)}`, role: 'user',
        source: { kind: 'plugin', plugin: 'compact', compactionId: id,
          ...(sourceCommandId === undefined ? {} : { sourceCommandId }) },
      },
    })
    const events = [
      { ...summary('auto'), seq: 0 }, checkpoint(1, 'auto'),
      { type: 'command/run', seq: 2, time: 2, data: { commandId: 'cmd', name: 'compact', source: { kind: 'user' } } },
      { ...summary('manual', 'cmd'), seq: 3 }, checkpoint(4, 'manual', 'cmd'),
      { type: 'command/done', seq: 5, time: 5, data: { commandId: 'cmd', kind: 'success' } },
    ] as unknown as SessionEvent[]
    expect(foldCells(events)).toEqual([
      expect.objectContaining({ kind: 'compaction', text: 'Compacted 2 items · 42 tokens' }),
      expect.objectContaining({ kind: 'command', pending: false, text: '/compact\nCompacted 2 items · 42 tokens' }),
    ])
  })
})
