import type { SessionHistoryRecord } from '@deepseek-ai/dsh-api-session-controller'
import { decodeStorageRecord, type SessionEvent } from '@deepseek-ai/dsh-session'

/** Expand the Controller's compact history wire records to canonical Session events. */
export function eventsFromRecords(records: readonly SessionHistoryRecord[]): SessionEvent[] {
  return records.flatMap((record) => {
    if (record.type === 'event') return [record.event as unknown as SessionEvent]
    const encoded = record.event.type === 'chunkrow/text-chunks'
      ? { type: 'text-chunks', seq0: record.event.seq, time0: record.event.time, data: record.event.data }
      : record.event.type === 'chunkrow/reasoning-chunks'
        ? { type: 'reasoning-chunks', seq0: record.event.seq, time0: record.event.time, data: record.event.data }
        : { type: 'tool-call-chunks', seq0: record.event.seq, time0: record.event.time, data: record.event.data }
    return decodeStorageRecord(encoded)
  })
}
