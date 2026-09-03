import { describe, expect, it } from 'vitest'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { boundedBody, createToolPresenter } from '../src/tool-presentation.js'

describe('tool presentation', () => {
  it('uses presenter-selected terminal and diff cards without tool-name branches', () => {
    const terminal = {
      presentCall: () => ({ card: 'terminal', title: 'printf ok', cwd: '/work' }),
      presentResult: () => ({ card: 'terminal', output: 'ok', exitCode: 0 }),
    } as unknown as ToolDefinition
    const presenter = createToolPresenter(() => terminal)
    const call = presenter.call('anything', '{"command":"printf ok"}')
    expect(call.card).toEqual({ card: 'terminal', title: 'printf ok', status: 'cwd /work' })
    expect(presenter.result('anything', call.args, { content: [], isError: false }, call.card)).toEqual({
      body: 'ok', card: 'terminal', status: 'exit 0', title: 'printf ok',
    })

    const diffTool = {
      presentCall: () => ({ card: 'diff', title: 'Edit a.ts', diffs: [{
        path: 'a.ts', oldText: 'one\ntwo\nthree\n', newText: 'one\nchanged\nthree\n',
      }] }),
    } as unknown as ToolDefinition
    const diff = createToolPresenter(() => diffTool).call('edit', '{}').card.diffs?.[0]
    expect(diff).toMatchObject({ path: 'a.ts', added: 1, removed: 1 })
    expect(diff?.lines).toContain('- two')
    expect(diff?.lines).toContain('+ changed')
  })

  it('contains oversized and hostile presenter output and falls back when it throws', () => {
    const hostile = {
      presentCall: () => ({
        card: 'generic', title: '\u001B[2Jhostile\u0007',
        content: [{ type: 'text', text: Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n') }],
      }),
      presentResult: () => { throw new Error('presenter exploded') },
    } as unknown as ToolDefinition
    const presenter = createToolPresenter(() => hostile)
    const call = presenter.call('hostile', '{}')
    expect(call.card.title).toContain('\u001B[2J')
    expect(call.card.body?.split('\n')).toHaveLength(21)
    expect(call.card.body).toContain('20 lines omitted')
    expect(presenter.result('hostile', call.args, {
      content: [{ type: 'text', text: 'safe fallback' }], isError: false,
    }, call.card)).toEqual({ card: 'generic', title: '\u001B[2Jhostile\u0007', body: 'safe fallback' })
    expect(boundedBody('x'.repeat(3_000))).toHaveLength(2_001)
  })
})
