import { detectAtTrigger } from './at-trigger.js'

export function slashCompletionQuery(input: string): string | undefined {
  return /^\/([a-z0-9_-]*)$/u.exec(input)?.[1]
}

export function pluginCompletionQuery(input: string, caret: number):
  { readonly command?: string; readonly query: string } | undefined {
  if (caret !== input.length) return undefined
  const match = /^\/plugin +([^\s]*)(?: +([^\s]*))?$/u.exec(input)
  if (match === null) return undefined
  const command = match[1] ?? ''
  if (match[2] === undefined) return { query: command }
  return /^(?:exec|remove|update|why)$/u.test(command) ? { command, query: match[2] } : undefined
}

export function hasCompletionTrigger(input: string, caret: number): boolean {
  return slashCompletionQuery(input) !== undefined || pluginCompletionQuery(input, caret) !== undefined
    || detectAtTrigger(input, caret) !== undefined
}
