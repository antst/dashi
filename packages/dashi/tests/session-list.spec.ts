import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import { describe, expect, it } from 'vitest'
import { formatSessionList, isSessionId, parseSessionListArgs, sessionMatches } from '../src/session-list.js'

function summary(
  sessionId: string,
  cwd: string | undefined,
  updatedAt: number,
  title?: string,
  origin?: 'subagent',
): SessionSummary {
  return {
    blank: false, running: true, sessionId: sessionId as never, updatedAt,
    ...(cwd === undefined ? {} : { cwd }),
    ...(origin === undefined ? {} : { origin }),
    ...(title === undefined ? {} : { projections: { asOfSeq: 1, values: { title } } }),
  }
}

describe('profile session list', () => {
  it('recognizes exact IDs and resolves native titles before case-insensitive substrings', () => {
    const items = [
      summary('session-one', '/work', 3, 'Exact Name'),
      summary('session-two', '/work', 2, 'prefix exact name suffix'),
      summary('session-other', '/other', 1, 'Exact Name'),
    ]
    expect(isSessionId('session-00000000-0000-0000-0000-000000000028')).toBe(true)
    expect(isSessionId('Exact Name')).toBe(false)
    expect(sessionMatches(items, 'Exact Name', '/work').map(item => item.sessionId)).toEqual(['session-one'])
    expect(sessionMatches(items, 'EXACT NAME', '/work').map(item => item.sessionId)).toEqual([
      'session-one', 'session-two',
    ])
    expect(sessionMatches(items, 'Exact Name').map(item => item.sessionId)).toEqual(['session-one', 'session-other'])
  })

  it('accepts only the sessions-list grammar', () => {
    expect(parseSessionListArgs(['sessions', 'list'])).toEqual({ all: false, json: false })
    expect(parseSessionListArgs(['sessions', 'list', '--cwd', '../work', '--json']))
      .toEqual({ all: false, cwd: '../work', json: true })
    expect(parseSessionListArgs(['sessions', 'list', '--all', '--json']))
      .toEqual({ all: true, json: true })
    expect(parseSessionListArgs(['sessions', 'list', '--all', '--cwd', '/work'])).toBeUndefined()
    expect(parseSessionListArgs(['sessions', 'list', '--resume', 'session-x'])).toBeUndefined()
    expect(parseSessionListArgs(['sessions', 'show'])).toBeUndefined()
  })

  it('formats cwd-scoped ordinary roots with no process-local running fact', () => {
    const output = formatSessionList([
      summary('session-one', '/work', 1_800_000_000_000, 'One'),
      summary('session-two', '/work', 1_800_000_001_000),
      summary('session-other', '/other', 1_800_000_002_000, 'Other'),
      summary('session-child', '/work', 1_800_000_003_000, 'Child', 'subagent'),
    ], '/work', true)
    expect(JSON.parse(output)).toEqual({
      version: 1,
      sessions: [
        { sessionId: 'session-one', title: 'One', cwd: '/work', updatedAt: '2027-01-15T08:00:00.000Z' },
        { sessionId: 'session-two', title: null, cwd: '/work', updatedAt: '2027-01-15T08:00:01.000Z' },
      ],
    })
    expect(output).not.toContain('running')
  })

  it('keeps human columns readable without emitting title control sequences', () => {
    const output = formatSessionList([
      summary('session-one', '/work', 1_800_000_000_000, 'hostile\u001B]52;c;bad\u0007\u009B31m'),
    ], undefined, false)
    expect(output).toContain('UUID')
    expect(output).toContain('TITLE')
    expect(output).toContain('hostile\\u001b]52;c;bad\\u0007\\u009b31m')
    expect(output).not.toContain('\u0007')
    expect(output).not.toContain('\u001B')
    expect(output).not.toContain('\u009B')
  })
})
