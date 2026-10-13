import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { turnWorking, type WorkingStream } from '../src/turn-working.js'
import { recordedEvents } from './fixtures/session-format.js'

const event = (type: string, data: unknown, seq: number, time = seq * 1000): SessionEvent => ({ type, data, seq, time }) as SessionEvent
const start = event('turn/start', { turn: 1 }, 1)
const step = event('step/start', { turn: 1, step: 1 }, 2)
const stream = (chunk?: StreamChunk, changes: Partial<WorkingStream> = {}): WorkingStream => ({
  attemptId: 'opaque-never-parsed:900', startedAfterSeq: 2, turn: 1, step: 1, observedAt: 2500,
  ...(chunk === undefined ? {} : { lastChunk: { time: 3000, chunk } }), ...changes,
})
const call = (id: string, name = 'bash', seq = 3) => event('tool/call', { turn: 1, step: 1, callId: id, name, arguments: '{}' }, seq)
const result = (id: string, seq = 5) => event('tool/result', { turn: 1, step: 1,
  message: { id: `result-${id}`, role: 'tool', source: { callId: id }, content: [] } }, seq)
const retry = (type = 'llm/retry', number: unknown = 2, changes = {}) => event(type,
  { turn: 1, step: 1, retry: number, delayMs: 500, failure: { code: 'TIMEOUT' }, ...changes }, 7)

describe('native turn working facts', () => {
  it('shows only a native open turn and clears at its end without agent status', () => {
    expect(turnWorking([])).toBeUndefined()
    expect(turnWorking([step, call('a')])).toBeUndefined()
    expect(turnWorking([start])).toEqual({ startedAt: 1000, phase: 'Working' })
    expect(turnWorking([start, step], stream())).toEqual({ startedAt: 1000, phase: 'Waiting for model', phaseStartedAt: 2500 })
    expect(turnWorking([start, step, event('turn/end', { turn: 1, reason: { kind: 'completed' } }, 9)], stream())).toBeUndefined()
  })

  it('does not use an inherited header, submit/steer time, or attach time as request age', () => {
    const events = [event('request/header', { header: {} }, 0, 1), start, step,
      event('agent/inbox/spliced', { inserted: [] }, 4), event('command/run', { commandId: 'other' }, 5)]
    const { observedAt: _observed, ...attached } = stream()
    expect(turnWorking(events, attached)).toEqual({ startedAt: 1000, phase: 'Waiting for model' })
    expect(turnWorking(events, stream())?.phaseStartedAt).toBe(2500)
    expect(turnWorking(events, stream())?.startedAt).toBe(1000)
  })

  it.each([
    [{ type: 'reasoning-delta', index: 0, text: 'known' }, 'Reasoning'],
    [{ type: 'text-delta', index: 1, text: 'known' }, 'Receiving text'],
    [{ type: 'block-start', index: 0, blockType: 'reasoning' }, 'Reasoning'],
    [{ type: 'block-end', index: 1, block: { type: 'text', text: 'done' } }, 'Receiving text'],
    [{ type: 'tool-call-delta', index: 2, id: 'tool', name: 'read', argumentsDelta: '{}' }, 'Tool request'],
    [{ type: 'block-end', index: 2, block: { type: 'tool-call', id: 'tool', name: 'read', arguments: '{}' } }, 'Tool request'],
    [{ type: 'usage', usage: { inputTokens: 10, outputTokens: 2 } }, 'Working'],
    [{ type: 'finish', reason: { kind: 'stop' } }, 'Working'],
    [{ type: 'unknown-provider-event', text: 'Thinking' }, 'Working'],
  ])('uses the native latest chunk type, not text, for %j', (chunk, phase) => {
    const view = turnWorking([start, step], stream(chunk as StreamChunk))
    expect(view?.phase).toBe(phase)
    expect(view?.lastChunkAt).toBe(3000)
    expect(view?.phaseStartedAt).toBeUndefined()
    expect(view).not.toHaveProperty('tokens')
    expect(view?.tail).toBe(phase === 'Tool request' ? 'read' : undefined)
  })

  it('pairs native calls/results, includes parallel count and keeps the name, not arguments', () => {
    const calls = [start, step, call('a'), call('b', 'write', 4)]
    expect(turnWorking(calls)).toEqual({ startedAt: 1000, phase: 'Tool pending', phaseStartedAt: 3000, tail: '2 calls · bash' })
    expect(turnWorking([...calls, result('a')])?.tail).toBe('write')
    expect(turnWorking([...calls, result('a'), result('b', 6)])?.phase).toBe('Working')
    expect(turnWorking([start, step, result('unknown')])?.phase).toBe('Working')
    expect(turnWorking([start, step, event('tool/call', { turn: 2, step: 1, callId: 'other', name: 'other' }, 3)])?.phase).toBe('Working')
  })

  it('shows the native retry number, never a settlement count, opaque id or inferred resend', () => {
    const failed = event('assistant/attempt', { turn: 1, step: 1, stream: [] }, 6)
    expect(turnWorking([start, step, failed])).toEqual({ startedAt: 1000, phase: 'Working' })
    expect(turnWorking([start, step, failed, retry()])).toEqual({ startedAt: 1000, phase: 'Retry wait', phaseStartedAt: 7000, tail: 'retry 2' })
    expect(turnWorking([start, step, retry('llm/retry-started')])?.phase).toBe('Retrying')
    expect(turnWorking([start, step, retry()], stream({ type: 'text-delta', text: 'old', index: 0 }))?.phase).toBe('Retry wait')
    expect(turnWorking([start, step, retry()], stream(undefined, { startedAfterSeq: 7, observedAt: 8000 })))
      .toEqual({ startedAt: 1000, phase: 'Waiting for model', phaseStartedAt: 8000, tail: 'retry 2' })
    expect(turnWorking([start, step, failed], stream())?.phase).toBe('Working')
  })

  it.each([0, -1, NaN, Infinity, 1.5, '2', 9007199254740992])('refuses an invalid retry number %s', value => {
    expect(turnWorking([start, step, retry('llm/retry', value)])).toEqual({ startedAt: 1000, phase: 'Working' })
  })

  it('ignores other source/turn/step records and resets only at a native boundary', () => {
    for (const record of [retry('plugin/retry'), retry('llm/retry', 2, { turn: 9 }), retry('llm/retry', 2, { step: 9 })]) {
      expect(turnWorking([start, step, record])?.phase).toBe('Working')
    }
    expect(turnWorking([start, step], stream(undefined, { turn: 9 }))?.phase).toBe('Working')
    expect(turnWorking([start, step], stream(undefined, { step: 9 }))?.phase).toBe('Working')
    const next = event('step/start', { turn: 1, step: 2 }, 10)
    expect(turnWorking([start, step, retry(), call('old'), next], stream())?.phase).toBe('Working')
    expect(turnWorking([start, step, retry(), event('turn/start', { turn: 2 }, 10)]))
      .toEqual({ startedAt: 10000, phase: 'Working' })
  })

  it('reads recorded native turn boundaries without restarting a completed turn', () => {
    const events = recordedEvents(new URL('./fixtures/live-activity-session.jsonl', import.meta.url))
    const opening = events.findIndex(value => value.type === 'turn/start')
    expect(opening).toBeGreaterThan(0)
    expect(turnWorking(events.slice(0, opening + 1))?.startedAt).toBe(events[opening]?.time)
    expect(turnWorking(events)).toBeUndefined()
  })
})
