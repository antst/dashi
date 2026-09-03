import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { editDraftExternally } from '../src/external-editor.js'

describe('external draft editor', () => {
  it('uses a mode-0600 file and unlinks it after saved output is read', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dashi-editor-test-'))
    const editor = join(cwd, 'editor.mjs')
    const trace = join(cwd, 'trace.json')
    await writeFile(editor, `
      import { appendFileSync, statSync, writeFileSync } from 'node:fs'
      const file = process.argv[2]
      writeFileSync(process.env.DASHI_EDITOR_TRACE, JSON.stringify({ file, mode: statSync(file).mode & 0o777 }))
      appendFileSync(file, ' from editor')
    `)
    vi.stubEnv('VISUAL', '')
    vi.stubEnv('EDITOR', `${process.execPath} ${editor}`)
    vi.stubEnv('DASHI_EDITOR_TRACE', trace)
    try {
      await expect(editDraftExternally('draft', cwd)).resolves.toBe('draft from editor')
      const result = JSON.parse(await readFile(trace, 'utf8')) as { file: string; mode: number }
      expect(result.mode).toBe(0o600)
      await expect(access(result.file)).rejects.toThrow()
    } finally {
      vi.unstubAllEnvs()
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('unlinks the temporary file when the editor fails', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dashi-editor-failure-'))
    const editor = join(cwd, 'editor.mjs')
    const trace = join(cwd, 'trace.txt')
    await writeFile(editor, `
      import { writeFileSync } from 'node:fs'
      writeFileSync(process.env.DASHI_EDITOR_TRACE, process.argv[2])
      process.exit(7)
    `)
    vi.stubEnv('VISUAL', `${process.execPath} ${editor}`)
    vi.stubEnv('DASHI_EDITOR_TRACE', trace)
    try {
      await expect(editDraftExternally('draft', cwd)).rejects.toThrow('code 7')
      await expect(access(await readFile(trace, 'utf8'))).rejects.toThrow()
    } finally {
      vi.unstubAllEnvs()
      await rm(cwd, { force: true, recursive: true })
    }
  })
})
