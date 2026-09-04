import { mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { droppedPaths, installInput } from '../src/input.js'
import { initialViewState } from '../src/state.js'

describe('terminal dropped paths', () => {
  it.each([
    ['bare', (root: string) => `${root}/plain.txt`],
    ['single quoted', (root: string) => `'${root}/name with spaces.txt'`],
    ['backslash escaped', (root: string) => `${root}/name\\ with\\ spaces.txt`],
  ])('decodes a %s path with one stat', (_name, paste) => {
    const root = mkdtempSync(join(tmpdir(), 'dashi-drop-'))
    writeFileSync(join(root, 'plain.txt'), '')
    writeFileSync(join(root, 'name with spaces.txt'), '')
    const inspect = vi.fn((path: string) => statSync(path))
    expect(droppedPaths(`\u001B[200~${paste(root)}\u001B[201~`, root, inspect)).toEqual({
      images: [], text: paste(root).includes('plain') ? '@plain.txt ' : '@"name with spaces.txt" ',
    })
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('leaves a mixed path and non-path paste unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'dashi-drop-'))
    mkdirSync(join(root, 'existing'))
    expect(droppedPaths(`\u001B[200~${root}/existing plus words\u001B[201~`, root)).toBeUndefined()
  })

  it('resolves a drop against the bound session cwd rather than the launch cwd', () => {
    const launch = mkdtempSync(join(tmpdir(), 'dashi-launch-'))
    const session = mkdtempSync(join(tmpdir(), 'dashi-session-'))
    writeFileSync(join(session, 'notes.txt'), '')
    let input: Parameters<Parameters<typeof installInput>[0]['addInputListener']>[0] = () => undefined
    const insertText = vi.fn()
    installInput({ addInputListener: (listener: typeof input) => { input = listener; return () => {} } } as never, {
      dispatch: vi.fn(), insertText,
      readState: () => initialViewState(launch, false, {
        cwd: session, id: 'resumed', model: 'model', status: 'idle',
      }),
    })
    input('\u001B[200~notes.txt\u001B[201~')
    expect(insertText).toHaveBeenCalledWith('@notes.txt ')
  })
})
