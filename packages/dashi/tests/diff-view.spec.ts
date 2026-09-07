import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { decodeStorageRecord, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { diffOverlay } from '../src/diff-view.js'
import { createToolPresenter } from '../src/tool-presentation.js'

const events = readFileSync(new URL('./fixtures/open-turn-session.jsonl', import.meta.url), 'utf8').trim().split('\n')
  .flatMap((line, index) => index === 0 ? [] : decodeStorageRecord(JSON.parse(line))) as SessionEvent[]
const diff = { card: 'diff' as const, diffs: [{ path: 'done.txt', oldText: null, newText: 'done' }], title: 'Write done.txt' }
const presenter = createToolPresenter(() => ({
  presentCall: () => diff,
  presentResult: () => diff,
}) as unknown as ToolDefinition)

describe('turn diff', () => {
  it('uses the latest completed turn when a trailing turn is open', async () => {
    const agent = { session: { snapshotEvents: () => events } } as unknown as Agent
    const overlay = await diffOverlay({} as Context, agent, presenter, 'turn', new AbortController().signal)
    expect(overlay).toMatchObject({
      kind: 'info', lines: [], title: 'Last completed turn diff · trailing turn open',
    })
    if (overlay.kind !== 'info') throw new Error('expected info overlay')
    expect(overlay.cells).toEqual([expect.objectContaining({ text: 'Write done.txt' })])
  })
})
