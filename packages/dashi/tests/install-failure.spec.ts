import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { expect, it, onTestFinished, vi } from 'vitest'
import { isExpectedInstallOutcome, readInstallDescriptors, recordInstallFailure, recordInstallTimeout, runInstallCommand } from './install-failure.js'

function liveGroupScript(file: string, openFile: string, childPid: string, childScript: string): string {
  return `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(file)}, 'pnpm finished; command alive\\n');
    const fd = fs.openSync(${JSON.stringify(openFile)}, 'r');
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' });
    fs.writeFileSync(${JSON.stringify(childPid)}, String(child.pid));
    process.once('SIGTERM', () => {
      fs.appendFileSync(${JSON.stringify(file)}, 'terminated\\n');
      const exit = () => process.exit(0);
      if (child.exitCode !== null || child.signalCode !== null) setImmediate(exit);
      else child.once('close', exit);
    });
    setInterval(() => {}, 1000)`
}

it.each(['child first', 'TERM first'])('the receipt fixture has one ordered exit: %s (simulated callback order)', order => {
  const child = Object.assign(new EventEmitter(), { pid: 2, exitCode: null as number | null, signalCode: null as NodeJS.Signals | null })
  const immediate: (() => void)[] = []
  const files = new Map<string, string>()
  const leader = Object.assign(new EventEmitter(), { execPath: '/fixture/node', exit: vi.fn(() => {
    expect(files.get('/log')).toBe('pnpm finished; command alive\nterminated\n')
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }) })
  const fs = { writeFileSync: (path: string, text: string) => files.set(path, text), openSync: () => 0,
    appendFileSync: (path: string, text: string) => files.set(path, files.get(path)! + text) }
  runInNewContext(liveGroupScript('/log', '/descriptor', '/pid', ''), {
    require: (name: string) => name === 'node:fs' ? fs : { spawn: () => child }, process: leader,
    setImmediate: (callback: () => void) => immediate.push(callback), setInterval: () => 0,
  })
  if (order === 'child first') {
    child.exitCode = 0
    child.emit('close')
    expect(leader.exit).not.toHaveBeenCalled()
    expect(files.get('/log')).toBe('pnpm finished; command alive\n')
  }
  leader.emit('SIGTERM')
  expect(files.get('/log')).toBe('pnpm finished; command alive\nterminated\n')
  expect(leader.exit).not.toHaveBeenCalled()
  if (order === 'TERM first') {
    immediate.forEach(callback => callback())
    expect(leader.exit).not.toHaveBeenCalled()
    child.signalCode = 'SIGTERM'
    child.emit('close')
  }
  immediate.forEach(callback => callback())
  expect(leader.exit).toHaveBeenCalledExactlyOnceWith(0)
})

it('accepts only the requested exit outcome using the literal truth table', () => {
  const expectations = [true, false, 0, 1, 7] as const
  const outcomes = [
    { label: 'exit 0', result: { status: 0 }, expected: [true, false, true, false, false] },
    { label: 'exit 1', result: { status: 1 }, expected: [false, true, false, true, false] },
    { label: 'exit 7', result: { status: 7 }, expected: [false, true, false, false, true] },
    { label: 'signal', result: { status: null }, expected: [false, false, false, false, false] },
    { label: 'timeout', result: { status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) },
      expected: [false, false, false, false, false] },
    { label: 'spawn error', result: { status: null, error: Object.assign(new Error('spawn'), { code: 'ENOENT' }) },
      expected: [false, false, false, false, false] },
    { label: 'ENOBUFS', result: { status: null, error: Object.assign(new Error('buffer'), { code: 'ENOBUFS' }) },
      expected: [false, false, false, false, false] },
    { label: 'error despite exit 0', result: { status: 0, error: new Error('error despite exit 0') },
      expected: [false, false, false, false, false] },
  ]
  for (const outcome of outcomes) for (const [index, success] of expectations.entries()) {
    expect(isExpectedInstallOutcome(outcome.result, success), outcome.label + ' expected ' + success)
      .toBe(outcome.expected[index])
  }
})

it('preserves successful and nonzero command outcomes without timeout diagnostics', async () => {
  const onTimeout = vi.fn()
  for (const status of [0, 7]) {
    const result = await runInstallCommand({ command: process.execPath,
      args: ['-e', `console.log('ordered output'); process.exit(${status})`],
      cwd: tmpdir(), env: process.env, timeoutMs: 5_000, onTimeout })
    expect(result.status).toBe(status)
    expect(result.stdout).toBe('ordered output\n')
    expect(result.timedOut).toBe(false)
    expect(result.error).toBeUndefined()
  }
  expect(onTimeout).not.toHaveBeenCalled()
})

