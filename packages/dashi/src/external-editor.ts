import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function runEditor(command: string, file: string, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', `exec ${command} "$1"`, 'dashi-editor', file], {
      cwd, stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`editor exited with ${code === null ? signal ?? 'unknown status' : `code ${String(code)}`}`))
    })
  })
}

/** Edit one draft through the user's terminal editor and always remove its file. */
export async function editDraftExternally(text: string, cwd: string): Promise<string> {
  const command = process.env.VISUAL?.trim() || process.env.EDITOR?.trim()
  if (command === undefined || command === '') throw new Error('set $VISUAL or $EDITOR to use Ctrl+G')
  const directory = await mkdtemp(join(tmpdir(), 'dashi-editor-'))
  const file = join(directory, 'draft.md')
  try {
    await writeFile(file, text, { encoding: 'utf8', mode: 0o600 })
    await runEditor(command, file, cwd)
    return await readFile(file, 'utf8')
  } finally {
    try {
      await rm(file, { force: true })
    } finally {
      await rmdir(directory)
    }
  }
}
