import { readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { currentRecordedJsonl, recordedSession } from './fixtures/session-format.js'

const fixtures = new URL('./fixtures/', import.meta.url)

describe('released DSH fixture migration', () => {
  it.each(readdirSync(fixtures).filter(name => name.endsWith('.jsonl')))(
    'restores %s with the native current validator and encodes V4', (name) => {
      const path = fileURLToPath(new URL(name, fixtures))
      const restored = recordedSession(path)
      expect(restored.header.version).toBe(4)
      expect(JSON.parse(currentRecordedJsonl(path).split('\n')[0] ?? '{}').version).toBe(4)
      for (const event of restored.events.filter(event => event.type === 'tool/result')) {
        const message = (event.data as { message: { role: string; content: Array<{ type: string }> } }).message
        expect(message.role).toBe('tool')
        expect(message.content.some(block => block.type === 'tool-result')).toBe(false)
      }
    },
  )

  it('retains the available historical direct child without fabricating its missing descriptor', () => {
    const parent = recordedSession(new URL('presentation-session.jsonl', fixtures))
    expect(parent.events.filter(event => event.type === 'subagent/catalog').map(event => event.data)).toEqual([
      { version: 1, childId: 'dashi-presentation-child', childCreatedAt: 2, mode: 'unknown' },
    ])
  })

  it('applies fixture identity overrides before native encoding and strict restoration', () => {
    const rows = currentRecordedJsonl(new URL('open-turn-session.jsonl', fixtures), {
      id: 'native-encoded-fixture', cwd: '/native-fixture', createdAt: 123,
    }).trim().split('\n').map(line => JSON.parse(line))
    const restore = sessionFormatCatalog.createRestore(rows[0], { recovery: 'strict', validation: 'current' })
    for (const row of rows.slice(1)) restore.decodeRow(row)
    expect(restore.finish().header).toMatchObject({
      version: 4, id: 'native-encoded-fixture', cwd: '/native-fixture', createdAt: 123,
    })
  })
})
