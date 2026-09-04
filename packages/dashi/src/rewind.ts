import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Overlay, OverlayOption, OverlayValue } from './state.js'

export interface RewindBoundary {
  readonly atSeq?: number
  readonly label: string
  readonly prompt: string
}

/** Return the text of a direct human message, excluding injected context. */
export function humanPrompt(event: SessionEvent): string | undefined {
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return undefined
  const text = event.data.content
    .filter(block => block.type === 'text')
    .map(block => block.text).join('')
  return text === '' ? undefined : text
}

function shellInput(message: UserMessage): string | undefined {
  if (message.source.kind !== 'plugin' || message.source.plugin !== 'dashi'
    || message.source.form !== 'notice') return undefined
  const first = message.content.find(block => block.type === 'text')?.text.split(/\r?\n/u)[0]
  return first?.startsWith('$ ') === true ? `!${first.slice(2)}` : undefined
}

/** Recover one composer input from DSH's durable log. */
export function historyInput(event: SessionEvent): string | undefined {
  const prompt = humanPrompt(event)
  if (prompt !== undefined) return prompt
  if (event.type === 'command/run' && event.data.args !== undefined) {
    return `/${event.data.name}${event.data.args}`
  }
  if (event.type !== 'agent/inbox/spliced') return undefined
  return event.data.inserted.map(shellInput).find(input => input !== undefined)
}

export function historyInputs(events: readonly SessionEvent[]): readonly string[] {
  return events.flatMap(event => historyInput(event) ?? [])
}

/** Derive each recalled input and its controller-valid preceding-turn cut. */
export function rewindBoundaries(events: readonly SessionEvent[]): readonly RewindBoundary[] {
  const boundaries: RewindBoundary[] = []
  let previousEnd: SessionEvent<'turn/end'> | undefined
  let openTurn: number | undefined
  let prompted = false
  for (const event of events) {
    if (event.type === 'turn/start') {
      openTurn = event.data.turn
      prompted = false
    } else if (event.type === 'turn/end') {
      previousEnd = event
      openTurn = undefined
      prompted = false
    }
    const prompt = historyInput(event)
    if (prompt === undefined) continue
    const human = humanPrompt(event) !== undefined
    boundaries.push({
      ...(previousEnd === undefined ? {} : { atSeq: previousEnd.seq }),
      label: `${prompt.replaceAll(/\s+/gu, ' ')}${human && prompted ? ' · mid-turn' : ''}`,
      prompt,
    })
    if (human && openTurn !== undefined) prompted = true
  }
  return boundaries
}

export function rewindOverlay(events: readonly SessionEvent[], roller: boolean): Overlay {
  const boundaries = rewindBoundaries(events)
  return {
    cursor: Math.max(0, boundaries.length - 1),
    kind: 'list',
    options: boundaries.map(boundary => ({
      label: boundary.label,
      value: {
        kind: 'rewind-boundary', prompt: boundary.prompt, roller,
        ...(boundary.atSeq === undefined ? {} : { atSeq: boundary.atSeq }),
      },
    })),
    purpose: 'rewind',
    title: 'Rewind to a prompt',
  }
}

export function rewindActionOverlay(
  boundary: Extract<OverlayValue, { kind: 'rewind-boundary' }>,
): Overlay {
  const base = {
    prompt: boundary.prompt,
    ...(boundary.atSeq === undefined ? {} : { atSeq: boundary.atSeq }),
  }
  const options: OverlayOption[] = [
    ...(boundary.roller ? [{
      label: 'Restore code and conversation', value: { ...base, kind: 'rewind' as const, mode: 'both' as const },
    }] : []),
    { label: 'Restore conversation', value: { ...base, kind: 'rewind', mode: 'conversation' } },
    ...(boundary.roller ? [{
      label: 'Restore code', value: { ...base, kind: 'rewind' as const, mode: 'code' as const },
    }] : []),
    { label: 'Never mind', value: { kind: 'open-rewind' } },
  ]
  return { cursor: 0, kind: 'list', options, purpose: 'rewind-action', title: boundary.prompt }
}

/** Read a fork's durable source boundary without storing lineage separately. */
export function inheritedTurn(events: readonly SessionEvent[], inheritedCount: number): number | undefined {
  for (let index = Math.min(inheritedCount, events.length) - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/end') return event.data.turn
  }
  return undefined
}
