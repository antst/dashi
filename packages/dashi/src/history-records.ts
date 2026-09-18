import type { SessionHistoryRecord } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Read the Controller's canonical Session event history. */
export function eventsFromRecords(records: readonly SessionHistoryRecord[]): SessionEvent[] {
  return records.map(record => record.event as unknown as SessionEvent)
}
