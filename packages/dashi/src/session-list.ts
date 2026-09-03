import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller'

export interface SessionListOptions {
  readonly all: boolean
  readonly cwd?: string
  readonly json: boolean
}

interface SessionListRow {
  readonly cwd?: string
  readonly sessionId: string
  readonly title: string | null
  readonly updatedAt: string
}

/** Parse only the profile-provided `sessions list` grammar. */
export function parseSessionListArgs(args: readonly string[]): SessionListOptions | undefined {
  if (args[0] !== 'sessions' || args[1] !== 'list') return undefined
  let all = false
  let cwd: string | undefined
  let json = false
  for (let index = 2; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--all' && !all && cwd === undefined) all = true
    else if (argument === '--json' && !json) json = true
    else if (argument === '--cwd' && cwd === undefined && !all) {
      cwd = args[++index]
      if (cwd === undefined || cwd === '') return undefined
    } else return undefined
  }
  return { all, json, ...(cwd === undefined ? {} : { cwd }) }
}

export function sessionTitle(item: SessionSummary): string | undefined {
  const title = item.projections?.values.title
  return typeof title === 'string' && title !== '' ? title : undefined
}

export function isSessionId(value: string): boolean {
  return /^session-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)
}

/** Resolve one native title exactly, then by case-insensitive substring. */
export function sessionMatches(items: readonly SessionSummary[], value: string, cwd?: string): readonly SessionSummary[] {
  const scoped = items.filter(item => item.origin === undefined && (cwd === undefined || item.cwd === cwd))
  const exact = scoped.filter(item => sessionTitle(item) === value)
  return exact.length > 0 ? exact : scoped.filter(item => sessionTitle(item)?.toLocaleLowerCase().includes(value.toLocaleLowerCase()))
}

export function sessionNotFound(value: string): Error {
  return new Error(`no session named ${JSON.stringify(value)}`)
}

function terminalJson(value: unknown, space?: number): string {
  return JSON.stringify(value, undefined, space).replace(/[\u0080-\u009f]/gu, character =>
    `\\u${(character.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`)
}

function terminalField(value: string): string {
  return terminalJson(value).slice(1, -1)
}

/** Format ordinary roots from DSH's native catalog without adding live-process facts. */
export function formatSessionList(items: readonly SessionSummary[], cwd: string | undefined, json: boolean): string {
  const sessions: SessionListRow[] = items
    .filter(item => item.origin === undefined && (cwd === undefined || item.cwd === cwd))
    .map(item => ({
      sessionId: String(item.sessionId),
      title: sessionTitle(item) ?? null,
      ...(item.cwd === undefined ? {} : { cwd: item.cwd }),
      updatedAt: new Date(item.updatedAt).toISOString(),
    }))
  if (json) return terminalJson({ version: 1, sessions }, 2)
  const records = sessions.map(item => [
    terminalField(item.sessionId), terminalField(item.title ?? 'Untitled'),
    terminalField(item.cwd ?? 'cwd unavailable'), item.updatedAt,
  ])
  const headers = ['UUID', 'TITLE', 'CWD', 'UPDATED']
  const widths = headers.map((header, index) => Math.max(header.length, ...records.map(row => row[index]?.length ?? 0)))
  return [headers, ...records].map(row => row.map((value, index) =>
    index === row.length - 1 ? value : value.padEnd(widths[index] ?? 0)).join('  ')).join('\n')
}
