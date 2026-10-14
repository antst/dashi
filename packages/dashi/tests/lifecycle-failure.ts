import { spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TestPtyShell } from './pty-shell.js'

/** Only the lifecycle family owns these marks; no diagnostic work on success. */
export function lifecycleFailure(
  name: string,
  onTestFailed: (capture: () => void) => void,
  directory = fileURLToPath(new URL('../../../.cache/lifecycle-failures/', import.meta.url)),
) {
  const started = performance.now()
  const marks: { stage: string; elapsedMs: number }[] = []
  let shell: TestPtyShell | undefined
  let saved: string | undefined
  const mark = (stage: string) => { marks.push({ stage, elapsedMs: performance.now() - started }) }
  const own = (current: TestPtyShell) => { shell = current; mark('shell created') }
  const capture = () => {
    if (saved !== undefined) return
    saved = join(directory, `${process.pid}-${Date.now()}-${name.replaceAll(/[^a-z0-9-]/giu, '_')}.json`)
    let tail = Buffer.from(shell?.output ?? '', 'utf8').subarray(-4096)
    while (tail.length > 0 && (tail[0]! & 0xc0) === 0x80) tail = tail.subarray(1)
    const record = {
      name, stage: marks.at(-1)?.stage ?? 'before shell', elapsedMs: performance.now() - started,
      marks: [...marks], shellPid: shell?.process.pid ?? null, tail: tail.toString('utf8'),
      processes: { rows: [] as { pid: number; ppid: number; state: string; name: string }[],
        observation: 'not read', error: undefined as string | undefined },
    }
    mkdirSync(directory, { recursive: true })
    // Preserve the stage and tail even if the bounded process read fails.
    const write = () => { writeFileSync(saved!, JSON.stringify(record, null, 2) + '\n') }
    write()
    if (record.shellPid !== null) {
      const result = spawnSync('ps', ['-ax', '-o', 'pid=', '-o', 'ppid=', '-o', 'stat=', '-o', 'comm='], {
        encoding: 'utf8', timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
        env: { ...process.env, LANG: 'C', LC_ALL: 'C' },
      })
      if (result.status !== 0 || result.error !== undefined) {
        record.processes.observation = 'read failed'
        record.processes.error = String(result.error?.name ?? `ps exit ${String(result.status)}`)
      } else {
        const rows: typeof record.processes.rows = []
        for (const line of result.stdout.split('\n')) {
          const row = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.+)$/u.exec(line)
          if (row === null) continue
          const pid = Number(row[1]), ppid = Number(row[2])
          rows.push({ pid, ppid, state: row[3]!, name: row[4]! })
        }
        const owned = rows.some(row => row.pid === record.shellPid && row.ppid === process.pid)
        record.processes.rows = owned ? rows.filter(row => row.pid === record.shellPid || row.ppid === record.shellPid) : []
        record.processes.observation = owned
          ? record.processes.rows.length > 1 ? 'owned shell and direct child only' : 'owned shell; no direct child observed'
          : 'owned shell absent or ownership changed'
      }
      write()
    }
    console.error(`lifecycle failure saved: ${saved}`)
  }
  onTestFailed(capture)
  return { mark, own, capture, current: () => shell }
}
