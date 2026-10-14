import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest'
import { startTestDaemon, connectTestObserver } from './sessionbus-harness.js'
import { MultiplexerPane } from './multiplexer.js'
import { pruneInstallLayout } from './install-layout-cleanup.js'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), probe: vi.fn(), command: vi.fn(), connect: vi.fn() }))
vi.mock('node:child_process', async original => ({
  ...await original<typeof import('node:child_process')>(),
  spawn: mocks.spawn, spawnSync: mocks.probe, execFileSync: mocks.command,
}))
vi.mock('node:module', async original => ({
  ...await original<typeof import('node:module')>(), createRequire: () => () => ({ connectPeer: mocks.connect }),
}))

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dashi-scratch-control-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  writeFileSync(join(root, 'daemon'), '')
  vi.stubEnv('SESSIONBUS_DAEMON_BIN', join(root, 'daemon'))
  vi.stubEnv('CI', '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); Object.values(mocks).forEach(mock => mock.mockReset()) })

function daemon(mode: 'ready' | 'exit' | 'error' | 'never' | 'stuck') {
  let directory = ''
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() })
  mocks.spawn.mockImplementation((_binary: string, args: string[]) => {
    const socket = args[args.indexOf('-socket') + 1]!
    directory = dirname(socket)
    onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
    queueMicrotask(() => {
      if (mode === 'ready' || mode === 'stuck') writeFileSync(socket, '')
      if (mode === 'exit') child.emit('exit', 1, null)
      if (mode === 'error') { child.emit('error', new Error('spawn refused')); child.emit('close', -1, null) }
    })
    child.kill.mockImplementation(() => {
      expect(existsSync(directory)).toBe(true) // never unlink a live resource
      if (mode !== 'stuck') queueMicrotask(() => child.emit('exit', null, 'SIGTERM'))
      return true
    })
    return child
  })
  return { child, directory: () => directory }
}

it('normal owned daemon close settles before removal, and repeated close is harmless', async () => {
  const control = daemon('ready')
  const owned = await startTestDaemon()
  await owned.close()
  await owned.close()
  expect(control.child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  expect(existsSync(control.directory())).toBe(false)
})

it.each(['exit', 'error'] as const)('failed daemon admission (%s) removes only its settled directory', async mode => {
  const control = daemon(mode)
  await expect(startTestDaemon()).rejects.toThrow('before ready')
  expect(existsSync(control.directory())).toBe(false)
  expect(control.child.kill).not.toHaveBeenCalled()
})

it('readiness timeout still has an owner that terminates before unlink', async () => {
  const control = daemon('never')
  let calls = 0
  vi.spyOn(Date, 'now').mockImplementation(() => calls++ === 0 ? 0 : calls === 2 ? 20_001 : 20_002)
  await expect(startTestDaemon()).rejects.toThrow('did not create')
  expect(control.child.kill).toHaveBeenCalledExactlyOnceWith('SIGTERM')
  expect(existsSync(control.directory())).toBe(false)
})

it('an uncertain daemon stop retains and names its directory', async () => {
  const control = daemon('stuck')
  const owned = await startTestDaemon()
  let clock = 0
  vi.spyOn(Date, 'now').mockImplementation(() => { clock += 20_001; return clock })
  await expect(owned.close()).rejects.toThrow('retained owned directory ' + control.directory())
  expect(existsSync(control.directory())).toBe(true)
})

it('rejected observer readiness shuts down the owned peer before returning the rejection', async () => {
  let closed = false
  const shutdown = vi.fn(() => { closed = true })
  mocks.connect.mockReturnValue({ ready: Promise.reject(new Error('refused')), shutdown,
    get closed() { expect(closed).toBe(true); return Promise.resolve() } })
  await expect(connectTestObserver('/private/socket', 'group', 'observer')).rejects.toThrow('refused')
  expect(shutdown).toHaveBeenCalledTimes(1)
})

function screen(mode: 'ready' | 'start refused' | 'partial' | 'stuck') {
  const binary = join(root, 'screen')
  writeFileSync(binary, '')
  chmodSync(binary, 0o755)
  vi.stubEnv('PATH', root)
  const decoy = join(root, 'decoy-screen')
  mkdirSync(decoy); writeFileSync(join(decoy, 'socket'), 'unrelated')
  let directory = ''
  mocks.command.mockImplementation((_binary: string, _args: string[], options: { env: NodeJS.ProcessEnv }) => {
    directory = options.env.SCREENDIR!
    onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
    if (mode === 'start refused') throw new Error('start refused')
    writeFileSync(join(directory, 'owned-socket'), '')
    return ''
  })
  mocks.probe.mockImplementation((_binary: string, args: string[], options?: { env: NodeJS.ProcessEnv }) => {
    if (args.includes('--version')) return { status: 0, stdout: 'Screen version 5.0.0' }
    if (args.includes('quit')) {
      expect(options?.env.SCREENDIR).toBe(directory)
      expect(existsSync(directory)).toBe(true)
      if (mode !== 'stuck') rmSync(join(directory, 'owned-socket'), { force: true })
      return { status: 0 }
    }
    return { status: mode === 'ready' || mode === 'stuck' ? 0 : 1, stderr: 'not ready' }
  })
  return { directory: () => directory, decoy }
}

it.each(['ready', 'start refused', 'partial'] as const)('screen ownership covers %s and leaves a decoy intact', mode => {
  const control = screen(mode)
  if (mode === 'partial') vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(10_001).mockReturnValue(10_002)
  if (mode === 'ready') {
    const pane = new MultiplexerPane('screen', root, root, {})
    pane.close(); pane.close()
  } else expect(() => new MultiplexerPane('screen', root, root, {})).toThrow(mode === 'partial' ? 'did not become ready' : 'start refused')
  expect(existsSync(control.directory())).toBe(false)
  expect(existsSync(join(control.decoy, 'socket'))).toBe(true)
  expect(mocks.probe.mock.calls.filter(([, args]) => args.includes('quit'))).toHaveLength(1)
})

it('screen stop uncertainty keeps the private socket and names it', () => {
  const control = screen('stuck')
  const pane = new MultiplexerPane('screen', root, root, {})
  let clock = 0
  vi.spyOn(Date, 'now').mockImplementation(() => { clock += 10_001; return clock })
  expect(() => pane.close()).toThrow('retained owned directory ' + control.directory())
  expect(existsSync(join(control.directory(), 'owned-socket'))).toBe(true)
})

it('success pruning removes large owned children only; logs, evidence, decoys and symlink targets survive', () => {
  const large = ['user', 'project', 'tools', 'npm-global', 'pnpm-global', 'global-bin', 'candidate', 'npm-cache',
    'native-fresh', 'project-fresh', 'native-0.2.0-alpha.1', 'project-0.2.0-alpha.1', 'native-0.2.0-alpha.2', 'project-0.2.0-alpha.2']
  for (const name of [...large, 'install-failure-control', 'unowned']) {
    mkdirSync(join(root, name)); writeFileSync(join(root, name, 'marker'), name)
  }
  const files = ['commands.log', 'runtime.json', 'pty.log', 'session.jsonl', 'hashes.json', 'build-control.json', 'result.json']
  files.forEach(name => writeFileSync(join(root, name), name))
  symlinkSync(join(root, 'unowned'), join(root, 'native-link'), 'dir')
  pruneInstallLayout(root)
  expect(readdirSync(root).sort()).toEqual([...files, 'daemon', 'install-failure-control', 'native-link', 'unowned'].sort())
  expect(existsSync(join(root, 'unowned', 'marker'))).toBe(true)
})
