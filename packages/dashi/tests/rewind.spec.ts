import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  historyInputs, inheritedTurn, rewindActionOverlay, rewindBoundaries, rewindOverlay,
} from '../src/rewind.js'
import { inputHistory, inputHistoryEvents } from './fixtures/input-history.js'

function events(): SessionEvent[] {
  return [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 2, data: {
      content: [{ type: 'text', text: 'first prompt' }], source: { kind: 'user' },
    }, surfaceOp: 'append' },
    { type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 3, time: 4, data: { turn: 2 } },
    { type: 'user/message', seq: 4, time: 5, data: {
      content: [{ type: 'text', text: 'injected' }], source: { kind: 'plugin', plugin: 'fixture', form: 'notice', summary: 'fixture' },
    }, surfaceOp: 'append' },
    { type: 'user/message', seq: 5, time: 6, data: {
      content: [{ type: 'text', text: 'second prompt' }], source: { kind: 'user' },
    }, surfaceOp: 'append' },
    { type: 'user/message', seq: 6, time: 7, data: {
      content: [{ type: 'text', text: 'steered prompt' }], source: { kind: 'user' },
    }, surfaceOp: 'append' },
    { type: 'turn/end', seq: 7, time: 8, data: { turn: 2, reason: { kind: 'completed' } } },
    { type: 'turn/start', seq: 8, time: 9, data: { turn: 3 } },
    { type: 'user/message', seq: 9, time: 10, data: {
      content: [{ type: 'text', text: 'third prompt' }], source: { kind: 'user' },
    }, surfaceOp: 'append' },
    { type: 'turn/end', seq: 10, time: 11, data: { turn: 3, reason: { kind: 'completed' } } },
  ] as SessionEvent[]
}

describe('rewind boundaries', () => {
  it('lists every human prompt against its containing-turn cut', () => {
    expect(rewindBoundaries(events())).toEqual([
      { label: 'first prompt', prompt: 'first prompt' },
      { atSeq: 2, label: 'second prompt', prompt: 'second prompt' },
      { atSeq: 2, label: 'steered prompt · mid-turn', prompt: 'steered prompt' },
      { atSeq: 7, label: 'third prompt', prompt: 'third prompt' },
    ])
    expect(historyInputs(events())).toEqual(['first prompt', 'second prompt', 'steered prompt', 'third prompt'])
    expect(inheritedTurn(events(), 8)).toBe(2)
  })

  it('folds durable prompts, recorded commands, and injected shell input once in log order', () => {
    expect(historyInputs(inputHistoryEvents)).toEqual(inputHistory)
    expect(rewindBoundaries(inputHistoryEvents)).toEqual([
      { label: 'first prompt', prompt: 'first prompt' },
      { atSeq: 2, label: '/model', prompt: '/model' },
      { atSeq: 2, label: "!printf 'ok value'", prompt: "!printf 'ok value'" },
      { atSeq: 9, label: '/permission default', prompt: '/permission default' },
    ])
  })

  it('offers code actions only when roller was present when the picker opened', () => {
    const without = rewindOverlay(events(), false)
    expect(without).toMatchObject({ cursor: 3, purpose: 'rewind', title: 'Rewind to a prompt' })
    if (without.kind !== 'list') throw new Error('expected picker')
    const withoutValue = without.options[0]?.value
    if (withoutValue?.kind !== 'rewind-boundary') throw new Error('expected boundary')
    const withoutAction = rewindActionOverlay(withoutValue)
    if (withoutAction.kind !== 'list') throw new Error('expected action picker')
    expect(withoutAction.options.map(option => option.label)).toEqual([
      'Restore conversation', 'Never mind',
    ])
    const withRoller = rewindOverlay(events(), true)
    if (withRoller.kind !== 'list') throw new Error('expected picker')
    const value = withRoller.options[0]?.value
    if (value?.kind !== 'rewind-boundary') throw new Error('expected boundary')
    const action = rewindActionOverlay(value)
    if (action.kind !== 'list') throw new Error('expected action picker')
    expect(action.title).toBe('first prompt')
    expect(action.options.map(option => option.label)).toEqual([
      'Restore code and conversation', 'Restore conversation', 'Restore code', 'Never mind',
    ])
  })
})