it('captures the live command group, descriptor names and operation log before termination; a late exit remains a timeout', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-install-timeout-'))
  let leader: number | undefined, child: number | undefined
  onTestFinished(context => {
    let cleaned = false
    try {
      if (leader !== undefined) {
        try { process.kill(-leader, 'SIGKILL') }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error }
      }
      cleaned = true
    } finally {
      if (context.task.result?.state === 'pass' && cleaned) rmSync(evidence, { recursive: true, force: true })
      else console.error('install test evidence retained: ' + evidence)
    }
  })
  {
    const nativeHome = join(evidence, 'native')
    const logs = join(nativeHome, 'profiles', 'dashi', '.plugin-manager', 'logs', 'operation-control')
    mkdirSync(logs, { recursive: true })
    const file = join(logs, 'pnpm.log')
    const childPid = join(evidence, 'child.pid')
    const ready = join(evidence, 'descriptor-ready')
    writeFileSync(join(evidence, 'open-descriptor-control'), 'descriptor contents must not be captured')
    const openFile = realpathSync(join(evidence, 'open-descriptor-control'))
    const childScript = `const fs = require('node:fs'); const fd = fs.openSync(${JSON.stringify(openFile)}, 'r');
      fs.writeFileSync(${JSON.stringify(ready)}, String(fd)); setInterval(() => {}, 1000)`
    const script = liveGroupScript(file, openFile, childPid, childScript)
    let capture: string | undefined
    const result = await runInstallCommand({ command: process.execPath, args: ['-e', script],
      cwd: evidence, env: process.env, timeoutMs: 1_000,
      onTimeout: pid => {
        leader = pid
        child = Number(readFileSync(childPid, 'utf8'))
        expect(Number(readFileSync(ready, 'utf8'))).toBeGreaterThanOrEqual(0)
        expect(Number.isInteger(child) && child > 0).toBe(true)
        expect(() => { process.kill(child!, 0) }).not.toThrow()
        expect(() => { process.kill(pid, 0) }).not.toThrow()
        capture = recordInstallTimeout({ pid, command: process.execPath,
          args: ['plugin', '--profile', 'dashi', 'add', 'example'],
          env: { DSH_HOME: nativeHome }, evidence })
      },
    })
    expect(result.timedOut).toBe(true)
    expect(result.status).toBeNull()
    expect(result.error).toMatchObject({ code: 'ETIMEDOUT' })
    expect(capture).toBeDefined()
    const record = JSON.parse(readFileSync(join(capture!, 'timeout.json'), 'utf8'))
    expect(record.processGroup.value).toContain(String(record.pid))
    expect(record.processGroup.value).toContain(process.execPath)
    const rows = (record.processGroup.value as string).split('\n').map(row => row.trim().split(/\s+/u))
    const leaderRow = rows.find(row => Number(row[0]) === record.pid)
    const childRow = rows.find(row => Number(row[0]) === child)
    expect(leaderRow?.slice(0, 3).map(Number)).toEqual([record.pid, process.pid, record.pid])
    expect(child).not.toBe(record.pid)
    expect(childRow?.slice(0, 3).map(Number)).toEqual([child, record.pid, record.pid])
    expect(record.descriptors.map((entry: { pid: number }) => entry.pid).sort((a: number, b: number) => a - b))
      .toEqual([record.pid, child].sort((a, b) => a! - b!))
    for (const entry of record.descriptors) {
      expect(entry.observation.error).toBeUndefined()
      expect(JSON.stringify(entry.observation.value)).toContain(openFile)
      expect(JSON.stringify(entry.observation.value)).not.toContain('descriptor contents must not be captured')
    }
    expect(record.logs.value.copied).toBe(true)
    expect(readFileSync(join(capture!, 'plugin-manager-logs', 'operation-control', 'pnpm.log'), 'utf8'))
      .toBe('pnpm finished; command alive\n')
    expect(readFileSync(file, 'utf8')).toContain('terminated')
    await vi.waitFor(() => {
      expect(() => { process.kill(record.pid, 0) }).toThrow()
      expect(() => { process.kill(child!, 0) }).toThrow()
    }, { timeout: 500, interval: 10 })
  }
})

