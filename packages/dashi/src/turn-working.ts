import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export interface WorkingStream {
  readonly attemptId: string
  readonly turn: number
  readonly step: number
  readonly startedAfterSeq: number
  readonly observedAt?: number
  readonly lastChunk?: { readonly time: number; readonly chunk: StreamChunk } | undefined
}

export interface TurnWorking {
  readonly startedAt?: number | undefined
  readonly phase: string
  readonly phaseStartedAt?: number
  readonly lastChunkAt?: number
  readonly tail?: string
}

/** Read native turn/step, paired calls, retry records and one live attempt. */
export function turnWorking(events: readonly SessionEvent[], stream?: WorkingStream): TurnWorking | undefined {
  let view: TurnWorking | undefined
  let turn = -1
  let step = -1
  let retry: number | undefined
  let settledAfterSeq = -1
  const calls = new Map<string, { name: string; time: number }>()
  for (const event of events) {
    if (event.type === 'turn/start') {
      turn = event.data.turn; step = -1; retry = undefined; calls.clear()
      view = { startedAt: event.time, phase: 'Working' }
    } else if (event.type === 'turn/end' && event.data.turn === turn) view = undefined
    else if (view !== undefined) {
      if (event.type === 'step/start' && event.data.turn === turn) {
        step = event.data.step; retry = undefined; calls.clear()
        view = { startedAt: view.startedAt, phase: 'Working' }
      } else if (event.type === 'tool/call' && event.data.turn === turn && event.data.step === step) {
        calls.set(String(event.data.callId), { name: event.data.name, time: event.time })
      } else if (event.type === 'tool/result' && event.data.turn === turn && event.data.step === step) {
        calls.delete(String(event.data.message.source.callId))
        view = { startedAt: view.startedAt, phase: 'Working' }
      } else if ((event.type === 'assistant/message' || event.type === 'assistant/attempt') && event.data.turn === turn && event.data.step === step) {
        settledAfterSeq = event.seq
        view = { startedAt: view.startedAt, phase: 'Working' }
      } else if (String(event.type) === 'llm/retry' || String(event.type) === 'llm/retry-started') {
        // dsh-llm-retry README.md:54: scheduled before backoff, started after it.
        const data = event.data as unknown as Record<string, unknown>
        if (data.turn === turn && data.step === step && typeof data.retry === 'number'
          && Number.isSafeInteger(data.retry) && data.retry > 0) {
          retry = data.retry
          settledAfterSeq = event.seq
          view = { startedAt: view.startedAt, phase: String(event.type) === 'llm/retry' ? 'Retry wait' : 'Retrying', phaseStartedAt: event.time }
        }
      }
    }
  }
  if (view === undefined) return undefined
  if (retry !== undefined) view = { ...view, tail: `retry ${String(retry)}` }
  const first = calls.values().next().value
  if (first !== undefined) return { ...view, phase: 'Tool pending', phaseStartedAt: first.time,
    tail: `${calls.size > 1 ? `${String(calls.size)} calls · ` : ''}${first.name}${retry === undefined ? '' : ` · retry ${String(retry)}`}` }
  if (stream?.turn !== turn || stream.step !== step || stream.startedAfterSeq < settledAfterSeq) return view
  const chunk = stream.lastChunk?.chunk
  const kind = chunk?.type === 'block-start' ? chunk.blockType
    : chunk?.type === 'block-end' ? chunk.block.type
      : chunk?.type === 'reasoning-delta' ? 'reasoning'
        : chunk?.type === 'text-delta' ? 'text' : chunk?.type === 'tool-call-delta' ? 'tool-call' : undefined
  const phase = chunk === undefined ? 'Waiting for model'
    : kind === 'reasoning' ? 'Reasoning' : kind === 'text' ? 'Receiving text' : kind === 'tool-call' ? 'Tool request' : 'Working'
  const name = chunk?.type === 'tool-call-delta' ? chunk.name
    : chunk?.type === 'block-end' && chunk.block.type === 'tool-call' ? chunk.block.name : undefined
  return { startedAt: view.startedAt, phase,
    ...(chunk === undefined && stream.observedAt !== undefined ? { phaseStartedAt: stream.observedAt } : {}),
    ...(stream.lastChunk === undefined ? {} : { lastChunkAt: stream.lastChunk.time }),
    ...(name === undefined ? view.tail === undefined ? {} : { tail: view.tail }
      : { tail: `${name}${view.tail === undefined ? '' : ` · ${view.tail}`}` }),
  }
}
