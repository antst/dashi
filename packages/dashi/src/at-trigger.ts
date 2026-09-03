import { activeAtToken } from '@deepseek-ai/dsh-file-reference/grammar'

export interface AtTrigger {
  readonly end: number
  readonly query: string
  readonly quoted: boolean
  readonly start: number
}

/** Terminal copy of the @ branch in DSH ui-input-trigger core/detect. */
export function detectAtTrigger(draft: string, caret: number): AtTrigger | undefined {
  const token = activeAtToken(draft, caret)
  if (token === undefined) return undefined
  return {
    end: caret,
    query: token.query,
    quoted: token.quoted,
    start: caret - token.prefix.length,
  }
}
