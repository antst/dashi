import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { recordInstallFailure, recordInstallTimeout, runInstallCommand } from './install-failure.js'

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

it('captures the live command group and operation log before termination; a late exit remains a timeout', async () => {
  const evidence = mkdtempSync(join(tmpdir(), 'dashi-install-timeout-'))
  try {
    const nativeHome = join(evidence, 'native')
    const logs = join(nativeHome, 'profiles', 'dashi', '.plugin-manager', 'logs', 'operation-control')
    mkdirSync(logs, { recursive: true })
    const file = join(logs, 'pnpm.log')
    const script = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(file)}, 'pnpm finished; command alive\\n');
      require('node:child_process').spawn(process.execPath, ['-e', 'process.title = "W130_GROUP_CHILD"; setInterval(() => {}, 1000)']);
      process.on('SIGTERM', () => { fs.appendFileSync(${JSON.stringify(file)}, 'terminated\\n'); process.exit(0) });
      setInterval(() => {}, 1000)`
    let capture: string | undefined
    const result = await runInstallCommand({ command: process.execPath, args: ['-e', script],
      cwd: evidence, env: process.env, timeoutMs: 1_000,
      onTimeout: pid => {
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
    expect(record.processGroup.value).toContain('W130_GROUP_CHILD')
    expect(record.logs.value.copied).toBe(true)
    expect(readFileSync(join(capture!, 'plugin-manager-logs', 'operation-control', 'pnpm.log'), 'utf8'))
      .toBe('pnpm finished; command alive\n')
    expect(readFileSync(file, 'utf8')).toContain('terminated')
    expect(() => { process.kill(record.pid, 0) }).toThrow()
  } finally { rmSync(evidence, { recursive: true, force: true }) }
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
    const capture = recordInstallFailure({ command: 'pnpm', args: ['add', 'example'], cwd: project,
      env: process.env, evidence, pnpm: pm, output: `EINVAL: invalid argument, open '${path}'`, status: 234 })
    const record = JSON.parse(readFileSync(join(capture, 'failure.json'), 'utf8'))
    expect(record.status).toBe(234)
    expect(record.path).toBe(path)
    expect(record.paths[0].lstat.code).toBe('ENOENT')
    expect(record.paths[0].read.code).toBe('ENOENT')
    expect(record.paths.at(-1).path).toBe('/')
    expect(record.store.value).toBe(join(evidence, 'private-store'))
    expect(record.debug.every((file: { absent: boolean }) => file.absent)).toBe(true)
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
