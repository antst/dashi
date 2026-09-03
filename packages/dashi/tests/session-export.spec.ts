import { describe, expect, it } from 'vitest'
import { markdownTranscript } from '../src/session-export.js'

describe('Markdown session export', () => {
  it('writes completed terminal cells and excludes the command still performing the export', () => {
    const markdown = markdownTranscript('session-a', '/work', 'A title', [
      { key: 'user:1', kind: 'user', text: 'Inspect the parser.' },
      { key: 'assistant:2', kind: 'assistant', text: 'The parser is sound.' },
      { key: 'command:3', kind: 'command', pending: true, text: '/export transcript.md' },
    ])
    expect(markdown).toContain('# A title')
    expect(markdown).toContain('## User\n\nInspect the parser.')
    expect(markdown).toContain('## Assistant\n\nThe parser is sound.')
    expect(markdown).not.toContain('/export')
    expect(markdown).toMatch(/\n$/u)
  })
})
