import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { contextPercent, jobViews, subagentViews } from '../src/presentation.js'

describe('DSH presentation adapters', () => {
  it('matches Web context occupancy and stays absent without both projection fields', () => {
    expect(contextPercent({ projectedTokens: 64, pressureTokens: 10, contextWindow: 128 })).toBe(50)
    expect(contextPercent({ pressureTokens: 200, contextWindow: 128 })).toBe(100)
    expect(contextPercent({ contextWindow: 128 })).toBeUndefined()
  })

  it('copies controller job replacements as detached view data', () => {
    expect(jobViews([{
      id: 'bash-1', kind: 'bash', label: 'build', status: 'completed', detail: 'exit 0',
      startedAt: 10, finishedAt: 20,
    } as never])).toEqual([{
      id: 'bash-1', kind: 'bash', label: 'build', status: 'completed', detail: 'exit 0',
      startedAt: 10, finishedAt: 20,
    }])
  })

  it('joins the DSH child catalog with title, timing, and token projections', async () => {
    const ctx = {
      get: () => ({
        remoteExportList: () => Promise.resolve({ parentAvailable: true, entries: [{
          kind: 'child', id: SessionId('child'), activity: 'inactive', hasChildren: false,
          mode: 'continuable', label: 'research',
        }] }),
      }),
      sessionController: {
        list: () => Promise.resolve({ items: [{
          sessionId: SessionId('child'), blank: false, running: false, updatedAt: 1,
          projections: { asOfSeq: 4, values: {
            title: 'Found the cause',
            subagentTiming: { settledMs: 1_250 },
            tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 },
          } },
        }] }),
      },
    } as unknown as Context
    await expect(subagentViews(ctx, SessionId('parent'), new AbortController().signal)).resolves.toEqual([{
      elapsedMs: 1_250, id: 'child', label: 'research', mode: 'continuable', state: 'inactive',
      summary: 'Found the cause', tokens: 20,
    }])
  })

  it('returns no child rows when the profile has no subagent service', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    await expect(subagentViews(ctx, SessionId('parent'), new AbortController().signal)).resolves.toEqual([])
  })
})
