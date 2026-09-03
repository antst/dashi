import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { provideCmdline, type AppReady } from '@deepseek-ai/dsh-cmdline'

const shell = vi.hoisted(() => ({
  dispatch: vi.fn(),
  dispose: vi.fn(async () => {}),
  start: vi.fn(),
}))
const runtime = vi.hoisted(() => ({
  initialCells: [],
  interrupt: vi.fn(),
  root: { cwd: '/work', id: 'session-fixture', model: 'model', status: 'idle' as const },
  shutdown: vi.fn(async () => {}),
  start: vi.fn(),
  submit: vi.fn(),
  summary: 'Resume with: fixture',
}))
vi.mock('../src/application.js', () => ({ createTerminalShell: vi.fn(() => shell) }))
vi.mock('../src/session-runtime.js', () => ({ createSessionRuntime: vi.fn(async () => runtime) }))

import { apply } from '../src/index.js'

afterEach(() => {
  vi.restoreAllMocks()
  shell.dispose.mockClear()
  shell.dispatch.mockClear()
  shell.start.mockClear()
  runtime.shutdown.mockClear()
  runtime.start.mockClear()
})

describe('dashi profile plugin', () => {
  it.each([
    [['--help'], 'Usage: dashi [options] [prompt]', '--permission PRESET'],
    [['-h'], 'Usage: dashi [options] [prompt]', '--permission PRESET'],
  ])('prints one-shot launcher information for %s', (args, first, second) => {
    const exits: number[] = []
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const ctx = new Context()
    provideCmdline(ctx, { args, exit: code => { exits.push(code) }, ready: { onReady: () => () => {} } })

    apply(ctx)
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining(first))
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining(second))
    expect(exits).toEqual([0])
    expect(shell.start).not.toHaveBeenCalled()
  })

  it('warns when the CLI and loaded dsh-base versions differ', async () => {
    const fixture = mkdtempSync(join(tmpdir(), 'dashi-dsh-version-'))
    const cli = join(fixture, 'node_modules', '@deepseek-ai', 'dsh')
    const base = join(fixture, 'node_modules', '@deepseek-ai', 'dsh-base')
    mkdirSync(join(cli, 'bin'), { recursive: true })
    mkdirSync(base, { recursive: true })
    writeFileSync(join(cli, 'bin', 'dsh.js'), '')
    writeFileSync(join(cli, 'package.json'), '{"version":"0.1.2-alpha.5"}\n')
    writeFileSync(join(base, 'package.json'), '{"version":"0.1.2-rc.1"}\n')
    const entry = process.argv[1] ?? ''
    let announce = (): void => {}
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const ctx = new Context()
    provideCmdline(ctx, {
      args: [], exit: () => {},
      ready: { onReady(listener) { announce = listener; return () => { announce = (): void => {} } } },
    })

    try {
      process.argv[1] = join(cli, 'bin', 'dsh.js')
      apply(ctx)
      announce()
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(
        'DSH 0.1.2-alpha.5 loads @deepseek-ai/dsh-base 0.1.2-rc.1; versions must match',
      ))
      await ctx.fiber.dispose()
    } finally {
      process.argv[1] = entry
      rmSync(fixture, { recursive: true, force: true })
    }
  })

  it('acquires the terminal only after startup commits and releases it with the root', async () => {
    let announce = (): void => {}
    const ready: AppReady = {
      onReady(listener) {
        announce = listener
        return () => { announce = (): void => {} }
      },
    }
    const exits: number[] = []
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const ctx = new Context()
    provideCmdline(ctx, { args: ['--inline'], exit: code => { exits.push(code) }, ready })

    apply(ctx)
    expect(shell.start).not.toHaveBeenCalled()
    announce()
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('DSH unknown is not validated'))
    await vi.waitFor(() => { expect(shell.start).toHaveBeenCalledOnce() })
    expect(runtime.start).toHaveBeenCalledOnce()
    expect(exits).toEqual([])

    await ctx.fiber.dispose()
    expect(shell.dispose).toHaveBeenCalledOnce()
    expect(runtime.shutdown).toHaveBeenCalledOnce()
  })

  it.each([
    ['--wat'],
    ['--provider', 'deepseek-official'],
  ])('rejects unsupported launch arguments without taking the terminal: %s', (...args) => {
    const exits: number[] = []
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const ctx = new Context()
    provideCmdline(ctx, {
      args, exit: code => { exits.push(code) },
      ready: { onReady: () => () => {} },
    })

    apply(ctx)
    expect(write).toHaveBeenCalledWith(`dashi: unsupported arguments: ${args.join(' ')}\n`)
    expect(exits).toEqual([2])
    expect(shell.start).not.toHaveBeenCalled()
  })

  it('lists sessions after readiness and exits without constructing the terminal stack', async () => {
    let announce = (): void => {}
    const exits: number[] = []
    const list = vi.fn(async () => ({ items: [{
      blank: false, cwd: '/work', running: false,
      sessionId: 'session-list' as never, updatedAt: 1_800_000_000_000,
    }] }))
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const ctx = new Context()
    ctx.provide('sessionController', { list } as never)
    provideCmdline(ctx, {
      args: ['sessions', 'list', '--all', '--json'], exit: code => { exits.push(code) },
      ready: { onReady(listener) { announce = listener; return () => { announce = (): void => {} } } },
    })

    apply(ctx)
    announce()
    await vi.waitFor(() => { expect(exits).toEqual([0]) })
    expect(list).toHaveBeenCalledOnce()
    expect(stdout).toHaveBeenCalledOnce()
    expect(stdout.mock.calls[0]?.[0]).toContain('"sessionId": "session-list"')
    expect(shell.start).not.toHaveBeenCalled()
    await ctx.fiber.dispose()
  })

  it('requires all launcher lifecycle services', () => {
    expect(() => { apply(new Context()) }).toThrow('ctx.appExit, ctx.appReady, and ctx.cmdlineArgs')
  })
})
