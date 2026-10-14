import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, onTestFinished, vi } from 'vitest'
import { lifecycleFailure } from './lifecycle-failure.js'

const ps = vi.hoisted(() => vi.fn())
vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(), spawnSync: ps,
}))
afterEach(() => { ps.mockReset(); vi.restoreAllMocks() })

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'dashi-lifecycle-control-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  const directory = join(root, 'captures')
  const hooks: (() => void)[] = []
  const failure = lifecycleFailure('control', hook => { hooks.push(hook) }, directory)
  const pid = process.pid + 1000
  const shell = { process: { pid }, output: '' }
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const read = () => JSON.parse(readFileSync(join(directory, readdirSync(directory)[0]!), 'utf8'))
  return { failure, hooks, shell, pid, directory, read }
}

it('a passing lifecycle only marks memory: no directory and no process diagnostic', () => {
  const { failure, hooks, shell, directory } = fixture()
  failure.own(shell as never)
  failure.mark('boot')
  expect(hooks).toHaveLength(1)
  expect(failure.current()).toBe(shell)
  expect(existsSync(directory)).toBe(false)
  expect(ps).not.toHaveBeenCalled()
})

it.each(['preparation', 'boot', 'restoration', 'resume'])('the first %s failure keeps its stage and byte-bounded tail', stage => {
  const { failure, hooks, shell, pid, read } = fixture()
  ps.mockReturnValue({ status: 0, stdout: `${pid} ${process.pid} S bash\n${pid + 1} ${pid} S node\n1 0 S decoy\n` })
  shell.output = 'discarded prefix ' + '界'.repeat(3000) + '\u001b[?1049l END'
  failure.own(shell as never)
  failure.mark(stage)
  failure.capture()
  shell.output = 'cleanup overwrote the live tail'
  failure.mark('close')
  hooks[0]!()
  const record = read()
  expect(record.stage).toBe(stage)
  expect(record.marks.map((mark: { stage: string }) => mark.stage)).toEqual(['shell created', stage])
  expect(record.marks.every((mark: { elapsedMs: number }) => mark.elapsedMs >= 0)).toBe(true)
  expect(record.shellPid).toBe(pid)
  expect(record.tail).toContain('\u001b[?1049l END')
  expect(record.tail).not.toContain('discarded prefix')
  expect(Buffer.byteLength(record.tail, 'utf8')).toBeLessThanOrEqual(4096)
  expect(record.processes.rows).toEqual([
    { pid, ppid: process.pid, state: 'S', name: 'bash' },
    { pid: pid + 1, ppid: pid, state: 'S', name: 'node' },
  ])
  expect(ps).toHaveBeenCalledTimes(1)
  expect(ps.mock.calls[0]!.slice(0, 2)).toEqual(['ps', ['-ax', '-o', 'pid=', '-o', 'ppid=', '-o', 'stat=', '-o', 'comm=']])
  expect(ps.mock.calls[0]![2]).toMatchObject({ timeout: 1000, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024,
    env: { LANG: 'C', LC_ALL: 'C' } })
  expect(JSON.stringify(record)).not.toContain('decoy')
})

it('a failed bounded ps read cannot erase the already-written stage and tail', () => {
  const { failure, hooks, shell, read } = fixture()
  ps.mockImplementation(() => {
    const initial = read()
    expect(initial.stage).toBe('late wait')
    expect(initial.tail).toBe('last observed frame')
    return { status: null, error: Object.assign(new Error('private detail not recorded'), { name: 'TimeoutError' }) }
  })
  shell.output = 'last observed frame'
  failure.own(shell as never)
  failure.mark('late wait')
  hooks[0]!()
  expect(read().processes).toEqual({ rows: [], observation: 'read failed', error: 'TimeoutError' })
  expect(JSON.stringify(read())).not.toContain('private detail')
})

it('a different owner cannot turn a reused shell pid into a foreign capture', () => {
  const { failure, hooks, shell, pid, read } = fixture()
  ps.mockReturnValue({ status: 0, stdout: `${pid} 1 S foreign\n${pid + 1} ${pid} S foreign-child\n` })
  failure.own(shell as never)
  hooks[0]!()
  expect(read().processes).toEqual({ rows: [], observation: 'owned shell absent or ownership changed' })
})

it('an outer failure before construction records an unknown pid without ps', () => {
  const { failure, hooks, read } = fixture()
  failure.mark('shell construction')
  hooks[0]!()
  expect(read()).toMatchObject({ stage: 'shell construction', shellPid: null, tail: '' })
  expect(ps).not.toHaveBeenCalled()
})
