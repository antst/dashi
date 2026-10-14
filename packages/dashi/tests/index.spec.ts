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
import { createTerminalShell } from '../src/application.js'

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

  it('acquires the terminal only after startup commits and releases it with the root', async () => {
    let announce = (): void => {}
    const ready: AppReady = {
      onReady(listener) {
        announce = listener
        return () => { announce = (): void => {} }
      },
    }
    const exits: number[] = []
    const ctx = new Context()
    provideCmdline(ctx, { args: ['--inline'], exit: code => { exits.push(code) }, ready })

    apply(ctx)
    expect(shell.start).not.toHaveBeenCalled()
    announce()
    await vi.waitFor(() => { expect(shell.start).toHaveBeenCalledOnce() })
    expect(runtime.start).toHaveBeenCalledOnce()
    expect(exits).toEqual([])

    await ctx.fiber.dispose()
    expect(shell.dispose).toHaveBeenCalledOnce()
    expect(runtime.shutdown).toHaveBeenCalledOnce()
  })

  it('releases the shell and prints the resume summary when native shutdown rejects', async () => {
    let announce = (): void => {}
    const ctx = new Context()
    provideCmdline(ctx, {
      args: ['--inline'], exit: vi.fn(),
      ready: { onReady(listener) { announce = listener; return () => {} } },
    })
    const effects = vi.spyOn(ctx, 'effect')
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const previousErrors = process.stdout.listeners('error') as ((error: Error) => void)[]
    const error = new Error('native flush failed')
    try {
      apply(ctx)
      announce()
      await vi.waitFor(() => { expect(shell.start).toHaveBeenCalledOnce() })
      runtime.shutdown.mockRejectedValueOnce(error)
      shell.dispose.mockImplementationOnce(async () => {
        vi.mocked(createTerminalShell).mock.calls.at(-1)?.[0].onReleased?.()
      })
      const index = effects.mock.calls.findIndex(([, label]) => label === 'dashi.profile-boot')
      expect(index).toBeGreaterThanOrEqual(0)
      await expect(effects.mock.results[index]?.value()).rejects.toBe(error)
      expect(runtime.shutdown).toHaveBeenCalledOnce()
      expect(shell.dispose).toHaveBeenCalledOnce()
      expect(stdout).toHaveBeenCalledWith(`${runtime.summary}\n`)
    } finally {
      for (const listener of process.stdout.listeners('error') as ((error: Error) => void)[]) {
        if (!previousErrors.includes(listener)) process.stdout.off('error', listener)
      }
      await ctx.fiber.dispose()
    }
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
