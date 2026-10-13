import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import { activityCounts, contextPercent, jobViews, subagentViews } from '../src/presentation.js'

describe('DSH presentation adapters', () => {
  it('counts only native running/stopping jobs and running agents for both footer and model status', () => {
    expect(activityCounts(undefined)).toEqual({ agents: 0, jobs: 0, entries: 0 })
    expect(activityCounts({ cwd: '/fixture', id: 'root', model: 'recorded', status: 'idle',
      jobs: ['running', 'stopping', 'completed', 'failed', 'killed'].map((status, index) => ({
        id: String(index), kind: 'bash', label: 'native', startedAt: 0, status,
      })) as never,
      subagents: ['running', 'inactive', 'unknown'].map((state, index) => ({
        id: String(index), label: 'native', mode: 'continuable', state,
      })) as never,
    })).toEqual({ agents: 1, jobs: 2, entries: 8 })
  })
  it('matches Web context occupancy and stays absent without both projection fields', () => {
    expect(contextPercent({ projectedTokens: 64, pressureTokens: 10, contextWindow: 128 })).toBe(50)
    expect(contextPercent({ pressureTokens: 200, contextWindow: 128 })).toBe(100)
    expect(contextPercent({ contextWindow: 128 })).toBeUndefined()
  })

  it('copies controller job replacements as detached view data', () => {
    expect(jobViews([{
      id: 'bash-1', kind: 'bash', label: 'build', status: 'completed', detail: 'exit 0',
      startedAt: 10, finishedAt: 20, output: { total: 0, earliest: 0 },
    } as never])).toEqual([{
      id: 'bash-1', kind: 'bash', label: 'build', status: 'completed', detail: 'exit 0',
      startedAt: 10, finishedAt: 20,
    }])
  })

  it('joins the DSH child catalog with title, timing, and token projections', async () => {
    const ctx = {
      get: () => ({
        listChildren: () => Promise.resolve([{
          id: SessionId('child'), createdAt: 1,
          mode: 'continuable', label: 'research',
        }]),
      }),
      sessionController: {
        list: () => Promise.resolve({ items: [{
          sessionId: SessionId('child'), agentAvailable: true, blank: false, running: false, updatedAt: 1,
          projections: { kind: 'sequenced', asOfSeq: 4, values: {
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

  it('reports an unavailable native catalog instead of inventing an empty one', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    await expect(subagentViews(ctx, SessionId('parent'), new AbortController().signal))
      .rejects.toThrow('DSH subagent catalog service is unavailable')
  })

  it('preserves external and unknown children without inventing activity or token facts', async () => {
    const ctx = {
      get: () => ({ listChildren: async () => [
        { id: SessionId('remote'), mode: 'external', createdAt: 1, label: 'remote work' },
        { id: SessionId('unknown'), mode: 'unknown', createdAt: 1 },
      ] }),
      sessionController: { list: async () => ({ items: [{
        sessionId: SessionId('remote'), agentAvailable: true, blank: false, running: true, updatedAt: 1,
      }] }) },
    } as unknown as Context
    await expect(subagentViews(ctx, SessionId('parent'), new AbortController().signal)).resolves.toEqual([
      { id: 'remote', mode: 'external', label: 'remote work', state: 'unknown' },
      { id: 'unknown', mode: 'unknown', label: 'unknown', state: 'unknown' },
    ])
  })
})
