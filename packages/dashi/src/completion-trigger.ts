import { detectAtTrigger } from './at-trigger.js'

export function slashCompletionQuery(input: string): string | undefined {
  return /^\/([a-z0-9_-]*)$/u.exec(input)?.[1]
}

export function hasCompletionTrigger(input: string, caret: number): boolean {
  return slashCompletionQuery(input) !== undefined || detectAtTrigger(input, caret) !== undefined
}