it('reports a vanished owned process as a descriptor read error, not an empty successful snapshot', async () => {
  const result = await runInstallCommand({ command: process.execPath,
    args: ['-e', 'console.log(process.pid)'], cwd: tmpdir(), env: process.env,
    timeoutMs: 5_000, onTimeout: () => { throw new Error('unexpected timeout') } })
  expect(result.status).toBe(0)
  const pid = Number(result.stdout.trim())
  expect(Number.isInteger(pid) && pid > 0 && pid !== process.pid).toBe(true)
  const record = readInstallDescriptors(pid, pid)
  expect(record).not.toHaveProperty('value')
  if (process.platform === 'darwin') expect(record).toMatchObject({ error: expect.stringMatching(/^lsof exited 1:/u) })
  else expect(record).toMatchObject({ code: 'ENOENT' })
})

it('KILL bounds a ps diagnostic that ignores TERM', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-diagnostic-ps-'))
  const path = process.env.PATH
  try {
    writeFileSync(join(evidence, 'ps'), `#!${process.execPath}\nprocess.on('SIGTERM', () => {}); setTimeout(() => {}, 8000)\n`)
    chmodSync(join(evidence, 'ps'), 0o755)
    process.env.PATH = evidence + ':' + (path ?? '')
    const started = performance.now()
    const capture = recordInstallTimeout({ pid: process.pid, command: 'control', args: [], env: {}, evidence })
    const elapsed = performance.now() - started
    const record = JSON.parse(readFileSync(join(capture, 'timeout.json'), 'utf8'))
    expect(record.processGroup).toMatchObject({ code: 'ETIMEDOUT' })
    expect(elapsed).toBeLessThan(7_000)
  } finally {
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
    rmSync(evidence, { recursive: true, force: true })
  }
}, 10_000)

it('persists the tree before a TERM-ignoring lsof diagnostic and KILLs it at its own bound', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-diagnostic-lsof-'))
  const path = process.env.PATH
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  const observed = join(evidence, 'tree-observed.json')
  const tree = `${process.pid} ${process.ppid} ${process.pid} S control`
  try {
    writeFileSync(join(evidence, 'ps'), `#!${process.execPath}\nconsole.log(${JSON.stringify(tree)})\n`)
    writeFileSync(join(evidence, 'lsof'), `#!${process.execPath}\nconst fs = require('node:fs');
      const directory = fs.readdirSync(${JSON.stringify(evidence)}).find(name => name.startsWith('install-failure-'));
      fs.copyFileSync(${JSON.stringify(evidence)} + '/' + directory + '/timeout.json', ${JSON.stringify(observed)});
      process.on('SIGTERM', () => {}); setTimeout(() => {}, 8000)\n`)
    chmodSync(join(evidence, 'ps'), 0o755)
    chmodSync(join(evidence, 'lsof'), 0o755)
    process.env.PATH = evidence + ':' + (path ?? '')
    // Exercise the Darwin-only collector on either runner, with fixture-owned executables.
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    const started = performance.now()
    const capture = recordInstallTimeout({ pid: process.pid, command: 'control', args: [], env: {}, evidence })
    const elapsed = performance.now() - started
    const early = JSON.parse(readFileSync(observed, 'utf8'))
    const complete = JSON.parse(readFileSync(join(capture, 'timeout.json'), 'utf8'))
    expect(early.processGroup.value).toBe(tree)
    expect(early).not.toHaveProperty('descriptors')
    expect(complete.processGroup).toEqual(early.processGroup)
    expect(complete.capturedAt).toBe(early.capturedAt)
    expect(complete.descriptors[0].observation).toMatchObject({ code: 'ETIMEDOUT' })
    expect(elapsed).toBeLessThan(4_000)
  } finally {
    Object.defineProperty(process, 'platform', platform)
    if (path === undefined) delete process.env.PATH
    else process.env.PATH = path
    rmSync(evidence, { recursive: true, force: true })
  }
})

it('KILL escalation removes an owned group member that ignores TERM', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-install-kill-'))
  const file = join(evidence, 'ready.log')
  let pid: number | undefined, readyAtDeadline = false
  try {
    const script = `const fs = require('node:fs');
      process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(file)}, 'ignored TERM\\n') });
      fs.writeFileSync(${JSON.stringify(file)}, 'ready\\n'); setInterval(() => {}, 1000)`
    const result = await runInstallCommand({ command: process.execPath, args: ['-e', script],
      cwd: evidence, env: process.env, timeoutMs: 1_000,
      onTimeout: current => {
        pid = current
        expect(readFileSync(file, 'utf8')).toBe('ready\n')
        readyAtDeadline = true
      },
    })
    expect(readyAtDeadline).toBe(true)
    expect(result.timedOut).toBe(true)
    expect(result.status).toBeNull()
    expect(result.error).toMatchObject({ code: 'ETIMEDOUT' })
    expect(readFileSync(file, 'utf8')).toContain('ignored TERM')
    await vi.waitFor(() => { expect(() => { process.kill(pid!, 0) }).toThrow() }, { timeout: 500, interval: 10 })
  } finally {
    if (pid !== undefined) {
      try { process.kill(-pid, 'SIGKILL') }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') console.error('install test cleanup failed: ' + String(error)) }
    }
    rmSync(evidence, { recursive: true, force: true })
  }
})

