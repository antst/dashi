import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { recordInstallFailure } from './install-failure.js'

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
