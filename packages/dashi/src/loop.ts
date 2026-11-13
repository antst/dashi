import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { boundContextSummary } from '@deepseek-ai/dsh-llm'
import { ScheduleId, ScheduleInputError, type ScheduleCatalogEntry, type ScheduleService } from '@deepseek-ai/dsh-schedule'
import type { SessionId } from '@deepseek-ai/dsh-session'

function line(task: ScheduleCatalogEntry): string {
  const seconds = task.kind === 'every' ? task.everySeconds : 0
  const interval = seconds % 3_600 === 0 ? `${String(seconds / 3_600)}h`
    : seconds % 60 === 0 ? `${String(seconds / 60)}m` : `${String(seconds)}s`
  const timing = task.kind === 'every' ? `every ${interval}` : task.kind === 'after'
    ? `after ${String(task.afterSeconds)}s` : `${task.kind} ${task.scheduledAt}`
  return `${String(task.id)} · ${timing} · ${task.prompt}`
}

/** Human /loop uses native timing and storage, fenced to this session's target. */
export async function runLoop(
  schedule: Pick<ScheduleService, 'create' | 'list' | 'view' | 'edit'>,
  sessionId: SessionId, input: string, signal: AbortSignal,
): Promise<CommandResult> {
  const raw = input.trim()
  const stop = /^stop\s+(\S+)$/u.exec(raw)
  const create = /^(\d+)([mh])\s+(.+)$/su.exec(raw)
  if (raw !== '' && stop === null && create === null) return { kind: 'error', text: 'usage: /loop [INTERVAL TEXT | stop ID]' }
  const owned = (task: ScheduleCatalogEntry): boolean => task.target.kind === 'session' && task.target.sessionId === sessionId
  try {
    if (raw === '') {
      const lines: string[] = []
      let offset = 0
      for (;;) {
        const page = await schedule.list({ active: true, limit: 500, offset })
        lines.push(...page.items.filter(owned).map(line))
        const next = page.offset + page.shown
        if (next >= page.total) break
        if (next <= offset) throw new Error('DSH schedule list did not advance')
        offset = next
      }
      return { kind: 'success', text: lines.length === 0 ? 'no active schedules' : lines.join('\n') }
    }
    if (stop !== null) {
      const id = ScheduleId(stop[1]!)
      const task = await schedule.view({ id })
      if ('code' in task || !owned(task)) return { kind: 'error', text: `schedule ${String(id)} not found in this session` }
      const result = await schedule.edit({ id, action: 'delete', expectedUpdatedAt: task.updatedAt ?? null }, sessionId, signal)
      if ('code' in result) return { kind: 'error', text: result.code === 'schedule_conflict'
        ? `schedule ${String(id)} changed; list loops again` : `schedule ${String(id)} not found` }
      if (!('deleted' in result)) throw new Error('DSH schedule delete returned no deletion outcome')
      return { kind: 'success', text: `stopped ${String(id)}` }
    }
    const task = await schedule.create({
      title: boundContextSummary(create![3]!.replace(/\s+/gu, ' ').trim()), prompt: create![3]!,
      timing: { kind: 'every', every_seconds: Number(create![1]) * (create![2] === 'h' ? 3_600 : 60) },
      target: { kind: 'session', sessionId },
    }, sessionId, signal)
    return { kind: 'success', text: `scheduled ${line(task)}` }
  } catch (error) {
    if (error instanceof ScheduleInputError) return { kind: 'error', text: error.message }
    throw error
  }
}