it('keeps the former output-buffer limit fatal without invoking timeout capture', async () => {
  const onTimeout = vi.fn()
  const result = await runInstallCommand({ command: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(700000)); process.stderr.write("y".repeat(700000))'],
    cwd: tmpdir(), env: process.env, timeoutMs: 5_000, onTimeout })
  expect(result.status).toBeNull()
  expect(result.error).toMatchObject({ code: 'ENOBUFS' })
  expect(result.timedOut).toBe(false)
  expect(onTimeout).not.toHaveBeenCalled()
})

it('a failed pre-kill capture is reported and cannot make the timed-out command pass', async () => {
  const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    const result = await runInstallCommand({ command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000)'], cwd: tmpdir(), env: process.env, timeoutMs: 100,
      onTimeout: () => { throw new Error('capture control') },
    })
    expect(result.status).toBeNull()
    expect(result.error).toMatchObject({ code: 'ETIMEDOUT' })
    expect(logged).toHaveBeenCalledWith('install timeout capture failed: Error: capture control')
  } finally { logged.mockRestore() }
})

it('captures a missing install path and its parents without changing the failed command outcome', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-install-failure-'))
  try {
    const project = join(evidence, 'project')
    mkdirSync(project)
    const pm = join(evidence, 'pnpm')
    writeFileSync(pm, `#!${process.execPath}\nconsole.log(${JSON.stringify(join(evidence, 'private-store'))})\n`)
    chmodSync(pm, 0o755)
    const path = join(project, 'missing', 'package.json')
    for (const syscall of ['open', 'readlink', 'lstat', 'stat', 'rename', 'unlink', 'rmdir', 'mkdir',
      'symlink', 'copyfile', 'scandir', 'future_syscall']) {
      const capture = recordInstallFailure({ command: 'pnpm', args: ['add', 'example'], cwd: project,
        env: process.env, evidence, pnpm: pm, output: `EINVAL: invalid argument, ${syscall} '${path}'`, status: 234 })
      const record = JSON.parse(readFileSync(join(capture, 'failure.json'), 'utf8'))
      expect(record.status).toBe(234)
      expect(record.path).toBe(path)
      expect(record.paths[0].lstat.code).toBe('ENOENT')
      expect(record.paths[0].read.code).toBe('ENOENT')
      expect(record.paths.at(-1).path).toBe('/')
      expect(record.store.value).toBe(join(evidence, 'private-store'))
      expect(record.debug.every((file: { absent: boolean }) => file.absent)).toBe(true)
    }
  } finally { rmSync(evidence, { recursive: true, force: true }) }
})

it('reports failed diagnostic reads and redacts install-log credentials without claiming a successful store query', () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-install-failure-'))
  try {
    writeFileSync(join(evidence, 'pnpm-debug.log'), 'package import failed\n_authToken=private-value\npassword=other-private-value\n')
    const capture = recordInstallFailure({ command: 'pnpm', args: ['add', 'example'], cwd: evidence,
      env: process.env, evidence, pnpm: join(evidence, 'missing-pnpm'),
      output: 'install failed\nA complete log of this run can be found in: ' + join(evidence, 'pnpm-debug.log'), status: 1 })
    const record = JSON.parse(readFileSync(join(capture, 'failure.json'), 'utf8'))
    expect(record.store.code).toBe('ENOENT')
    expect(record.path).toBeNull()
    expect(record.status).toBe(1)
    expect(record.debug.filter((file: { source: string }) => file.source.endsWith('pnpm-debug.log'))).toHaveLength(1)
    const log = readFileSync(join(capture, 'pnpm-debug.log'), 'utf8')
    expect(log).toContain('package import failed')
    expect(log).toContain('_authToken=[redacted]')
    expect(log).not.toContain('private-value')
  } finally { rmSync(evidence, { recursive: true, force: true }) }
})
