import type { Context } from '@deepseek-ai/cordis'
import type { SessionJob, SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-subagent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { JobView, SubagentView } from './state.js'

/** Web-equivalent context occupancy; undefined until both DSH projection fields exist. */
export function contextPercent(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const pressure = value as { contextWindow?: unknown; pressureTokens?: unknown; projectedTokens?: unknown }
  const used = typeof pressure.projectedTokens === 'number' ? pressure.projectedTokens : pressure.pressureTokens
  return typeof used !== 'number' || typeof pressure.contextWindow !== 'number'
    ? undefined
    : Math.min(100, Math.round(used / pressure.contextWindow * 100))
}

export function jobViews(jobs: readonly SessionJob[]): readonly JobView[] {
  return jobs.map(job => ({
    id: String(job.id), kind: job.kind, label: job.label, startedAt: job.startedAt, status: job.status,
    ...(job.detail === undefined ? {} : { detail: job.detail }),
    ...(job.finishedAt === undefined ? {} : { finishedAt: job.finishedAt }),
  }))
}

function summaryTitle(summary: SessionSummary | undefined): string | undefined {
  const title = summary?.projections?.values.title
  return typeof title === 'string' && title !== '' ? title : undefined
}

function tokenTotal(summary: SessionSummary | undefined): number | undefined {
  const usage = summary?.projections?.values.tokenUsage
  return usage === undefined ? undefined
    : usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Read DSH's direct-child catalog and projection-backed summary facts. */
export async function subagentViews(
  ctx: Context,
  parentId: SessionId,
  signal: AbortSignal,
): Promise<readonly SubagentView[]> {
  const subagents = ctx.get('subagents')
  if (subagents === undefined) return []
  const [catalog, listed] = await Promise.all([
    subagents.remoteExportList(parentId, signal),
    ctx.sessionController.list({}, signal),
  ])
  const summaries = new Map(listed.items.map(summary => [String(summary.sessionId), summary]))
  return catalog.entries.flatMap((entry): readonly SubagentView[] => {
    if (entry.kind !== 'child') return []
    const summary = summaries.get(String(entry.id))
    const timing = summary?.projections?.values.subagentTiming
    const title = summaryTitle(summary)
    const tokens = tokenTotal(summary)
    return [{
      id: String(entry.id), label: entry.label ?? String(entry.id), mode: entry.mode, state: entry.activity,
      ...(timing === undefined ? {} : {
        elapsedMs: timing.settledMs,
        ...(timing.active === undefined ? {} : { active: timing.active }),
      }),
      ...(title === undefined ? {} : { summary: title }),
      ...(tokens === undefined ? {} : { tokens }),
    }]
  })
}
