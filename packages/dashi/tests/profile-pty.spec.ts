import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pty from 'node-pty'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MultiplexerPane, type MultiplexerKind } from './multiplexer.js'
import { testCeiling } from './test-budget.js'
import { countAudibleBells } from './terminal-output.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const dsh = join(root, 'node_modules', '.bin', 'dsh')
const dashiLauncher = join(root, 'packages', 'dashi-launcher', 'bin', 'dashi.js')
const failureFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'effect-failure.mjs')
const replayFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'replay-session.jsonl')
const inlineScrollFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'inline-scroll-session.jsonl')
const threeTurnFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'three-turn-session.jsonl')
const rewindSteerFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'rewind-steer-session.jsonl')
const rollerFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'roller-three-turn-session.jsonl')
const questionFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'question-session.jsonl')
const presentationFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'presentation-session.jsonl')
const tasksFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'tasks-session.jsonl')
const contextInjectionFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'context-injection-session.jsonl')
const presentationChildFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'presentation-child-session.jsonl')
const requestContextFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'request-context-session.jsonl')
const longTurnFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'long-turn-session.jsonl')
const questionPlugin = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'question-plugin')
const pluginManagementFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'plugin-management')
const replayPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'replay.patch.yml')
const modelCatalogPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'model-catalog.patch.yml')
const cleanReplayPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'clean-replay.patch.yml')
const dshVersionMismatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'dsh-version-mismatch.yaml')
const sessionListPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'session-list.patch.yml')
const fakeEditor = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'fake-editor.mjs')
const [validatedDshVersion] = JSON.parse(readFileSync(
  join(root, 'packages', 'dashi', 'validated-dsh-versions.json'), 'utf8',
)) as [string]
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
// pi-tui 0.84.4 dist/stdin-buffer.js:22 holds a lone Escape for 10 ms.
// Leave ample PTY scheduling margin so two Escape keys cannot become one Alt sequence.
const separateEscapeKeysMs = 200
let testDir = ''
let home = ''
let hardeningCwd = ''
let hardeningHome = ''
let launchFlagsHome = ''
let pluginHome = ''

function reportPerformance(name: string, value: number, unit: string): void {
  process.stdout.write(`performance: ${name} ${value.toFixed(2)} ${unit}\n`)
}

function run(command: string, args: string[], env = process.env, cwd = root): string {
  try {
    return execFileSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000 })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`${command} ${args.join(' ')} failed\n${failed.stdout ?? ''}${failed.stderr ?? ''}`)
  }
}

function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function packWorkspacePackage(directory: string, destination: string): string {
  const before = new Set(readdirSync(destination))
  run('pnpm', ['pack', '--pack-destination', destination], process.env, directory)
  const archive = readdirSync(destination).find(file => file.endsWith('.tgz') && !before.has(file))
  if (archive === undefined) throw new Error(`Packing ${directory} did not produce an archive`)
  return join(destination, archive)
}

function assertResolvedDshGraph(lockfile: string, expected: string): number {
  const packageSection = lockfile.split('\nsnapshots:\n', 1)[0] ?? ''
  const resolved = [...packageSection.matchAll(/^  '?(@deepseek-ai\/dsh[^@']*)@([^':]+)'?:$/gm)]
    .map(([, name, version]) => `${name ?? 'unknown'}@${version ?? 'unknown'}`)
  if (resolved.length === 0) throw new Error('resolved graph contains no DSH packages')
  const mismatches = resolved.filter(value => !value.endsWith(`@${expected}`))
  if (mismatches.length > 0) throw new Error(`resolved DSH version mismatch: ${mismatches.join(', ')}`)
  return resolved.length
}

class PtyShell {
  readonly process: pty.IPty
  output = ''
  private readonly exited: Promise<number>

  constructor(snapshot = replayFixture, rootEvents?: string, cwd = root, extraEnv: NodeJS.ProcessEnv = {}) {
    const env = {
      ...process.env,
      DSH_HOME: home,
      DSH_SNAPSHOT_FILE: snapshot,
      DSH_TELEMETRY_DISABLED: '1',
      ...(rootEvents === undefined ? {} : { DSH_DASHI_ROOT_EVENTS: rootEvents }),
      NO_COLOR: '1',
      PROMPT_COMMAND: '',
      PS1: '',
      TERM: 'xterm-256color',
      ...extraEnv,
    }
    this.process = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-i'], {
      cols: 80, rows: 24, cwd, env,
    })
    this.process.onData(data => { this.output += data })
    this.exited = new Promise(resolveExit => {
      this.process.onExit(event => { resolveExit(event.exitCode) })
    })
  }

  write(data: string): void { this.process.write(data) }
  resize(columns: number, rows: number): void { this.process.resize(columns, rows) }

  async waitFor(text: string, start = 0, timeoutMs = 20_000): Promise<number> {
    const deadline = Date.now() + testCeiling(timeoutMs)
    while (Date.now() < deadline) {
      const found = this.output.indexOf(text, start)
      if (found !== -1) return found
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
    }
    throw new Error(`Timed out waiting for ${JSON.stringify(text)}\n${this.output.slice(-4000)}`)
  }

  async waitForAudibleBell(start = 0, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + testCeiling(timeoutMs)
    while (Date.now() < deadline) {
      if (countAudibleBells(this.output.slice(start)) > 0) return
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
    }
    throw new Error('Timed out waiting for an audible terminal bell')
  }

  childPid(): number {
    const output = execFileSync('ps', ['-ax', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' })
    const child = output.split('\n').map(row => row.trim().split(/\s+/))
      .find(([, parent]) => Number(parent) === this.process.pid)
    const pid = Number(child?.[0])
    if (!Number.isInteger(pid)) throw new Error(`No child process below PTY shell ${this.process.pid}`)
    return pid
  }

  async close(): Promise<void> {
    this.write('exit\n')
    const result = await Promise.race([
      this.exited,
      new Promise<number>(resolveTimeout => { setTimeout(() => { resolveTimeout(-1) }, 2_000) }),
    ])
    if (result === -1) this.process.kill('SIGKILL')
  }
}

function modeBetween(output: string, marker: string): string {
  const match = new RegExp(`${marker}\\r?\\n([^\\r\\n]+)`).exec(output)
  if (match?.[1] === undefined) throw new Error(`Missing terminal mode after ${marker}\n${output.slice(-2000)}`)
  return match[1]
}

async function firstFrame(output: string): Promise<string> {
  const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: 80, rows: 24 })
  await new Promise<void>(resolveWrite => { terminal.write(output, resolveWrite) })
  const lines = Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true) ?? '')
  const header = lines.findIndex(line => line.includes('dashi'))
  return lines.slice(header).join('\n')
}

async function resizedFrame(
  output: string,
  changes: readonly { readonly at: number; readonly columns: number; readonly rows: number }[],
): Promise<string> {
  const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: 80, rows: 24 })
  let offset = 0
  for (const change of changes) {
    await new Promise<void>(resolveWrite => { terminal.write(output.slice(offset, change.at), resolveWrite) })
    terminal.resize(change.columns, change.rows)
    offset = change.at
  }
  await new Promise<void>(resolveWrite => { terminal.write(output.slice(offset), resolveWrite) })
  return Array.from({ length: terminal.buffer.active.length }, (_, row) =>
    terminal.buffer.active.getLine(row)?.translateToString(true) ?? '').join('\n')
}

async function prepareShell(extraEnv: NodeJS.ProcessEnv = {}, cwd = root): Promise<{ baseline: string; shell: PtyShell }> {
  const shell = new PtyShell(replayFixture, undefined, cwd, extraEnv)
  shell.write("printf '__MODE_BEFORE__\\n'; stty -g\n")
  await shell.waitFor('__MODE_BEFORE__')
  await shell.waitFor('\n', shell.output.indexOf('__MODE_BEFORE__') + 20)
  await new Promise(resolveDelay => { setTimeout(resolveDelay, 30) })
  return { baseline: modeBetween(shell.output, '__MODE_BEFORE__'), shell }
}

async function launch(
  shell: PtyShell,
  command = `${quote(dsh)} --profile dashi --fullscreen`,
  ready = 'session-',
): Promise<number> {
  const start = shell.output.length
  shell.write(`${command}\n`)
  await shell.waitFor(ready, start)
  return start
}

function sessionId(output: string, start: number): string {
  const id = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(output.slice(start))?.[0]
  if (id === undefined) throw new Error(`Missing session UUID\n${output.slice(start, start + 4000)}`)
  return id
}

async function waitForOtherSession(shell: PtyShell, current: string, start: number): Promise<string> {
  const deadline = Date.now() + testCeiling(20_000)
  while (Date.now() < deadline) {
    const ids = [...shell.output.slice(start).matchAll(/session-[0-9a-f-]{36}/g)].map(match => match[0])
    const found = ids.find(id => id !== current)
    if (found !== undefined) return found
    await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
  }
  throw new Error(`Timed out waiting for a root other than ${current}\n${shell.output.slice(start)}`)
}

async function waitForFile(path: string, expected: string | undefined): Promise<void> {
  const deadline = Date.now() + testCeiling(20_000)
  while (Date.now() < deadline) {
    if (expected === undefined ? !existsSync(path) : existsSync(path) && readFileSync(path, 'utf8') === expected) return
    await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
  }
  throw new Error(`Timed out waiting for ${path} to ${expected === undefined ? 'be absent' : `contain ${JSON.stringify(expected)}`}`)
}

async function createNamedSession(cwd: string, title: string): Promise<string> {
  const shell = new PtyShell(threeTurnFixture, undefined, cwd)
  try {
    const start = await launch(shell,
      `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --name ${quote(title)} 'catalog fixture'`)
    const id = sessionId(shell.output, start)
    await shell.waitFor('First turn complete.', start)
    await shell.waitFor('idle ·', start)
    const releasedAt = shell.output.length
    shell.write('\u0004\u0004')
    await shell.waitFor('\u001B[?1049l', releasedAt)
    return id
  } finally {
    await shell.close()
  }
}

async function expectResumable(
  id: string,
  snapshot = replayFixture,
  extraEnv: NodeJS.ProcessEnv = {},
  cwd = root,
): Promise<void> {
  const shell = new PtyShell(snapshot, undefined, cwd, extraEnv)
  try {
    const start = await launch(shell,
      `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}`,
      'idle ·')
    expect(shell.output.slice(start)).toContain(id)
    const releasedAt = shell.output.length
    shell.write('\u0004\u0004')
    await shell.waitFor('\u001B[?1049l', releasedAt)
  } finally {
    await shell.close()
  }
}

function findSessionFile(directory: string, id: string): string {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      const found = findSessionFile(path, id)
      if (found !== '') return found
    } else if (entry === 'session.jsonl' && path.includes(id)) {
      return path
    }
  }
  return ''
}

function sessionEvents(id: string, sessionHome = home): Array<{ type: string; data?: Record<string, unknown> }> {
  const file = findSessionFile(join(sessionHome, 'replay-sessions'), id)
  if (file === '') throw new Error(`Missing persisted session ${id}`)
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1)
    .map(line => JSON.parse(line) as { type: string; data?: Record<string, unknown> })
}

function sessionLog(id: string, sessionHome = home): {
  header: Record<string, unknown>
  events: Array<{ type: string; seq: number; data?: Record<string, unknown> }>
} {
  const file = findSessionFile(join(sessionHome, 'replay-sessions'), id)
  if (file === '') throw new Error(`Missing persisted session ${id}`)
  const [header, ...events] = readFileSync(file, 'utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>)
  if (header === undefined) throw new Error(`Empty persisted session ${id}`)
  return { header, events: events as Array<{ type: string; seq: number; data?: Record<string, unknown> }> }
}

function clipboardHelper(image: boolean): string {
  const directory = join(testDir, `clipboard-${image ? 'image' : 'empty'}-${String(Date.now())}`)
  mkdirSync(directory)
  symlinkSync(process.execPath, join(directory, 'node'))
  for (const command of ['sed', 'dirname', 'uname']) symlinkSync(`/usr/bin/${command}`, join(directory, command))
  if (image) {
    const helper = join(directory, 'wl-paste')
    writeFileSync(helper, `#!${process.execPath}\nprocess.stdout.write(Buffer.from('${png.toString('base64')}', 'base64'))\n`)
    chmodSync(helper, 0o755)
  }
  return directory
}

function chunkStormSnapshot(chunks = 400): string {
  const path = join(testDir, `chunk-storm-${String(Date.now())}.jsonl`)
  const middle = Math.floor(chunks / 2)
  const deltas = Array.from({ length: chunks }, (_, index) =>
    index === 0 ? 'STORM_START ' : index === chunks - 1 ? ' STORM_END'
      : index === middle ? ' STORM_MIDDLE ' : '.')
  const text = deltas.join('')
  const rows: Record<string, unknown>[] = [
    { type: 'session', version: 0, id: 'dashi-chunk-storm', createdAt: 1, cwd: '/recorded', delegationDepth: 0 },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'text' } } },
    ...deltas.map(textDelta => ({
      type: 'assistant/chunk',
      data: { turn: 1, step: 1, chunk: {
        type: 'text-delta', index: 0,
        text: textDelta,
      } },
    })),
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: {
      type: 'block-end', index: 0, block: { type: 'text', text },
    } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'stop' } } } },
  ]
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  return path
}

function presenterFailureSnapshot(): string {
  const path = join(testDir, `presenter-failure-${String(Date.now())}.jsonl`)
  const rows = [
    { type: 'session', version: 0, id: 'dashi-presenter-failure', createdAt: 1, cwd: '/recorded', delegationDepth: 0 },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: {
      type: 'tool-call-delta', index: 0, id: 'presenter-call', name: 'dashi_presenter_failure', argumentsDelta: '{}',
    } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'block-end', index: 0, block: {
      type: 'tool-call', id: 'presenter-call', name: 'dashi_presenter_failure', arguments: '{}',
    } } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'block-start', index: 0, blockType: 'text' } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: {
      type: 'text-delta', index: 0, text: 'Presenter recovery complete.',
    } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'block-end', index: 0, block: {
      type: 'text', text: 'Presenter recovery complete.',
    } } } },
    { type: 'assistant/chunk', data: { turn: 1, step: 2, chunk: { type: 'finish', reason: { kind: 'stop' } } } },
  ]
  writeFileSync(path, `${rows.map(row => JSON.stringify(row)).join('\n')}\n`)
  return path
}

function generateLargeSession(
  id: string, turns = 49_500, toolCells = 2_000, sessionHome = home,
): { readonly events: number; readonly toolCells: number } {
  const file = findSessionFile(join(sessionHome, 'replay-sessions'), id)
  if (file === '') throw new Error(`Missing persisted session ${id}`)
  const header = readFileSync(file, 'utf8').split('\n')[0]
  if (header === undefined) throw new Error(`Empty persisted session ${id}`)
  writeFileSync(file, `${header}\n`)
  let rows: string[] = []
  let seq = 0
  const add = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
    rows.push(JSON.stringify({ type, data, ...extra, seq, time: 1_800_000_000_000 + seq }))
    seq++
    if (rows.length === 1_000) {
      appendFileSync(file, `${rows.join('\n')}\n`)
      rows = []
    }
  }
  for (let turn = 1; turn <= turns; turn++) {
    add('turn/start', { turn })
    add('user/message', {
      id: `large-user-${String(turn)}`, role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: `large prompt ${String(turn)}` }],
    }, { surfaceOp: 'append' })
    if (turn <= toolCells) {
      const callId = `large-call-${String(turn)}`
      add('tool/call', { turn, step: 1, callId, name: 'inspect', arguments: `{"path":"large-${String(turn)}"}` })
      add('tool/result', {
        turn, step: 1, message: {
          id: `large-result-${String(turn)}`, role: 'user', source: { kind: 'tool', callId },
          content: [{
            type: 'tool-result', toolCallId: callId,
            content: [{ type: 'text', text: `large tool result ${String(turn)}` }],
          }],
        },
      }, { surfaceOp: 'append' })
    } else {
      add('assistant/message', {
        turn, step: 1, message: {
          id: `large-assistant-${String(turn)}`, role: 'assistant',
          source: { kind: 'model', provider: 'replay', model: 'recorded' },
          content: [{ type: 'text', text: `large answer ${String(turn)}` }],
        },
      }, { surfaceOp: 'append' })
    }
    add('turn/end', { turn, reason: { kind: 'completed' } })
  }
  if (rows.length > 0) appendFileSync(file, `${rows.join('\n')}\n`)
  return { events: seq, toolCells }
}

async function expectRestored(shell: PtyShell, baseline: string): Promise<void> {
  const start = shell.output.length
  shell.write("printf '__MODE_AFTER__\\n'; stty -g; printf '__SHELL_OK__\\n'\n")
  await shell.waitFor('__MODE_AFTER__\r\n', start)
  await shell.waitFor('__SHELL_OK__\r\n', start)
  expect(modeBetween(shell.output.slice(start), '__MODE_AFTER__')).toBe(baseline)
}

function prepareTestProfile(profileHome: string): void {
  const env = { ...process.env, DSH_HOME: profileHome }
  const plugin = join(root, 'packages', 'dashi')
  const profile = join(root, 'packages', 'dashi-app')
  run(dsh, ['plugin', '--profile', 'dashi', 'install'], env)
  appendFileSync(join(profileHome, 'profiles', 'dashi', 'pnpm-workspace.yaml'),
    `\nminimumReleaseAge: 0\noverrides:\n  '@antst/dashi': 'link:${plugin}'\n`)
  run(dsh, ['plugin', '--profile', 'dashi', 'add', profile], env)
  run('pnpm', ['add', '--save-exact', '@deepseek-ai/dsh-llm-replay@0.1.2-rc.1'], env,
    join(profileHome, 'profiles', 'dashi'))
  run('pnpm', ['add', questionPlugin], env, join(profileHome, 'profiles', 'dashi'))
}

beforeAll(() => {
  testDir = mkdtempSync(join(tmpdir(), 'dashi-profile-'))
  home = join(testDir, 'home')
  hardeningHome = join(testDir, 'hardening-home')
  launchFlagsHome = join(testDir, 'launch-flags-home')
  pluginHome = join(testDir, 'plugin-home')
  hardeningCwd = join(testDir, 'hardening-workspace')
  mkdirSync(hardeningCwd)
  prepareTestProfile(home)
  prepareTestProfile(hardeningHome)
  prepareTestProfile(launchFlagsHome)
  prepareTestProfile(pluginHome)
}, 120_000)

afterAll(() => {
  if (testDir !== '') rmSync(testDir, { recursive: true, force: true })
})

describe.sequential('shipped profile terminal lifecycle', () => {
  it('renders the first profile frame within the large-resume budget', async () => {
    const shell = new PtyShell()
    try {
      const startedAt = performance.now()
      const start = await launch(shell, `${quote(dsh)} --profile dashi`)
      const elapsed = performance.now() - startedAt
      reportPerformance('profile-first-frame', elapsed, 'ms')
      expect(elapsed).toBeLessThan(testCeiling(3_000))
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
      const output = shell.output.slice(start)
      expect(output).toContain('session-')
      expect(output).not.toContain('\u001B[?1049h')
      for (const mode of ['1000', '1002', '1003', '1006']) {
        expect(output).not.toContain(`\u001B[?${mode}h`)
      }
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('boots the same first frame through the dashi launcher', async () => {
    const direct = new PtyShell()
    let id = ''
    let expected = ''
    try {
      const start = await launch(direct, `${quote(dsh)} --profile dashi`)
      id = sessionId(direct.output, start)
      await direct.waitFor('idle ·', start)
      expected = await firstFrame(direct.output.slice(start))
      const releasedAt = direct.output.length
      direct.write('\u0004\u0004')
      await direct.waitFor('Resume with:', releasedAt)
    } finally {
      await direct.close()
    }

    const viaLauncher = new PtyShell(replayFixture, undefined, root, {
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(viaLauncher,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --resume ${quote(id)}`)
      await viaLauncher.waitFor('idle ·', start)
      expect(await firstFrame(viaLauncher.output.slice(start))).toBe(expected)
      const releasedAt = viaLauncher.output.length
      viaLauncher.write('\u0004\u0004')
      await viaLauncher.waitFor('Resume with:', releasedAt)
    } finally {
      await viaLauncher.close()
    }
  }, 30_000)

  it('prints launcher info, lists loaded plugins, and relays profile plugin changes', async () => {
    const archives = join(testDir, 'plugin-archives')
    mkdirSync(archives)
    const archive = packWorkspacePackage(pluginManagementFixture, archives)
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: pluginHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)}`
    try {
      let start = shell.output.length
      shell.write(`${launcher} --help; printf '__W034_HELP_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('__W034_HELP_EXIT__0', start)
      expect(shell.output.slice(start)).toContain(`dashi ${JSON.parse(readFileSync(join(root, 'packages', 'dashi', 'package.json'), 'utf8')).version as string} on DSH ${validatedDshVersion}`)
      expect(shell.output.slice(start)).toContain('Launch flags:')
      expect(shell.output.slice(start)).toContain('--permission PRESET')
      start = shell.output.length
      shell.write(`${launcher} --version; printf '__W034_VERSION_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('__W034_VERSION_EXIT__0', start)
      expect(shell.output.slice(start)).toContain(`\r${validatedDshVersion}\r\n`)

      start = await launch(shell, `${launcher} --patch ${quote(replayPatch)} --fullscreen --yolo`)
      shell.write('/plugins\r')
      for (const row of [
        '@deepseek-ai/dsh-api-session-controller',
        'include:dashi · @antst/dashi · enabled · active',
        'include:roller · @antst/roller · enabled · active',
      ]) {
        await shell.waitFor(row, start)
      }
      expect(shell.output.slice(start)).toContain('enabled')
      expect(shell.output.slice(start)).toContain('active')

      const addAt = shell.output.length
      shell.write(`/plugin add ${quote(archive)}\r`)
      await shell.waitFor('changes load on the next launch; exit and run dashi again', addAt)
      const profileManifest = JSON.parse(readFileSync(join(pluginHome, 'profiles', 'dashi', 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      expect(profileManifest.dependencies?.['@antst/dashi-plugin-management-fixture']).toContain('.tgz')

      const missingAt = shell.output.length
      shell.write('/plugin add @antst/dashi-w034-package-does-not-exist\r')
      await shell.waitFor('dsh: pnpm failed in profile directory', missingAt)
      expect(shell.output.slice(missingAt)).toContain('@antst/dashi-w034-package-does-not-exist is not in the npm registry')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('reads and persists settings through the native provider', async () => {
    const shell = new PtyShell()
    try {
      await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const helpAt = shell.output.length
      shell.write('/help\r')
      await shell.waitFor('/memory /skills /config /login /logout /diff /plugins', helpAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const readAt = shell.output.length
      shell.write('/config\r')
      await shell.waitFor('shell', readAt)
      await shell.waitFor('base:', readAt)
      await shell.waitFor('user: —', readAt)

      const updateAt = shell.output.length
      shell.write('/config shell timeoutMs=61000\r')
      await shell.waitFor('updated shell.timeoutMs', updateAt)
      expect(readFileSync(join(home, 'settings.yaml'), 'utf8')).toContain('timeoutMs: 61000')

      const changedAt = shell.output.length
      shell.write('/config\r')
      await shell.waitFor('user: {"timeoutMs":61000}', changedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('signs in and out through a fixture authorization flow without exposing its secret', async () => {
    const shell = new PtyShell()
    const secretPrefix = 'W041-secret-never-visible'
    const secret = `${secretPrefix}-${'x'.repeat(1000)}`
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      await shell.waitFor('idle ·', start)
      shell.write('/login\r')
      await shell.waitFor('dashi-fixture/account · Dashi fixture account', start)
      shell.write('/login dashi-fixture/account fixture\r')
      await shell.waitFor('Enter the fixture secret.', start)
      expect(await firstFrame(shell.output.slice(start))).toContain('https://example.invalid/login')
      shell.write(`\u001B[200~${secret}\u001B[201~\r`)
      await shell.waitFor('Choose the fixture account.', start)
      shell.write('1\r')
      await shell.waitFor('signed in to Dashi fixture account', start)
      shell.write('\u001F')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      expect(shell.output.slice(start)).not.toContain(secretPrefix)
      shell.write('/logout\r')
      await shell.waitFor('dashi-fixture/account · grant', start)
      shell.write('/logout dashi-fixture/account\r')
      await shell.waitFor('signed out dashi-fixture/account', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      expect(shell.output.slice(start)).not.toContain(secretPrefix)
    } finally {
      await shell.close()
    }
    expect(JSON.stringify(sessionEvents(id))).not.toContain(secretPrefix)
  }, 30_000)

  it('resumes with injected instructions collapsed above the visible prompt', async () => {
    const seed = new PtyShell()
    let id = ''
    try {
      const start = await launch(seed, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(seed.output, start)
      const releasedAt = seed.output.length
      seed.write('\u0004\u0004')
      await seed.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await seed.close()
    }
    const file = findSessionFile(join(home, 'replay-sessions'), id)
    const header = readFileSync(file, 'utf8').split('\n')[0]
    const fixture = readFileSync(contextInjectionFixture, 'utf8').split('\n').slice(1).join('\n')
    writeFileSync(file, `${header}\n${fixture}`)

    const resumed = new PtyShell()
    try {
      const start = await launch(resumed,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}`)
      await resumed.waitFor('idle ·', start)
      const frame = await firstFrame(resumed.output.slice(start))
      const context = frame.indexOf('Context · instructions · Workspace instructions · 18 lines')
      const prompt = frame.indexOf('VISIBLE_CONTEXT_PROMPT')
      expect(context).toBeGreaterThanOrEqual(0)
      expect(prompt).toBeGreaterThan(context)
      expect(frame).not.toContain('CONTEXT_BODY_18')
      const releasedAt = resumed.output.length
      resumed.write('\u0004\u0004')
      await resumed.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await resumed.close()
    }
  }, 30_000)

  it('loads workspace instructions and opens the selected memory file in a cooked terminal', async () => {
    const workspace = join(testDir, 'memory-workspace')
    const instruction = join(workspace, 'AGENTS.md')
    const trace = join(testDir, 'memory-editor.json')
    mkdirSync(join(workspace, '.git'), { recursive: true })
    writeFileSync(instruction, '# Fixture guidance\n\nW037_AGENT_INSTRUCTION\n')
    const { baseline, shell } = await prepareShell({
      DSH_DASHI_EDITOR_TRACE: trace,
      EDITOR: `${process.execPath} ${fakeEditor}`,
      VISUAL: '',
    }, workspace)
    try {
      shell.resize(100, 60)
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('load workspace memory\r')
      await shell.waitFor('Context · instructions', start)
      shell.write('\u000f')
      await shell.waitFor('W037_AGENT_INSTRUCTION', start)
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      const memoryAt = shell.output.length
      shell.write('/memory\r')
      await shell.waitFor('Memory', memoryAt)
      await shell.waitFor('AGENTS.md', memoryAt)
      await shell.waitFor('scope .', memoryAt)
      const selectedAt = shell.output.length
      shell.write('\r')
      await shell.waitFor('idle ·', selectedAt)
      const result = JSON.parse(readFileSync(trace, 'utf8')) as { file: string; terminalMode: string }
      expect(result.file).toBe(instruction)
      expect(result.terminalMode).toBe(baseline)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('/init atomically creates a starter AGENTS.md and refuses to overwrite it', async () => {
    const workspace = join(testDir, 'init-workspace')
    const instruction = join(workspace, 'AGENTS.md')
    mkdirSync(workspace)
    const shell = new PtyShell(replayFixture, undefined, workspace)
    try {
      await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const createdAt = shell.output.length
      shell.write('/init\r')
      await shell.waitFor(`created ${instruction}`, createdAt)
      const content = readFileSync(instruction, 'utf8')
      expect(content).toBe('# init-workspace\n\n## Working agreement\n\n- Add project-specific architecture guidance.\n- Add required build, test, and lint commands.\n- Add repository conventions and constraints.\n')

      const refusedAt = shell.output.length
      shell.write('/init\r')
      await shell.waitFor('cannot overwrite existing', refusedAt)
      await shell.waitFor(`"${instruction}" without reading it first`, refusedAt)
      expect(readFileSync(instruction, 'utf8')).toBe(content)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const next = new PtyShell(threeTurnFixture, undefined, workspace)
    try {
      next.resize(100, 60)
      await launch(next, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const promptAt = next.output.length
      next.write('use initialized instructions\r')
      await next.waitFor('Context · instructions', promptAt)
      await next.waitFor('First turn complete.', promptAt)
      await next.waitFor('idle ·', promptAt)
      const releasedAt = next.output.length
      next.write('\u0004\u0004')
      await next.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await next.close()
    }
  }, 30_000)

  it('/copy N copies the Nth latest completed response through the launcher', async () => {
    const shell = new PtyShell(threeTurnFixture, undefined, root, {
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`)
      let turnAt = shell.output.length
      shell.write('first copy turn\r')
      await shell.waitFor('First turn complete.', turnAt)
      await shell.waitFor('idle ·', turnAt)
      turnAt = shell.output.length
      shell.write('second copy turn\r')
      await shell.waitFor('Second turn complete.', turnAt)
      await shell.waitFor('idle ·', turnAt)
      const copyAt = shell.output.length
      shell.write('/copy 2\r')
      const oscAt = await shell.waitFor('\u001B]52;c;', copyAt)
      const payloadAt = oscAt + '\u001B]52;c;'.length
      const payloadEnd = shell.output.indexOf('\u0007', payloadAt)
      expect(Buffer.from(shell.output.slice(payloadAt, payloadEnd), 'base64').toString()).toBe('First turn complete.')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('shows the fixture repository diff and the last turn write metadata', async () => {
    const workspace = join(testDir, 'diff-workspace')
    const tracked = join(workspace, 'tracked.txt')
    mkdirSync(workspace)
    run('git', ['init', '-q'], process.env, workspace)
    writeFileSync(tracked, 'W038_BEFORE\n')
    run('git', ['add', 'tracked.txt'], process.env, workspace)
    run('git', ['-c', 'user.name=dashi', '-c', 'user.email=dashi@example.invalid',
      'commit', '-qm', 'fixture'], process.env, workspace)
    writeFileSync(tracked, 'W038_AFTER\n')
    const shell = new PtyShell(rollerFixture, undefined, workspace)
    try {
      shell.resize(100, 40)
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('record a turn diff\r')
      await shell.waitFor('Roller turn one complete.', start)
      await shell.waitFor('idle ·', start)

      let openedAt = shell.output.length
      shell.write('/diff\r')
      await shell.waitFor('Working tree diff', openedAt)
      await shell.waitFor('git diff', openedAt)
      shell.write('\u000f')
      await shell.waitFor('-W038_BEFORE', openedAt)
      await shell.waitFor('+W038_AFTER', openedAt)
      shell.write('\u001B')
      await shell.waitFor('idle ·', openedAt)

      openedAt = shell.output.length
      shell.write('/diff turn\r')
      await shell.waitFor('Last turn diff', openedAt)
      await shell.waitFor('Write roller-e2e.txt', openedAt)
      await shell.waitFor('roller-e2e.txt', openedAt)
      shell.write('\u000f')
      await shell.waitFor('+ turn one', openedAt)
      shell.write('\u001B')
      await shell.waitFor('idle ·', openedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('opens the startup resume picker through long and short launcher flags with cwd and all scopes', async () => {
    const cwd = join(testDir, `startup-picker-${String(Date.now())}`)
    const otherCwd = join(testDir, `startup-picker-other-${String(Date.now())}`)
    mkdirSync(cwd)
    mkdirSync(otherCwd)
    const current = await createNamedSession(cwd, 'Startup picker current')
    await createNamedSession(otherCwd, 'Startup picker all')
    const launcherEnv = { PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` }

    const scoped = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
    try {
      const start = await launch(scoped,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --resume`,
        'Resume session')
      expect(scoped.output.slice(start)).toContain('Startup picker current')
      expect(scoped.output.slice(start)).not.toContain('Startup picker all')
      scoped.write('\r')
      await scoped.waitFor(current, start)
      const releasedAt = scoped.output.length
      scoped.write('\u0004\u0004')
      await scoped.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await scoped.close()
    }

    const all = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
    try {
      const start = await launch(all,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen -r --all`,
        'Resume session')
      expect(all.output.slice(start)).toContain('Startup picker all')
      all.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      all.write('\u0004')
      await all.waitFor('\u001B[?1049l', start)
    } finally {
      await all.close()
    }
  }, 60_000)

  it('supports -c and reports DSH not-found errors through the launcher', async () => {
    const cwd = join(testDir, `startup-alias-${String(Date.now())}`)
    mkdirSync(cwd)
    const current = await createNamedSession(cwd, 'Short continue target')
    const launcherEnv = { PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` }
    const continued = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
    try {
      const start = await launch(continued,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen -c`)
      expect(continued.output.slice(start)).toContain(current)
      const releasedAt = continued.output.length
      continued.write('\u0004\u0004')
      await continued.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await continued.close()
    }

    const missing = 'session-00000000-0000-0000-0000-000000000024'
    const failed = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
    try {
      const start = failed.output.length
      failed.write(`${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --resume ${quote(missing)}; printf '__RESUME_EXIT__%s\\n' "$?"\n`)
      await failed.waitFor('__RESUME_EXIT__1', start)
      expect(failed.output.slice(start)).toContain(`dashi: startup failed: session "${missing}" not found`)
    } finally {
      await failed.close()
    }
  }, 60_000)

  it('submits a prompt after exact resume through the launcher', async () => {
    const cwd = join(testDir, `startup-prompt-${String(Date.now())}`)
    mkdirSync(cwd)
    const id = await createNamedSession(cwd, 'Startup prompt target')
    const shell = new PtyShell(threeTurnFixture, undefined, cwd, {
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)} 'startup resumed prompt'`)
      await shell.waitFor('startup resumed prompt', start)
      const running = await shell.waitFor('running ·', start)
      await shell.waitFor('idle ·', running + 1)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id).some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('startup resumed prompt'))).toBe(true)
  }, 60_000)

  it('resolves launcher and in-session resume values by native title', async () => {
    const cwd = join(testDir, `resume-name-${String(Date.now())}`)
    const otherCwd = join(testDir, `resume-name-other-${String(Date.now())}`)
    mkdirSync(cwd)
    mkdirSync(otherCwd)
    const unique = await createNamedSession(cwd, 'W028 Unique Title')
    const firstDuplicate = await createNamedSession(cwd, 'W028 Duplicate')
    const secondDuplicate = await createNamedSession(cwd, 'W028 Duplicate')
    const otherDuplicate = await createNamedSession(otherCwd, 'W028 Duplicate')
    const crossCwd = await createNamedSession(otherCwd, 'W028 Cross Directory')
    const launcherEnv = { PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}` }
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`

    const byName = new PtyShell(threeTurnFixture, undefined, cwd, launcherEnv)
    try {
      const start = await launch(byName, `${launcher} --resume 'W028 Unique Title' 'do something'`)
      expect(byName.output.slice(start)).toContain(unique)
      await byName.waitFor('do something', start)
      const running = await byName.waitFor('running ·', start)
      await byName.waitFor('idle ·', running + 1)
      byName.write('\u0004\u0004')
      await byName.waitFor('\u001B[?1049l', running)
    } finally {
      await byName.close()
    }
    expect(sessionEvents(unique).some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('do something'))).toBe(true)

    const duplicates = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
    try {
      const start = await launch(duplicates, `${launcher} --resume 'W028 Duplicate'`, 'Resume session')
      const output = duplicates.output.slice(start)
      expect(output).toContain(firstDuplicate)
      expect(output).toContain(secondDuplicate)
      expect(output).not.toContain(otherDuplicate)
      expect(output).not.toContain(unique)
      const selectAt = duplicates.output.length
      duplicates.write('\r')
      await duplicates.waitFor('idle ·', selectAt)
      duplicates.write('\u0004\u0004')
      await duplicates.waitFor('\u001B[?1049l', selectAt)
    } finally {
      await duplicates.close()
    }

    const titleCases: ReadonlyArray<readonly [string, string]> = [
      ['unique title', unique], ['W028 Cross Directory', crossCwd],
    ]
    for (const [value, expected] of titleCases) {
      const shell = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
      try {
        const all = expected === crossCwd ? ' --all' : ''
        const start = await launch(shell, `${launcher}${all} --resume ${quote(value)}`)
        expect(shell.output.slice(start)).toContain(expected)
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', start)
      } finally {
        await shell.close()
      }
    }

    const inSession = new PtyShell(replayFixture, undefined, cwd)
    try {
      const start = await launch(inSession, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const resumeAt = inSession.output.length
      inSession.write('/resume W028 Unique Title\r')
      await inSession.waitFor(unique, resumeAt)
      inSession.write('\u0004\u0004')
      await inSession.waitFor('\u001B[?1049l', start)
    } finally {
      await inSession.close()
    }

    const missing = new PtyShell(replayFixture, undefined, cwd, launcherEnv)
    try {
      const start = missing.output.length
      missing.write(`${launcher} --resume 'W028 Missing Name'; printf '__NAME_EXIT__%s\\n' "$?"\n`)
      await missing.waitFor('__NAME_EXIT__1', start)
      expect(missing.output.slice(start)).toContain('dashi: startup failed: no session named "W028 Missing Name"\r\n')
    } finally {
      await missing.close()
    }
  }, 90_000)

  it('appends the default inline transcript into native scrollback through the launcher', async () => {
    const shell = new PtyShell(inlineScrollFixture, undefined, root, {
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} 'inline scroll proof'`)
      const firstChunk = await shell.waitFor('STREAM_CHUNK_ONE', start)
      const secondChunk = await shell.waitFor('STREAM_CHUNK_TWO', firstChunk + 1)
      const appendOutput = shell.output.slice(firstChunk + 'STREAM_CHUNK_ONE'.length, secondChunk)
      expect(appendOutput).not.toContain('\u001B[2J')
      expect(appendOutput).not.toContain('\u001B[3J')
      await shell.waitFor('FIRST_TURN_LINE_30', secondChunk)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 200) })

      const output = shell.output.slice(start)
      const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: 80, rows: 24, scrollback: 1_000 })
      await new Promise<void>(resolveWrite => { terminal.write(output, resolveWrite) })
      const buffer = terminal.buffer.normal
      const lines = Array.from({ length: buffer.length }, (_, row) =>
        buffer.getLine(row)?.translateToString(true) ?? '')
      expect(buffer.baseY).toBeGreaterThan(0)
      expect(lines).toContain('  FIRST_TURN_LINE_01')
      expect(lines).toContain('  FIRST_TURN_LINE_30')
      terminal.dispose()
      expect(output).not.toContain('\u001B[?1049h')
      for (const mode of ['1000', '1002', '1003', '1006']) {
        expect(output).not.toContain(`\u001B[?${mode}h`)
      }

      const historyAt = shell.output.length
      shell.write('\u001B[5~')
      await shell.waitFor('History', historyAt)
      const closeAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closeAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('rejects a resolved graph containing a deliberate DSH version mismatch', () => {
    expect(() => {
      assertResolvedDshGraph(readFileSync(dshVersionMismatch, 'utf8'), validatedDshVersion)
    }).toThrow('@deepseek-ai/dsh-base@0.1.2-alpha.5')
  })

  it('installs packed packages with published DSH and runs the daily flow through the launcher', async () => {
    const cleanRoot = mkdtempSync(join(testDir, 'clean-install-'))
    const archives = join(cleanRoot, 'archives')
    const prefix = join(cleanRoot, 'prefix')
    const cleanHome = join(cleanRoot, 'home')
    mkdirSync(archives)
    mkdirSync(prefix)
    const pluginArchive = packWorkspacePackage(join(root, 'packages', 'dashi'), archives)
    const appArchive = packWorkspacePackage(join(root, 'packages', 'dashi-app'), archives)
    const launcherArchive = packWorkspacePackage(join(root, 'packages', 'dashi-launcher'), archives)
    expect([pluginArchive, appArchive, launcherArchive].every(existsSync)).toBe(true)

    writeFileSync(join(prefix, 'package.json'), '{"private":true}\n')
    writeFileSync(join(prefix, 'pnpm-workspace.yaml'), [
      'allowBuilds:',
      "  '@deepseek-ai/dsh-subprocess-local': true",
      "  '@google/genai': false",
      '  koffi: false',
      '  node-pty: true',
      '  protobufjs: false',
      '',
    ].join('\n'))
    run('pnpm', ['install', `@deepseek-ai/dsh@${validatedDshVersion}`, launcherArchive], process.env, prefix)
    const cleanDsh = join(prefix, 'node_modules', '.bin', 'dsh')
    const cleanLauncher = join(prefix, 'node_modules', '.bin', 'dashi')
    const cleanEnv = { ...process.env, DSH_HOME: cleanHome }
    run(cleanDsh, ['plugin', '--profile', 'dashi', 'install'], cleanEnv)

    // @antst/dashi is not published yet. Resolve its normal package range to the
    // packed artifact while exercising DSH's real plugin-add path for the app.
    const profile = join(cleanHome, 'profiles', 'dashi')
    const manifestPath = join(profile, 'package.json')
    const workspacePath = join(profile, 'pnpm-workspace.yaml')
    appendFileSync(workspacePath, [
      '',
      'overrides:',
      `  '@antst/dashi': 'file:${pluginArchive}'`,
      '',
    ].join('\n'))
    run(cleanDsh, ['plugin', '--profile', 'dashi', 'add', appArchive], cleanEnv)
    run('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh-llm-replay@${validatedDshVersion}`], cleanEnv, profile)
    const cliResolved = assertResolvedDshGraph(readFileSync(join(prefix, 'pnpm-lock.yaml'), 'utf8'), validatedDshVersion)
    const profileResolved = assertResolvedDshGraph(readFileSync(join(profile, 'pnpm-lock.yaml'), 'utf8'), validatedDshVersion)
    expect(cliResolved).toBeGreaterThan(0)
    expect(profileResolved).toBeGreaterThan(0)
    const manifests = [
      join(profile, 'node_modules', '@antst', 'dashi', 'package.json'),
      join(profile, 'node_modules', '@antst', 'dashi-app', 'package.json'),
      join(prefix, 'node_modules', '@antst', 'dashi-launcher', 'package.json'),
    ].map(path => JSON.parse(readFileSync(path, 'utf8')) as {
      dependencies?: Record<string, string>
      version: string
    })
    const workspaceVersion = (JSON.parse(readFileSync(
      join(root, 'packages', 'dashi', 'package.json'), 'utf8',
    )) as { version: string }).version
    expect(manifests.map(manifest => manifest.version)).toEqual(Array(3).fill(workspaceVersion))
    expect(manifests[1]?.dependencies?.['@antst/dashi']).toBe(`^${manifests[0]?.version ?? ''}`)
    expect(manifests[1]?.dependencies?.['@antst/roller']).toBe('0.1.2')
    expect(JSON.parse(readFileSync(
      join(profile, 'node_modules', '@antst', 'roller', 'package.json'), 'utf8',
    )).version).toBe('0.1.2')

    for (const path of [manifestPath, workspacePath, join(profile, 'pnpm-lock.yaml')]) {
      const installed = readFileSync(path, 'utf8')
      expect(installed).not.toContain('link:')
      expect(installed).not.toContain(root)
    }

    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: cleanHome,
      PATH: `${join(prefix, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell, `${quote(cleanLauncher)} --patch ${quote(cleanReplayPatch)}`)
      shell.write('clean install daily flow\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      const completedAt = await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', completedAt)
      const commandAt = shell.output.length
      shell.write('/roller')
      await shell.waitFor('/roller-restore', commandAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const clearAt = shell.output.length
      shell.write('\u0003')
      await shell.waitFor('\r\u001B[2K \u001B[7m', clearAt)
      const rewindAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('Rewind to a prompt', rewindAt)
      shell.write('\r')
      await shell.waitFor('Restore code and conversation', rewindAt)
      await shell.waitFor('Restore code', rewindAt)
      const closeAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closeAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const pickerAt = shell.output.length
      shell.write('/model\r')
      await shell.waitFor('Model', pickerAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
      expect(shell.output.slice(start)).not.toContain('dashi: terminal failure')
      expect(shell.output.slice(start)).not.toContain('versions must match')
    } finally {
      await shell.close()
    }
  }, 180_000)

  it.each(['xterm-256color', 'tmux-256color', 'screen', 'linux', 'dumb'])(
    'runs the daily inline flow with TERM=%s',
    async (terminalType) => {
      const shell = new PtyShell(replayFixture, undefined, hardeningCwd, {
        DSH_HOME: hardeningHome, TERM: terminalType,
      })
      try {
        const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)}`)
        const commandAt = shell.output.length
        shell.write('/dashi-slow-fixture\r')
        await shell.waitFor('running /dashi-slow-fixture', commandAt)
        if (terminalType === 'dumb') {
          expect(shell.output.slice(commandAt)).toContain('[running] /dashi-slow-fixture')
          expect(shell.output.slice(commandAt)).not.toMatch(/[\u2800-\u28ff]/u)
        }
        await shell.waitFor('Slow fixture complete.', commandAt)

        const promptAt = shell.output.length
        shell.write(`daily flow ${terminalType}\r`)
        await shell.waitFor('Approval · bash', promptAt)
        shell.write('\r')
        const doneAt = await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', promptAt)
        await shell.waitFor('idle ·', doneAt)
        const pickerAt = shell.output.length
        shell.write('/model\r')
        await shell.waitFor('Model', pickerAt)
        shell.write('\u001B')
        await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('Resume with:', releasedAt)
        expect(shell.output.slice(start)).not.toContain('dashi: terminal failure')
      } finally {
        await shell.close()
      }
    },
    60_000,
  )

  it('keeps full-screen wheel scrolling separate from prompt recall across the TERM matrix', async () => {
    const created = new PtyShell(replayFixture, undefined, hardeningCwd, { DSH_HOME: hardeningHome })
    let id = ''
    try {
      const start = await launch(created, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(created.output, start)
      const releasedAt = created.output.length
      created.write('\u0004\u0004')
      await created.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await created.close()
    }
    generateLargeSession(id, 30, 0, hardeningHome)

    for (const terminalType of ['xterm-256color', 'tmux-256color', 'screen', 'linux', 'dumb']) {
      const shell = new PtyShell(threeTurnFixture, undefined, hardeningCwd, {
        DSH_HOME: hardeningHome, TERM: terminalType,
      })
      try {
        const start = await launch(shell,
          `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}`)
        await shell.waitFor('idle ·', start)
        const draft = `wheel draft ${terminalType}`
        shell.write(draft)
        await shell.waitFor(draft, start)
        const wheelAt = shell.output.length
        shell.write('\u001B[<64;12;7M')
        await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
        const frame = await firstFrame(shell.output.slice(start))
        expect(frame, terminalType).toContain(draft)
        expect(frame, terminalType).toMatch(/large (?:answer|prompt) \d+/u)
        expect(shell.output.slice(wheelAt), terminalType).not.toContain('dashi: terminal failure')
        shell.write('\u0003')
        await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
    }
  }, 120_000)

  it.each(['tmux', 'screen'] satisfies MultiplexerKind[])(
    'runs the daily inline flow inside a private %s server and restores its pane',
    async (kind) => {
      const pane = new MultiplexerPane(kind, testDir, hardeningCwd, {
        ...process.env, DSH_HOME: hardeningHome, DSH_SNAPSHOT_FILE: replayFixture,
        DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', PROMPT_COMMAND: '', PS1: '',
      })
      try {
        pane.send(`stty -g > ${quote(pane.modeBefore)}; ${quote(dsh)} --profile dashi --patch ${quote(replayPatch)}; code=$?; stty -g > ${quote(pane.modeAfter)}; printf '__MUX_EXIT__%s\\n' "$code"\r`)
        const opened = await pane.waitFor('session-')
        pane.send(`multiplexer daily flow ${kind}\r`)
        await pane.waitFor('Approval · bash')
        pane.send('\r')
        await pane.waitFor('DASHI_TOOL_ROUND_TRIP complete.')
        pane.send('\u0004\u0004')
        const closed = await pane.waitFor('__MUX_EXIT__0')
        expect(opened).not.toContain('dashi: terminal failure')
        expect(closed).toContain('Resume with:')
        expect(pane.restored()).toBe(true)
      } finally {
        pane.close()
      }
    },
    60_000,
  )

  it.each(['tmux', 'screen'] satisfies MultiplexerKind[])(
    'scrolls by wheel in full-screen mode inside a private %s server and restores its pane',
    async (kind) => {
      const created = new PtyShell(replayFixture, undefined, hardeningCwd, { DSH_HOME: hardeningHome })
      let id = ''
      try {
        const start = await launch(created, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
        id = sessionId(created.output, start)
        const releasedAt = created.output.length
        created.write('\u0004\u0004')
        await created.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await created.close()
      }
      generateLargeSession(id, 30, 0, hardeningHome)

      const pane = new MultiplexerPane(kind, testDir, hardeningCwd, {
        ...process.env, DSH_HOME: hardeningHome, DSH_SNAPSHOT_FILE: threeTurnFixture,
        DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', PROMPT_COMMAND: '', PS1: '',
      })
      try {
        pane.send(`stty -g > ${quote(pane.modeBefore)}; ${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}; code=$?; stty -g > ${quote(pane.modeAfter)}; printf '__MUX_EXIT__%s\\n' "$code"\r`)
        await pane.waitFor('idle ·')
        const draft = `mux wheel draft ${kind}`
        pane.send(draft)
        await pane.waitFor(draft)
        pane.send('\u001B[<64;12;7M')
        const scrolled = await pane.waitFor('large answer')
        expect(scrolled).toContain(draft)
        pane.send('\u0003')
        await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
        pane.send('\u0004\u0004')
        await pane.waitFor('__MUX_EXIT__0')
        expect(pane.restored()).toBe(true)
      } finally {
        pane.close()
      }
    },
    90_000,
  )

  it.each([
    ['inline', ''],
    ['full-screen', '--fullscreen'],
  ])('survives resize during streaming in %s mode', async (_label, mode) => {
    const shell = new PtyShell(chunkStormSnapshot(300), undefined, hardeningCwd, {
      DSH_HOME: hardeningHome, DSH_REPLAY_PACE_MS: '5',
    })
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} ${mode}`)
      const turnAt = shell.output.length
      shell.write('resize the stream\r')
      const runningAt = await shell.waitFor('running ·', turnAt)
      await shell.waitFor('STORM_START', start)
      const narrowOutputAt = shell.output.length
      const narrowAt = shell.output.length - start
      shell.resize(48, 12)
      await shell.waitFor('STORM_MIDDLE', narrowOutputAt)
      const wideOutputAt = shell.output.length
      const wideAt = shell.output.length - start
      shell.resize(100, 30)
      await shell.waitFor('STORM_END', wideOutputAt)
      await shell.waitFor('idle ·', runningAt + 1)
      const frame = await resizedFrame(shell.output.slice(start), [
        { at: narrowAt, columns: 48, rows: 12 },
        { at: wideAt, columns: 100, rows: 30 },
      ])
      expect(frame).toContain('STORM_END')
      expect(frame).toContain('idle ·')
      expect(frame).not.toContain('\uFFFD')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it.each([
    ['inline', ''],
    ['full-screen', '--fullscreen'],
  ])('keeps a resized decision answerable in %s mode', async (_label, mode) => {
    const shell = new PtyShell(replayFixture, undefined, hardeningCwd, { DSH_HOME: hardeningHome })
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} ${mode} 'resize decision'`)
      await shell.waitFor('Approval · bash', start)
      const narrowOutputAt = shell.output.length
      const narrowAt = shell.output.length - start
      shell.resize(48, 12)
      await shell.waitFor('Allow once', narrowOutputAt)
      const wideOutputAt = shell.output.length
      const wideAt = shell.output.length - start
      shell.resize(100, 30)
      await shell.waitFor('Approval · bash', wideOutputAt)
      const frame = await resizedFrame(shell.output.slice(start), [
        { at: narrowAt, columns: 48, rows: 12 },
        { at: wideAt, columns: 100, rows: 30 },
      ])
      expect(frame).toContain('Approval · bash')
      expect(frame).toContain('Allow once')
      expect(frame).not.toContain('\uFFFD')
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('scrolls three transcript lines per full-screen wheel notch without changing the composer', async () => {
    const created = new PtyShell()
    let id = ''
    try {
      const start = await launch(created,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(created.output, start)
      const releasedAt = created.output.length
      created.write('\u0004\u0004')
      await created.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await created.close()
    }
    expect(generateLargeSession(id, 30, 0)).toEqual({ events: 120, toolCells: 0 })

    const shell = new PtyShell(threeTurnFixture)
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}`)
      await shell.waitFor('idle ·', start)
      expect(shell.output.slice(start)).toContain('\u001B[?1000h')
      expect(shell.output.slice(start)).toContain('\u001B[?1002h')
      expect(shell.output.slice(start)).toContain('\u001B[?1006h')

      shell.write('DASHI_WHEEL_DRAFT')
      await shell.waitFor('DASHI_WHEEL_DRAFT', start)
      const wheelAt = shell.output.length
      shell.write('\u001B[<64;12;7M')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      expect(shell.output.slice(wheelAt)).toMatch(/large (?:answer|prompt) \d+/u)

      shell.write('\r')
      const runningAt = await shell.waitFor('running ·', wheelAt)
      await shell.waitFor('idle ·', runningAt + 1)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const userMessages = sessionEvents(id).filter(event => event.type === 'user/message')
    expect(userMessages.some(event => JSON.stringify(event.data).includes('DASHI_WHEEL_DRAFT'))).toBe(true)
  }, 60_000)

  it('lists cwd sessions as human columns and all sessions as stable JSON without terminal takeover', async () => {
    const firstCwd = join(testDir, 'session-list-first')
    const otherCwd = join(testDir, 'session-list-other')
    mkdirSync(firstCwd, { recursive: true })
    mkdirSync(otherCwd, { recursive: true })
    const first = await createNamedSession(firstCwd, 'List first')
    const second = await createNamedSession(firstCwd, 'List second')
    const other = await createNamedSession(otherCwd, 'List other')
    expect(sessionLog(first).header).toMatchObject({ cwd: firstCwd, id: first })
    expect(sessionLog(second).header).toMatchObject({ cwd: firstCwd, id: second })
    expect(sessionLog(other).header).toMatchObject({ cwd: otherCwd, id: other })

    const human = new PtyShell(replayFixture, undefined, firstCwd)
    try {
      const start = human.output.length
      human.write(`${quote(dsh)} --profile dashi --patch ${quote(sessionListPatch)} sessions list; printf '__LIST_EXIT__%s\\n' "$?"\n`)
      const exitAt = await human.waitFor('__LIST_EXIT__0', start)
      const output = human.output.slice(start, exitAt)
      expect(output).toContain('UUID')
      expect(output).toContain('TITLE')
      expect(output).toContain('CWD')
      expect(output).toContain('UPDATED')
      expect(output).toContain(first)
      expect(output).toContain(second)
      expect(output).not.toContain(other)
      expect(output).not.toContain('\u001B[?1049h')
      expect(output).not.toContain('\u001B[?1049l')
    } finally {
      await human.close()
    }

    const all = new PtyShell(replayFixture, undefined, firstCwd)
    try {
      const start = all.output.length
      all.write(`${quote(dsh)} --profile dashi --patch ${quote(sessionListPatch)} sessions list --all --json; printf '__JSON_EXIT__%s\\n' "$?"\n`)
      const exitAt = await all.waitFor('__JSON_EXIT__0', start)
      const output = all.output.slice(start, exitAt)
      const jsonAt = output.indexOf('{\r\n')
      expect(jsonAt).toBeGreaterThanOrEqual(0)
      const envelope = JSON.parse(output.slice(jsonAt).replaceAll('\r', '').trim()) as {
        sessions: Array<Record<string, unknown>>
        version: number
      }
      expect(envelope.version).toBe(1)
      expect(envelope.sessions).toEqual(expect.arrayContaining([
        expect.objectContaining({ sessionId: first, title: 'List first', cwd: firstCwd }),
        expect.objectContaining({ sessionId: second, title: 'List second', cwd: firstCwd }),
        expect.objectContaining({ sessionId: other, title: 'List other', cwd: otherCwd }),
      ]))
      expect(envelope.sessions.every(item => !Object.hasOwn(item, 'running'))).toBe(true)
      expect(output).not.toContain('\u001B[?1049h')
      expect(output).not.toContain('\u001B[?1049l')
    } finally {
      await all.close()
    }
  }, 90_000)

  it.each([
    ['Ctrl+D twice', async (shell: PtyShell) => {
      const armedAt = shell.output.length
      shell.write('\u0004')
      await shell.waitFor('Ctrl+C or Ctrl+D again to exit', armedAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 250) })
      shell.write('\u0004')
    }],
    ['Ctrl+C twice', (shell: PtyShell) => { shell.write('\u0003\u0003') }],
    ['SIGINT', (shell: PtyShell) => { process.kill(shell.childPid(), 'SIGINT') }],
    ['SIGTERM', (shell: PtyShell) => { process.kill(shell.childPid(), 'SIGTERM') }],
  ])('restores the terminal after %s', async (_label, stop) => {
    const { baseline, shell } = await prepareShell()
    try {
      await launch(shell)
      const releasedAt = shell.output.length
      await stop(shell)
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await shell.waitFor('Resume with:', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('expires the Ctrl+D exit arm after two seconds', async () => {
    const { baseline, shell } = await prepareShell()
    try {
      await launch(shell)
      const armedAt = shell.output.length
      shell.write('\u0004')
      await shell.waitFor('Ctrl+C or Ctrl+D again to exit', armedAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 2_500) })
      expect(await firstFrame(shell.output)).not.toContain('Ctrl+C or Ctrl+D again to exit')
      const rearmedAt = shell.output.length
      shell.write('\u0004')
      await shell.waitFor('Ctrl+C or Ctrl+D again to exit', rearmedAt)
      shell.write('\u0004')
      await shell.waitFor('\u001B[?1049l', rearmedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('hands the terminal to the shell while suspended and redraws after fg', async () => {
    const { baseline, shell } = await prepareShell()
    try {
      await launch(shell)
      const suspendedAt = shell.output.length
      shell.write('\u001A')
      await shell.waitFor('\u001B[?1049l', suspendedAt)
      shell.write("printf '__SUSPENDED__\\n'\n")
      await shell.waitFor('__SUSPENDED__', suspendedAt)
      const resumedAt = shell.output.length
      shell.write('fg\n')
      await shell.waitFor('session-', resumedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await shell.waitFor('Resume with:', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('restores after stdin is already closed', async () => {
    const { baseline, shell } = await prepareShell()
    try {
      const start = shell.output.length
      shell.write(`${quote(dsh)} --profile dashi --fullscreen <&-\n`)
      await expectRestored(shell, baseline)
      const lifecycle = shell.output.slice(start)
      expect(lifecycle).toContain('\u001B[?2004h')
      expect(lifecycle).toContain('\u001B[?2004l')
      expect(lifecycle).toContain('\u001B[?1049h')
      expect(lifecycle).toContain('\u001B[?1049l')
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('prints the effect failure before restoring the terminal', async () => {
    const { baseline, shell } = await prepareShell()
    try {
      await launch(shell, `${quote(process.execPath)} ${quote(failureFixture)}`, 'no session')
      const failedAt = shell.output.length
      shell.write('\u000C')
      await shell.waitFor('fixture redraw failure', failedAt)
      await shell.waitFor('\u001B[?1049l', failedAt)
      expect(shell.output.indexOf('fixture redraw failure', failedAt))
        .toBeLessThan(shell.output.indexOf('\u001B[?1049l', failedAt))
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('restores and leaves the session resumable after stdout breaks mid-stream', async () => {
    const { baseline, shell } = await prepareShell({
      DSH_DASHI_BREAK_STDOUT: '1', DSH_HOME: hardeningHome,
    }, hardeningCwd)
    let id = ''
    try {
      const start = shell.output.length
      shell.write(`${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'break stdout'; printf '__EPIPE_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('session-', start)
      id = sessionId(shell.output, start)
      await shell.waitFor('fixture EPIPE: broken stdout', start)
      await shell.waitFor('__EPIPE_EXIT__1', start)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
    await expectResumable(id, replayFixture, { DSH_HOME: hardeningHome }, hardeningCwd)
  }, 60_000)

  it('restores and leaves the session resumable when stdin closes during a decision', async () => {
    const { baseline, shell } = await prepareShell({ DSH_HOME: hardeningHome }, hardeningCwd)
    const writerPidFile = join(testDir, 'decision-stdin-writer.pid')
    let writerPid: number | undefined
    let id = ''
    try {
      const start = shell.output.length
      shell.write(`{ printf 'close stdin\\r'; printf '%s' "$BASHPID" > ${quote(writerPidFile)}; exec tail -f /dev/null; } | ${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen; printf '__DECISION_EOF__%s\\n' "$?"\n`)
      await shell.waitFor('session-', start)
      id = sessionId(shell.output, start)
      await shell.waitFor('Approval · bash', start)
      writerPid = Number(readFileSync(writerPidFile, 'utf8'))
      process.kill(writerPid, 'SIGTERM')
      writerPid = undefined
      await shell.waitFor('__DECISION_EOF__0', start)
      const lifecycle = shell.output.slice(start)
      expect(lifecycle).toContain('\u001B[?1049h')
      expect(lifecycle).toContain('\u001B[?1049l')
      await expectRestored(shell, baseline)
    } finally {
      if (writerPid !== undefined) {
        try { process.kill(writerPid, 'SIGTERM') } catch {}
      }
      await shell.close()
    }
    await expectResumable(id, replayFixture, { DSH_HOME: hardeningHome }, hardeningCwd)
  }, testCeiling(60_000))

  it('restores and leaves the session resumable on SIGTERM during a pending command', async () => {
    const { baseline, shell } = await prepareShell({ DSH_HOME: hardeningHome }, hardeningCwd)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/dashi-slow-fixture\r')
      const runningAt = await shell.waitFor('running /dashi-slow-fixture', start)
      process.kill(shell.childPid(), 'SIGTERM')
      await shell.waitFor('\u001B[?1049l', runningAt)
      await shell.waitFor('Resume with:', runningAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
    await expectResumable(id, replayFixture, { DSH_HOME: hardeningHome }, hardeningCwd)
  }, 60_000)

  it('contains a throwing presenter across resize and keeps the session resumable', async () => {
    const snapshot = presenterFailureSnapshot()
    const { baseline, shell } = await prepareShell({
      DSH_HOME: hardeningHome, DSH_SNAPSHOT_FILE: snapshot,
    }, hardeningCwd)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('resize the broken presenter\r')
      await shell.waitFor('dashi_presenter_failure', start)
      shell.resize(48, 12)
      await shell.waitFor('Presenter recovery complete.', start)
      shell.resize(100, 30)
      shell.write('\u000F')
      await shell.waitFor('DASHI_PRESENTER_RESULT', start)
      expect(shell.output.slice(start)).not.toContain('dashi: terminal failure')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id, hardeningHome).some(event => event.type === 'tool/result')).toBe(true)
    await expectResumable(id, snapshot, { DSH_HOME: hardeningHome }, hardeningCwd)
  }, 60_000)

  it('streams a recorded tool turn and resumes its native session by exact UUID', async () => {
    const { baseline, shell } = await prepareShell()
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'run the recorded turn'`)
      id = sessionId(shell.output, start)
      await shell.waitFor('Approval · bash', start)
      expect(countAudibleBells(shell.output.slice(start))).toBe(1)
      shell.write('\r')
      await shell.waitFor('Recorded answer:', start)
      expect(shell.output.slice(start)).not.toContain('DASHI_TOOL_ROUND_TRIP complete.')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('completed', start)
      expect(shell.output.slice(start)).toContain('printf DASHI_TOOL_ROUND_TRIP')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor(`Resume with: dsh --profile dashi --resume ${id}`, releasedAt)
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }

    const file = findSessionFile(join(home, 'replay-sessions'), id)
    const events = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .slice(1).map(line => JSON.parse(line) as { type: string; data?: { outcome?: string } })
    expect(events.some(event => event.type === 'approval/asked')).toBe(true)
    expect(events.some(event => event.type === 'approval/decided'
      && event.data?.outcome === 'allowed-once')).toBe(true)

    const resumed = await prepareShell()
    try {
      const start = await launch(resumed.shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${id}`)
      await resumed.shell.waitFor('Recorded answer:', start)
      await resumed.shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      const releasedAt = resumed.shell.output.length
      resumed.shell.write('\u0004\u0004')
      await resumed.shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(resumed.shell, resumed.baseline)
    } finally {
      await resumed.shell.close()
    }
  }, 60_000)

  it('suppresses the decision bell in accessible mode', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --accessible 'request approval'`)
      await shell.waitFor('Approval · bash', start)
      await shell.waitFor('3 items · selected 1: Allow once', start)
      expect(countAudibleBells(shell.output.slice(start))).toBe(0)
      expect(shell.output.slice(start)).not.toContain('\u001B[?1049h')
      expect(shell.output.slice(start)).not.toMatch(/[\u2800-\u28ff]/u)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', start)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('runs the daily prompt, tool, decision, picker, and rewind flow inline without alt-screen output', async () => {
    const { baseline, shell } = await prepareShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --inline`)
      shell.write('first inline prompt\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('printf DASHI_TOOL_ROUND_TRIP', start)
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', shell.output.length - 300)

      const pickerAt = shell.output.length
      shell.write('/model\r')
      await shell.waitFor('Model', pickerAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })

      const secondAt = shell.output.length
      shell.write('second inline prompt\r')
      await shell.waitFor('Queued turn complete.', secondAt)
      await shell.waitFor('idle ·', secondAt)
      const rewindAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('Rewind to a prompt', rewindAt)
      shell.write('\r')
      await shell.waitFor('Restore conversation', rewindAt)
      shell.write('\r')
      await waitForOtherSession(shell, sessionId(shell.output, start), rewindAt)

      const clearAt = shell.output.length
      shell.write('\u0003')
      await shell.waitFor('\r\u001B[2K', clearAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
      await expectRestored(shell, baseline)
      const lifecycle = shell.output.slice(start, shell.output.indexOf('__MODE_AFTER__', releasedAt))
      expect(lifecycle).not.toContain('\u001B[?1049h')
      expect(lifecycle).not.toContain('\u001B[?1049l')
      for (const mode of ['1000', '1002', '1003', '1006']) {
        expect(lifecycle).not.toContain(`\u001B[?${mode}h`)
      }
      expect(Buffer.byteLength(lifecycle)).toBeLessThan(512 * 1024)
    } finally {
      await shell.close()
    }
  }, 90_000)

  it('injects one shell result without waking a turn and exposes it to the next request', async () => {
    const shell = new PtyShell(requestContextFixture)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      const commandAt = shell.output.length
      shell.write('!printf DASHI_SHELL_OUTPUT\r')
      await shell.waitFor('DASHI_SHELL_OUTPUT', commandAt)
      await shell.waitFor('[exit 0]', commandAt)
      shell.write('use the shell result\r')
      await shell.waitFor('Observed injected output: DASHI_SHELL_OUTPUT', commandAt)
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', commandAt)
    } finally {
      await shell.close()
    }

    const events = sessionLog(id).events
    const inserted = events.filter(event => event.type === 'agent/inbox/spliced'
      && JSON.stringify(event.data).includes('DASHI_SHELL_OUTPUT')
      && JSON.stringify(event.data).includes('"plugin":"dashi"'))
    expect(inserted).toHaveLength(1)
    expect(JSON.stringify(inserted[0]?.data)).toContain('"form":"notice"')
    const insertedAt = events.indexOf(inserted[0]!)
    expect(events.findIndex(event => event.type === 'turn/start')).toBeGreaterThan(insertedAt)
    expect(events.some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('DASHI_SHELL_OUTPUT'))).toBe(true)
  }, 60_000)

  it('closes stdin, reports sandbox denial, and kills a command at the deadline', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('!if read value; then printf BAD; else printf DASHI_STDIN_EOF; fi\r')
      await shell.waitFor('DASHI_STDIN_EOF', start)
      shell.write('!printf denied > /etc/dashi-w010-denied\r')
      await shell.waitFor('sandbox denied file access', start)
      const timeoutAt = shell.output.length
      shell.write('!sleep 60\r')
      await shell.waitFor('timed out after 30000 ms', timeoutAt, 40_000)
      await shell.waitFor('suspend dashi with Ctrl+Z', timeoutAt)
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', timeoutAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('rings once when a turn crosses the ten-second threshold', async () => {
    const shell = new PtyShell(longTurnFixture, undefined, root, { DSH_REPLAY_PACE_MS: '5500' })
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'run a long recorded turn'`)
      const completeAt = await shell.waitFor('Long recorded turn complete.', start, 20_000)
      await shell.waitFor('idle ·', completeAt)
      await shell.waitForAudibleBell(start)
      expect(countAudibleBells(shell.output.slice(start))).toBe(1)
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', start)
    } finally {
      await shell.close()
    }
  }, 45_000)

  it('persists --name without creating a message', async () => {
    const cwd = join(testDir, `named-${String(Date.now())}`)
    mkdirSync(cwd)
    const { baseline, shell } = await prepareShell({}, cwd)
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --name 'Named without prompt'`)
      id = sessionId(shell.output, start)
      await shell.waitFor('Named without prompt', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }

    const file = findSessionFile(join(home, 'replay-sessions'), id)
    expect(file).not.toBe('')
    const events = readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .slice(1).map(line => JSON.parse(line) as { type: string; data?: { title?: string } })
    expect(events.some(event => event.type === 'session/title'
      && event.data?.title === 'Named without prompt')).toBe(true)
    expect(events.some(event => event.type === 'user/message')).toBe(false)

    const continued = await prepareShell({}, cwd)
    try {
      const start = await launch(continued.shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --continue`)
      expect(sessionId(continued.shell.output, start)).toBe(id)
      await continued.shell.waitFor('Named without prompt', start)
      const releasedAt = continued.shell.output.length
      continued.shell.write('\u0004\u0004')
      await continued.shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(continued.shell, continued.baseline)
    } finally {
      await continued.shell.close()
    }
  }, 30_000)

  it('interrupts a running stream, restores the terminal, and resumes the root', async () => {
    const { baseline, shell } = await prepareShell()
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'interrupt the recorded turn'`)
      id = sessionId(shell.output, start)
      await shell.waitFor('Inspecting the recorded request.', start)
      shell.write('\u001B')
      await shell.waitFor('interrupted (user)', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }

    const resumed = await prepareShell()
    try {
      const start = await launch(resumed.shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${id}`)
      await resumed.shell.waitFor('interrupted (user)', start)
      const releasedAt = resumed.shell.output.length
      resumed.shell.write('\u0004\u0004')
      await resumed.shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(resumed.shell, resumed.baseline)
    } finally {
      await resumed.shell.close()
    }
  }, 60_000)

  it('persists steering in the running turn and queues the next turn', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'exercise both send modes'`)
      id = sessionId(shell.output, start)
      await shell.waitFor('Inspecting the recorded request.', start)
      shell.write('steer into next step\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('Recorded answer:', start)
      shell.write('\u0014queued after turn\r')
      const queuedAt = await shell.waitFor('Queued turn complete.', start)
      await shell.waitFor('idle ·', queuedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const file = findSessionFile(join(home, 'replay-sessions'), id)
    const events = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1)
      .map(line => JSON.parse(line) as { type: string; data?: unknown })
    const hasText = (event: { data?: unknown }, text: string): boolean =>
      JSON.stringify(event.data).includes(text)
    const steer = events.findIndex(event => event.type === 'user/message'
      && hasText(event, 'steer into next step'))
    const firstEnd = events.findIndex(event => event.type === 'turn/end')
    const queued = events.findIndex(event => event.type === 'user/message'
      && hasText(event, 'queued after turn'))
    expect(steer).toBeGreaterThan(-1)
    expect(firstEnd).toBeGreaterThan(steer)
    expect(queued).toBeGreaterThan(firstEnd)
  }, 60_000)

  it('answers a fixture tool question batch including custom text', async () => {
    const shell = new PtyShell(questionFixture)
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'ask the recorded questions'`)
      id = sessionId(shell.output, start)
      await shell.waitFor('Package manager', start)
      shell.write('1\r')
      await shell.waitFor('Why this choice?', start)
      shell.write('fast and reliable\r')
      const completedAt = await shell.waitFor('Question fixture complete.', start)
      await shell.waitFor('idle ·', completedAt)
      expect(shell.output.slice(start)).toContain('Ask terminal fixture questions')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const file = findSessionFile(join(home, 'replay-sessions'), id)
    const content = readFileSync(file, 'utf8')
    expect(content).toContain('fast and reliable')
    expect(content).toContain('pnpm')
  }, 30_000)

  it('executes a native command through DSH and renders its paired command cell', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/compact\r')
      await shell.waitFor('No compactable history yet.', start)
      expect(shell.output.slice(start)).toContain('/compact')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const events = sessionEvents(id)
    expect(events.some(event => event.type === 'command/run' && event.data?.name === 'compact')).toBe(true)
    expect(events.some(event => event.type === 'command/done' && event.data?.kind === 'success')).toBe(true)
    expect(events.some(event => event.type === 'user/message')).toBe(false)
  }, 30_000)

  it('renders a slow command as running before its durable completion', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/dashi-slow-fixture\r')
      await shell.waitFor('running /dashi-slow-fixture', start)
      expect(shell.output.slice(start)).not.toContain('Slow fixture complete.')
      expect(shell.output.slice(start)).toMatch(/[\u2800-\u28ff] \/dashi-slow-fixture · 0s/u)
      await shell.waitFor('Slow fixture complete.', start)
      const screen = await firstFrame(shell.output.slice(start))
      expect(screen).toContain('◆ /dashi-slow-fixture')
      expect(screen).not.toContain('running /dashi-slow-fixture')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const events = sessionEvents(id)
    const run = events.findIndex(event => event.type === 'command/run'
      && event.data?.name === 'dashi-slow-fixture')
    const done = events.findIndex(event => event.type === 'command/done')
    expect(run).toBeGreaterThan(-1)
    expect(done).toBeGreaterThan(run)
  }, 30_000)

  it('inserts a user-invocable skill token as prompt text, never as a command', async () => {
    const workspace = join(testDir, 'workspace-skill-fixture')
    const skill = join(workspace, '.dsh', 'skills', 'workspace-proof')
    const preStepEvents = join(testDir, 'workspace-skill-pre-step.jsonl')
    mkdirSync(join(workspace, '.git'), { recursive: true })
    mkdirSync(skill, { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), [
      '---',
      'name: workspace-proof',
      'description: Prove DSH project skill discovery',
      'user-invocable: true',
      '---',
      'WORKSPACE_SKILL_BODY',
    ].join('\n'))
    const shell = new PtyShell(replayFixture, undefined, workspace, {
      DSH_DASHI_PRE_STEP_EVENTS: preStepEvents,
    })
    shell.resize(240, 30)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/skills\r')
      await shell.waitFor('/workspace-proof', start)
      await shell.waitFor('user yes · model yes · source project-dsh · provider filesystem · path ', start)
      await shell.waitFor('workspace-proof/SKILL.md', start)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const filteredAt = shell.output.length
      shell.write('/skills project skill discovery\r')
      await shell.waitFor('/workspace-proof', filteredAt)
      const filtered = await firstFrame(shell.output.slice(filteredAt))
      expect(filtered).not.toContain('/dashi-fixture-skill')
      shell.write('\r')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      shell.write('use the fixture\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const events = sessionEvents(id)
    expect(events.some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('/workspace-proof use the fixture'))).toBe(true)
    expect(events.some(event => event.type === 'command/run'
      && event.data?.name === 'workspace-proof')).toBe(false)
    const preStep = readFileSync(preStepEvents, 'utf8')
    expect(preStep).toContain('"kind":"skill-invocation"')
    expect(preStep).toContain('"name":"workspace-proof"')
    expect(preStep).toContain('WORKSPACE_SKILL_BODY')
  }, 60_000)

  it('runs parity commands through DSH services and preserves native preset ownership', async () => {
    const workspace = join(testDir, 'parity-commands')
    mkdirSync(join(workspace, '.git'), { recursive: true })
    const shell = new PtyShell(replayFixture, undefined, workspace)
    let first = ''
    let second = ''
    let third = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      first = sessionId(shell.output, start)

      const blankAgentsAt = shell.output.length
      shell.write('/agents\r')
      await shell.waitFor('The current session is blank.', blankAgentsAt)
      shell.write('\r')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })

      shell.write('exercise parity commands\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      const turnDone = await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', turnDone)

      const exportAt = shell.output.length
      shell.write('/export transcript.md\r')
      await shell.waitFor('exported', exportAt)
      const markdown = readFileSync(join(workspace, 'transcript.md'), 'utf8')
      expect(markdown).toContain('## User\n\nexercise parity commands')
      expect(markdown).toContain('DASHI_TOOL_ROUND_TRIP complete.')

      const contextAt = shell.output.length
      shell.write('/context\r')
      await shell.waitFor('System prompt:', contextAt)
      await shell.waitFor('heuristic estimates', contextAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })

      const startedAgentsAt = shell.output.length
      shell.write('/agents\r')
      await shell.waitFor('Choosing a preset starts a new session.', startedAgentsAt)
      shell.write('\r')
      second = await waitForOtherSession(shell, first, startedAgentsAt)

      const clearAt = shell.output.length
      shell.write('/clear\r')
      third = await waitForOtherSession(shell, second, clearAt)
      expect(third).not.toBe(first)

      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const firstEvents = sessionEvents(first)
    expect(firstEvents.some(event => event.type === 'agent-preset/selected'
      && event.data?.agentPreset === 'standard')).toBe(true)
    for (const name of ['agents', 'export', 'context']) {
      expect(firstEvents.some(event => event.type === 'command/run' && event.data?.name === name)).toBe(true)
    }
    expect(sessionEvents(second).some(event => event.type === 'command/run'
      && event.data?.name === 'clear')).toBe(true)
  }, 90_000)

  it('renames through the native title service and flushes the durable event', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/rename Terminal title\r')
      await shell.waitFor('Terminal title', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id).some(event => event.type === 'session/title'
      && event.data?.title === 'Terminal title')).toBe(true)
  }, 30_000)

  it('creates a root, resumes through the picker, and emits post-swap root events in order', async () => {
    const eventsFile = join(testDir, `root-events-${String(Date.now())}.jsonl`)
    const cwd = join(testDir, `root-lifecycle-${String(Date.now())}`)
    mkdirSync(cwd)
    const shell = new PtyShell(replayFixture, eventsFile, cwd)
    let first = ''
    let second = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      first = sessionId(shell.output, start)
      const createdAt = shell.output.length
      shell.write('/new --name New root\r')
      second = await waitForOtherSession(shell, first, createdAt)
      await shell.waitFor('New root', createdAt)

      const pickerAt = shell.output.length
      shell.write('/resume\r')
      await shell.waitFor('Resume session', pickerAt)
      shell.write('\u001B[B\r')
      await shell.waitFor(first, pickerAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const events = readFileSync(eventsFile, 'utf8').trim().split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
    const rootChanges = events.filter(event => event.event === 'tui/root-changed')
    expect(rootChanges).toEqual([
      { event: 'tui/root-changed', accessor: first, current: first, previous: null },
      {
        event: 'tui/root-changed', accessor: second, current: second, previous: first,
        previousRegistered: true, previousStatus: 'idle',
      },
      {
        event: 'tui/root-changed', accessor: first, current: first, previous: second,
        previousRegistered: true, previousStatus: 'idle',
      },
      {
        event: 'tui/root-changed', accessor: null, current: null, previous: first,
        previousRegistered: true, previousStatus: 'idle',
      },
    ])
  }, 45_000)

  it('/quit aliases /exit', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('/quit\r')
      await shell.waitFor('\u001B[?1049l', start)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('/reset aliases /clear', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const first = sessionId(shell.output, start)
      shell.write('/reset\r')
      await waitForOtherSession(shell, first, start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('/continue aliases /resume', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('/continue\r')
      await shell.waitFor('Resume session', start)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('/branch aliases /fork', async () => {
    const shell = new PtyShell(threeTurnFixture)
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const parent = sessionId(shell.output, start)
      const turnAt = shell.output.length
      shell.write('branch source\r')
      await shell.waitFor('First turn complete.', turnAt)
      await shell.waitFor('idle ·', turnAt)
      const branchAt = shell.output.length
      shell.write('/branch\r')
      const child = await waitForOtherSession(shell, parent, branchAt)
      expect(sessionLog(child).header.parentSession).toBe(parent)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('/effort selects reasoning effort for the current model', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --provider deepseek-official --model deepseek-v4-flash`)
      shell.write('/effort low\r')
      await shell.waitFor('◆ /effort low', start)
      shell.write('/status\r')
      await shell.waitFor('Effort: low', start)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('applies -n, --agent, and --session-id to DSH fresh creation', async () => {
    const id = 'session-00000000-0000-0000-0000-000000000040'
    const shell = new PtyShell(replayFixture, undefined, root, {
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen -n 'W040 named' --agent standard --session-id ${id}`,
        'idle ·')
      await shell.waitFor('W040 named', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionLog(id).header).toMatchObject({ agentPreset: 'standard', id })
  }, 30_000)

  it.each(['--resume', '--continue'])('forks the %s target for --fork-session', async (targetFlag) => {
    const cwd = join(testDir, `fork-session-${targetFlag.slice(2)}`)
    mkdirSync(cwd)
    const source = await createNamedSession(cwd, `W040 ${targetFlag}`)
    const shell = new PtyShell(replayFixture, undefined, cwd, {
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const argument = targetFlag === '--resume' ? `${targetFlag} ${source}` : targetFlag
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen ${argument} --fork-session`,
        'idle ·')
      const child = await waitForOtherSession(shell, source, start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      expect(sessionLog(child).header.parentSession).toBe(source)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('selects a model through the controller and records the durable selection', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      const pickerAt = shell.output.length
      shell.write('/model\r')
      await shell.waitFor('Model', pickerAt)
      shell.write('\r')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id).some(event => event.type === 'model/selection')).toBe(true)
  }, 30_000)

  it.each(['--yolo', '--dangerously-skip-permissions'])(
    'applies launch model, effort, and %s before the first prompt', async (dangerFlag) => {
      const shell = new PtyShell(replayFixture, undefined, root, {
        DSH_HOME: launchFlagsHome,
        PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      })
      let id = ''
      try {
        const start = await launch(shell,
          `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --provider deepseek-official --model deepseek-v4-flash --effort low ${dangerFlag} 'launch flags'`)
        id = sessionId(shell.output, start)
        await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
        await shell.waitFor('idle ·', start)
        expect(shell.output.slice(start)).not.toContain('Approval · bash')
        shell.write('/status\r')
        await shell.waitFor('Model: deepseek-official/deepseek-v4-flash', start)
        await shell.waitFor('Effort: low', start)
        await shell.waitFor('Permission: danger-full-access', start)
        const closedAt = shell.output.length
        shell.write('\u001B')
        await shell.waitFor('idle ·', closedAt)
        await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
      const events = sessionEvents(id, launchFlagsHome)
      expect(events.some(event => event.type === 'model/selection'
        && event.data?.reasoningEffort === 'low')).toBe(true)
      expect(events.some(event => event.type === 'permission/preset'
        && event.data?.preset === 'danger-full-access')).toBe(true)
      expect(events.some(event => event.type === 'command/run'
        && event.data?.name === 'permission')).toBe(true)
    }, 45_000)

  it('restricts the model tool roster through launch flags and rejects unknown names', async () => {
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`
    for (const expected of [
      { args: '--disallowedTools bash', absent: 'bash', present: 'read' },
      { args: '--tools bash', absent: 'read', present: 'bash' },
    ]) {
      const shell = new PtyShell(threeTurnFixture, undefined, root, {
        DSH_HOME: launchFlagsHome,
        PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      })
      let id = ''
      try {
        const start = await launch(shell, `${launcher} ${expected.args} 'restricted roster'`)
        id = sessionId(shell.output, start)
        await shell.waitFor('First turn complete.', start)
        await shell.waitFor('idle ·', start)
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
      const header = sessionEvents(id, launchFlagsHome)
        .find(event => event.type === 'request/header')?.data?.header as {
          tools?: Array<{ name: string }>
        } | undefined
      const roster = header?.tools?.map(tool => tool.name) ?? []
      expect(roster).toContain(expected.present)
      expect(roster).not.toContain(expected.absent)
    }

    const invalid = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = invalid.output.length
      invalid.write(`${launcher} --tools w045_missing; printf '__W045_EXIT__%s\\n' "$?"\n`)
      await invalid.waitFor('tools.restrict() names unknown global tool "w045_missing"; known global tools:', start)
      await invalid.waitFor('__W045_EXIT__2', start)
    } finally {
      await invalid.close()
    }
  }, 45_000)

  it('replaces or appends the model system prompt through text and file launch flags', async () => {
    const replaceFile = join(testDir, 'w047-replace.txt')
    const appendFile = join(testDir, 'w047-append.txt')
    writeFileSync(replaceFile, 'W047 replacement from file')
    writeFileSync(appendFile, 'W047 appended from file')
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`
    for (const expected of [
      { args: `--system-prompt ${quote('W047 replacement text')}`, text: 'W047 replacement text', replace: true },
      { args: `--system-prompt-file ${quote(replaceFile)}`, text: 'W047 replacement from file', replace: true },
      { args: `--append-system-prompt ${quote('W047 appended text')}`, text: 'W047 appended text', replace: false },
      { args: `--append-system-prompt-file ${quote(appendFile)}`, text: 'W047 appended from file', replace: false },
    ]) {
      const shell = new PtyShell(threeTurnFixture, undefined, root, {
        DSH_HOME: launchFlagsHome,
        PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      })
      let id = ''
      try {
        const start = await launch(shell, `${launcher} ${expected.args} 'system prompt fixture'`)
        id = sessionId(shell.output, start)
        await shell.waitFor('First turn complete.', start)
        await shell.waitFor('idle ·', start)
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
      const system = (sessionEvents(id, launchFlagsHome)
        .find(event => event.type === 'request/header')?.data?.header as { system?: string } | undefined)?.system
      if (expected.replace) expect(system).toBe(expected.text)
      else {
        expect(system).not.toBe(expected.text)
        expect(system?.endsWith(expected.text)).toBe(true)
      }
    }

    const invalid = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = invalid.output.length
      invalid.write(`${launcher} --system-prompt-file ${quote(join(testDir, 'w047-missing'))}; printf '__W047_EXIT__%s\\n' "$?"\n`)
      await invalid.waitFor('ENOENT', start)
      await invalid.waitFor('__W047_EXIT__2', start)
    } finally {
      await invalid.close()
    }
  }, 60_000)

  it('applies read-only at launch and refuses a human-shell write', async () => {
    const cwd = join(testDir, 'launch-read-only')
    const target = join(cwd, 'blocked.txt')
    mkdirSync(cwd)
    const shell = new PtyShell(replayFixture, undefined, cwd, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --permission read-only ${quote(`!printf blocked > ${target}`)}`)
      id = sessionId(shell.output, start)
      await shell.waitFor('sandbox denied file access', start)
      await shell.waitFor('idle ·', start)
      expect(existsSync(target)).toBe(false)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id, launchFlagsHome).some(event => event.type === 'permission/preset'
      && event.data?.preset === 'read-only')).toBe(true)
  }, 30_000)

  it('binds an unlisted launch model because DSH catalogs are advisory', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --model w025-unlisted`)
      expect(shell.output.slice(start)).toContain('w025-unlisted')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('infers a unique launch-model provider and accepts an explicit provider', async () => {
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(modelCatalogPatch)} --fullscreen`
    for (const selection of [
      { args: '--model w025-unique', expected: 'Model: w025-alpha/w025-unique' },
      { args: '--provider w025-beta --model w025-shared', expected: 'Model: w025-beta/w025-shared' },
    ]) {
      const shell = new PtyShell(replayFixture, undefined, root, {
        DSH_HOME: launchFlagsHome,
        PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      })
      try {
        const start = await launch(shell, `${launcher} ${selection.args}`)
        shell.write('/status\r')
        await shell.waitFor(selection.expected, start)
        const closedAt = shell.output.length
        shell.write('\u001B')
        await shell.waitFor('idle ·', closedAt)
        await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
    }
  }, 30_000)

  it('lists both provider candidates when a launch model is ambiguous', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const command = `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(modelCatalogPatch)} --model w025-shared`
      const start = shell.output.length
      shell.write(`${command}; printf '__W025_AMBIGUOUS_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('model "w025-shared" is available from multiple providers: w025-alpha, w025-beta; pass --provider', start)
      await shell.waitFor('__W025_AMBIGUOUS_EXIT__1', start)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('returns DSH startup errors for invalid launch permission, provider, and effort values', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)}`
    try {
      let start = shell.output.length
      shell.write(`${launcher} --permission w025-missing; printf '__W025_PERMISSION_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('unknown preset "w025-missing"', start)
      await shell.waitFor('__W025_PERMISSION_EXIT__1', start)
      start = shell.output.length
      shell.write(`${launcher} --provider w025-missing --model unlisted; printf '__W025_PROVIDER_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('no adapter registered for provider "w025-missing"', start)
      await shell.waitFor('__W025_PROVIDER_EXIT__1', start)
      expect(shell.output.slice(start)).toContain('startup failed')
      start = shell.output.length
      shell.write(`${launcher} --provider deepseek-official --model deepseek-v4-flash --effort w025-missing; printf '__W025_EFFORT_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('provider "deepseek-official" model "deepseek-v4-flash" does not support reasoning effort "w025-missing"', start)
      await shell.waitFor('__W025_EFFORT_EXIT__1', start)
      expect(shell.output.slice(start)).toContain('startup failed')
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('/usage shows nonzero DSH token and session-stat projections after a replayed turn', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --yolo 'usage fixture'`)
      const answeredAt = await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', answeredAt)
      const usageAt = shell.output.length
      shell.write('/usage\r')
      for (const line of [
        'Input tokens: 18', 'Output tokens: 8', 'Cache read: 2', 'Cache write: 0',
        'Turns: 1 · Steps: 2', 'Model time:', 'Tool time:', 'Measured wall time:',
      ]) await shell.waitFor(line, usageAt)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('requires explicit confirmation before switching to a never-approval preset', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('\u001B[Z')
      await shell.waitFor('Enable danger-full-access?', start)
      shell.write('\r')
      shell.write('/status\r')
      await shell.waitFor('Permission: workspace-write', start)
      const firstClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', firstClosedAt)

      shell.write('\u001B[Z')
      await shell.waitFor('Enable danger-full-access?', shell.output.length - 200)
      shell.write('\u001B[A\r')
      shell.write('/status\r')
      await shell.waitFor('Permission: danger-full-access', start)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const switches = sessionEvents(id).filter(event => event.type === 'permission/preset'
      && event.data?.preset === 'danger-full-access')
    expect(switches).toHaveLength(1)
  }, 30_000)

  it('opens the native permission picker and queues an explicit turn before /exit', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/permission\r')
      await shell.waitFor('Permission preset', start)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)

      shell.write('/queue queued from command\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', shell.output.length - 200)
      const releasedAt = shell.output.length
      shell.write('/exit\r')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await shell.waitFor('Resume with:', releasedAt)
    } finally {
      await shell.close()
    }
    const events = sessionEvents(id)
    expect(events.some(event => event.type === 'command/run' && event.data?.name === 'queue')).toBe(true)
    expect(events.some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('queued from command'))).toBe(true)
  }, 60_000)

  it('lists steered prompts, offers bundled roller, and recovers a draft', async () => {
    const shell = new PtyShell(rewindSteerFixture)
    let parent = ''
    let child = ''
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen 'first rewind prompt'`)
      parent = sessionId(shell.output, start)
      const firstAt = await shell.waitFor('First rewind turn complete.', start)
      await shell.waitFor('idle ·', firstAt)
      const secondAt = shell.output.length
      shell.write('second rewind prompt\r')
      await shell.waitFor('Inspecting the second rewind turn.', secondAt)
      shell.write('steered rewind prompt\r')
      await shell.waitFor('Approval · bash', secondAt)
      shell.write('\r')
      const completedAt = await shell.waitFor('Second rewind turn complete.', secondAt)
      await shell.waitFor('idle ·', completedAt)

      const rewindAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('steered rewind prompt · mid-turn', rewindAt)
      const firstScreen = await firstFrame(shell.output.slice(start))
      expect(firstScreen).toContain('Rewind to a prompt')
      expect(firstScreen).toContain('first rewind prompt')
      expect(firstScreen).toContain('second rewind prompt')
      expect(firstScreen).toContain('steered rewind prompt · mid-turn')
      shell.write('\r')
      await shell.waitFor('Never mind', rewindAt)
      const secondScreen = await firstFrame(shell.output.slice(start))
      expect(secondScreen).toContain('steered rewind prompt')
      expect(secondScreen).toContain('Restore conversation')
      expect(secondScreen).toContain('Restore code')
      if (process.env.DASHI_CAPTURE_REWIND === '1') {
        process.stdout.write(`rewind screen 1 (80x24):\n${firstScreen}\nrewind screen 2 (80x24):\n${secondScreen}\n`)
      }

      const neverAt = shell.output.length
      shell.write(`${'\u001B[B'.repeat(3)}\r`)
      await shell.waitFor('Rewind to a prompt', neverAt)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)

      const draftAt = shell.output.length
      shell.write('recover this draft')
      await shell.waitFor('recover this draft', draftAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const clearAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('\u001B[22;1H\u001B[2K', clearAt)
      const recallAt = shell.output.length
      shell.write('\u001B[A')
      await shell.waitFor('recover this draft', recallAt)
      const recalledClearAt = shell.output.length
      shell.write('\u0003')
      await shell.waitFor('\u001B[22;1H\u001B[2K', recalledClearAt)

      const restoreAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('steered rewind prompt · mid-turn', restoreAt)
      shell.write('\r')
      await shell.waitFor('Restore conversation', restoreAt)
      const actionAt = shell.output.length
      shell.write('\u001B[B\r')
      child = await waitForOtherSession(shell, parent, rewindAt)
      await shell.waitFor('steered rewind prompt', actionAt)

      const clearComposerAt = shell.output.length
      shell.write('\u0003')
      await shell.waitFor('\u001B[22;1H\u001B[2K', clearComposerAt)
      const statusAt = shell.output.length
      shell.write('/status\r')
      await shell.waitFor(`Lineage: forked from ${parent} at turn 1`, statusAt)
      shell.write('\u001B')
      await shell.waitFor('idle ·', statusAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const childLog = sessionLog(child)
    expect(childLog.header.parentSession).toBe(parent)
    const seedEnd = childLog.events.findIndex(event => event.type === 'session/end-seed')
    expect(seedEnd).toBeGreaterThan(0)
    expect(childLog.events.slice(seedEnd + 1).some(event => event.type === 'user/message')).toBe(false)
    await expectResumable(parent, rewindSteerFixture)
  }, 90_000)

  it('restores conversation and code at both session start and a turn boundary', async () => {
    const scenarios = [
      { action: 0, first: true, mode: 'both', file: undefined, child: true },
      { action: 2, first: true, mode: 'code', file: undefined, child: false },
      { action: 1, first: true, mode: 'conversation', file: 'turn one\n', child: true },
      { action: 1, first: false, mode: 'conversation', file: 'turn three\n', child: true },
      { action: 0, first: false, mode: 'both', file: 'turn one\n', child: true },
      { action: 2, first: false, mode: 'code', file: 'turn one\n', child: false },
    ] as const
    for (const scenario of scenarios) {
      const workspace = join(testDir, `roller-rewind-${scenario.mode}-${scenario.first ? 'start' : 'turn'}`)
      mkdirSync(workspace)
      const shell = new PtyShell(rollerFixture, undefined, workspace)
      let parent = ''
      let result = ''
      try {
        const start = await launch(shell,
          `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`)
        parent = sessionId(shell.output, start)
        const turns = scenario.first ? 1 : 3
        for (let index = 0; index < turns; index++) {
          const turnAt = shell.output.length
          shell.write(`${['first', 'second', 'third'][index]} roller prompt\r`)
          await shell.waitFor(`Roller turn ${['one', 'two', 'three'][index]} complete.`, turnAt)
          await shell.waitFor('idle ·', turnAt)
        }
        expect(readFileSync(join(workspace, 'roller-e2e.txt'), 'utf8')).toBe(
          scenario.first ? 'turn one\n' : 'turn three\n')

        const rewindAt = shell.output.length
        shell.write('/rewind\r')
        await shell.waitFor('Rewind to a prompt', rewindAt)
        if (!scenario.first) shell.write('\u001B[A')
        shell.write('\r')
        await shell.waitFor('Restore code and conversation', rewindAt)
        const actionAt = shell.output.length
        shell.write(`${'\u001B[B'.repeat(scenario.action)}\r`)
        if (scenario.child) result = await waitForOtherSession(shell, parent, actionAt)
        else {
          result = parent
        }
        if (scenario.mode !== 'conversation') {
          await waitForFile(join(workspace, 'roller-e2e.txt'), scenario.file)
        }
        if (scenario.mode !== 'code') {
          await shell.waitFor(`${scenario.first ? 'first' : 'second'} roller prompt`, actionAt)
          const clearAt = shell.output.length
          shell.write('\u0003')
          await shell.waitFor('\u001B[22;1H\u001B[2K', clearAt)
        }
        if (scenario.file === undefined) expect(existsSync(join(workspace, 'roller-e2e.txt'))).toBe(false)
        else expect(readFileSync(join(workspace, 'roller-e2e.txt'), 'utf8')).toBe(scenario.file)

        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
      const events = sessionEvents(result)
      if (scenario.child && scenario.first) {
        expect(events.some(event => event.type === 'model/selection')).toBe(true)
      }
      expect(events.some(event => event.type === 'command/run'
        && event.data?.name === 'roller-restore')).toBe(scenario.mode !== 'conversation'
          && (!scenario.child || !scenario.first))
      if (scenario.mode === 'both' && scenario.first) {
        expect(sessionEvents(parent).some(event => event.type === 'command/run'
          && event.data?.name === 'roller-restore')).toBe(true)
      }
      if (scenario.child) expect(sessionLog(result).header.parentSession).toBe(
        scenario.first ? undefined : parent)
    }
  }, 180_000)

  it('/fork switches to a child at the latest completed turn', async () => {
    const shell = new PtyShell(threeTurnFixture)
    let parent = ''
    let child = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      parent = sessionId(shell.output, start)
      const turnAt = shell.output.length
      shell.write('fork source prompt\r')
      await shell.waitFor('First turn complete.', turnAt)
      await shell.waitFor('idle ·', turnAt)

      const forkAt = shell.output.length
      shell.write('/fork\r')
      child = await waitForOtherSession(shell, parent, forkAt)
      shell.write('/status\r')
      await shell.waitFor(`forked from ${parent} at turn 1`, forkAt)
      const closeAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closeAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const parentLog = sessionLog(parent)
    const childLog = sessionLog(child)
    expect(childLog.header.parentSession).toBe(parent)
    expect(parentLog.events.filter(event => event.type === 'turn/end')).toHaveLength(1)
    const seedEnd = childLog.events.findIndex(event => event.type === 'session/end-seed')
    expect(seedEnd).toBeGreaterThan(0)
    expect(childLog.events.slice(0, seedEnd)).toEqual(parentLog.events.slice(0, seedEnd))
  }, 60_000)

  it('offers to interrupt before /new leaves a running root', async () => {
    const shell = new PtyShell(threeTurnFixture)
    let first = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      first = sessionId(shell.output, start)
      const turnAt = shell.output.length
      shell.write('first prompt\r')
      await shell.waitFor('First turn complete.', turnAt)
      await shell.waitFor('idle ·', turnAt)

      const runningAt = shell.output.length
      shell.write('second prompt\r')
      await shell.waitFor('running ·', runningAt)
      shell.write('/new\r')
      await shell.waitFor('Interrupt current turn?', runningAt)
      expect([...shell.output.slice(runningAt).matchAll(/session-[0-9a-f-]{36}/g)]
        .every(match => match[0] === first)).toBe(true)
      shell.write('\u001B[A\r')
      await waitForOtherSession(shell, first, runningAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('searches an earlier same-cwd human prompt and inserts the full event text', async () => {
    const shell = new PtyShell(threeTurnFixture)
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const first = sessionId(shell.output, start)
      const turnAt = shell.output.length
      shell.write('historical needle alpha\r')
      await shell.waitFor('First turn complete.', turnAt)
      await shell.waitFor('idle ·', turnAt)
      const newAt = shell.output.length
      shell.write('/new\r')
      await waitForOtherSession(shell, first, newAt)

      shell.write('needle')
      const searchAt = shell.output.length
      shell.write('\u0012')
      await shell.waitFor('Prompt search', searchAt)
      await shell.waitFor('historical needle alpha', searchAt)
      shell.write('\r')
      await shell.waitFor('historical needle alpha', searchAt)
      const releasedAt = shell.output.length
      shell.write('\u0003\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('completes cwd-bounded paths, attaches an @ image, and stashes the image draft', async () => {
    const workspace = join(testDir, 'composer-workspace')
    mkdirSync(join(workspace, 'screens'), { recursive: true })
    writeFileSync(join(workspace, 'only-here.ts'), 'export {}\n')
    writeFileSync(join(workspace, 'screens', 'shot.png'), png)
    writeFileSync(join(testDir, 'outside-secret.ts'), 'not in workspace\n')
    const shell = new PtyShell(replayFixture, undefined, workspace)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      const listAt = shell.output.length
      shell.write('@\t')
      await shell.waitFor('Complete', listAt)
      await shell.waitFor('only-here.ts', listAt)
      expect(shell.output.slice(listAt)).not.toContain('outside-secret.ts')
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      shell.write('\u0003')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })

      const attachAt = shell.output.length
      shell.write('@screens/shot\t')
      await shell.waitFor('screens/shot.png', attachAt)
      shell.write('\r')
      await shell.waitFor('[image 1]', attachAt)
      shell.write('\u0013')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      const restoreAt = shell.output.length
      shell.write('\u0013')
      await shell.waitFor('[image 1]', restoreAt)
      shell.write('image selected through at\r')
      await shell.waitFor('Approval · bash', restoreAt)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', restoreAt)
      await shell.waitFor('idle ·', restoreAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const message = sessionEvents(id).find(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('image selected through at'))
    expect(message?.data?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'image', attachment: expect.objectContaining({ mediaType: 'image/png', name: 'shot.png' }),
      }),
    ]))
  }, 60_000)

  it('accepts repeated --image paths including one outside cwd and persists durable references', async () => {
    const workspace = join(testDir, 'cli-image-workspace')
    mkdirSync(workspace)
    const image = join(testDir, 'home-shot.png')
    const second = join(workspace, 'second.png')
    writeFileSync(image, png)
    writeFileSync(second, png)
    const shell = new PtyShell(replayFixture, undefined, workspace)
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --image ${quote(image)} --image second.png 'image selected through flag'`)
      id = sessionId(shell.output, start)
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    const message = sessionEvents(id).find(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('image selected through flag'))
    expect(message?.data?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'image', attachment: expect.objectContaining({ mediaType: 'image/png', name: 'home-shot.png' }),
      }),
      expect.objectContaining({
        type: 'image', attachment: expect.objectContaining({ mediaType: 'image/png', name: 'second.png' }),
      }),
    ]))
  }, 60_000)

  it('pastes a clipboard image through PATH helpers and reports when none is installed', async () => {
    const withImage = new PtyShell(replayFixture, undefined, root, { PATH: clipboardHelper(true) })
    let id = ''
    try {
      const start = await launch(withImage, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(withImage.output, start)
      withImage.write('\u0016')
      await withImage.waitFor('clipboard.png · image/png', start)
      withImage.write('inspect clipboard\r')
      await withImage.waitFor('Approval · bash', start)
      withImage.write('\r')
      await withImage.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      const releasedAt = withImage.output.length
      withImage.write('\u0004\u0004')
      await withImage.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await withImage.close()
    }
    expect(sessionEvents(id).some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('inspect clipboard')
      && JSON.stringify(event.data).includes('clipboard.png'))).toBe(true)

    const withoutHelper = new PtyShell(replayFixture, undefined, root, { PATH: clipboardHelper(false) })
    try {
      const start = await launch(withoutHelper, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      withoutHelper.write('\u0016')
      await withoutHelper.waitFor('Clipboard image paste needs wl-paste or xclip.', start)
      const releasedAt = withoutHelper.output.length
      withoutHelper.write('\u0004\u0004')
      await withoutHelper.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await withoutHelper.close()
    }
  }, 60_000)

  it('round-trips Ctrl+G through a cooked terminal and removes the mode-0600 file', async () => {
    const trace = join(testDir, `editor-${String(Date.now())}.json`)
    const { baseline, shell } = await prepareShell({
      DSH_DASHI_EDITOR_TRACE: trace,
      EDITOR: `${process.execPath} ${fakeEditor}`,
      VISUAL: '',
    })
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('draft\u0007')
      await shell.waitFor('draft from editor', start)
      const result = JSON.parse(readFileSync(trace, 'utf8')) as {
        file: string; mode: number; terminalMode: string
      }
      expect(result.mode).toBe(0o600)
      expect(result.terminalMode).toBe(baseline)
      expect(existsSync(result.file)).toBe(false)
      const releasedAt = shell.output.length
      shell.write('\u0003\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('inserts a newline for a distinct Shift+Enter PTY sequence', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('first line\u001B[13;2usecond line\r')
      await shell.waitFor('Approval · bash', start)
      shell.write('\r')
      await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id).some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('first line\\nsecond line'))).toBe(true)
  }, 60_000)

  it('renders DSH plans, todos, subagents, jobs, compaction, and context facts', async () => {
    const shell = new PtyShell(presentationFixture, undefined, root, {
      DSH_SNAPSHOT_CHILD_FILES: presentationChildFixture,
    })
    let parent = ''
    let child = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      parent = sessionId(shell.output, start)

      const planAt = shell.output.length
      shell.write('/plan review the presentation path\r')
      await shell.waitFor('Use duplicate state.', planAt)
      shell.write('\u001B[B\r')
      await shell.waitFor('Use one service boundary.', planAt)
      shell.write('\r')
      const planDone = await shell.waitFor('The revised plan is approved.', planAt)
      await shell.waitFor('idle ·', planDone)

      const todosAt = shell.output.length
      shell.write('update todos\r')
      const todosDone = await shell.waitFor('Todo revisions complete.', todosAt)
      await shell.waitFor('Todos · previous revision', todosAt)
      await shell.waitFor('● ship', todosAt)
      await shell.waitFor('idle ·', todosDone)

      const subagentAt = shell.output.length
      shell.write('delegate research\r')
      await shell.waitFor('Subagent · research cause · running', subagentAt)
      const subagentDone = await shell.waitFor('Subagent completion acknowledged.', subagentAt, 30_000)
      await shell.waitFor('Subagent · research cause · inactive', subagentAt)
      await shell.waitFor('Find the bounded cause summary.', subagentAt)
      await shell.waitFor('idle ·', subagentDone)
      const detailsAt = shell.output.length
      shell.write('/tasks\r')
      await shell.waitFor('Activity', detailsAt)
      shell.write('\r')
      await shell.waitFor('mode: continuable', detailsAt)
      child = /Background subagent ([0-9a-f-]{36})/u.exec(shell.output.slice(subagentAt))?.[1] ?? ''
      expect(child).not.toBe('')
      const detailsClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', detailsClosedAt)

      const jobAt = shell.output.length
      shell.write('run a background job\r')
      await shell.waitFor('Job · sleep 0.5; printf DASHI_JOB_DONE · running', jobAt)
      const jobDone = await shell.waitFor('Job completion acknowledged.', jobAt, 30_000)
      await shell.waitFor('Job · sleep 0.5; printf DASHI_JOB_DONE · completed', jobAt)
      await shell.waitFor('idle ·', jobDone)

      const compactAt = shell.output.length
      shell.write('/compact\r')
      await shell.waitFor('running /compact', compactAt)
      expect(shell.output.slice(compactAt)).not.toContain('Compacted')
      await shell.waitFor('Compacted', compactAt, 30_000)
      await shell.waitFor('% context', compactAt)
      const contextValues = [...shell.output.slice(start).matchAll(/(\d+)% context/gu)]
        .map(match => Number(match[1]))
      expect(new Set(contextValues).size).toBeGreaterThan(1)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const parentLog = sessionLog(parent)
    const childLog = sessionLog(child)
    const text = (event: { data?: Record<string, unknown> }): string => JSON.stringify(event.data)
    expect(parentLog.events.filter(event => event.type === 'tool/call'
      && text(event).includes('exit_plan_mode'))).toHaveLength(2)
    expect(parentLog.events.some(event => event.type === 'plan/mode'
      && event.data?.active === false)).toBe(true)
    expect(parentLog.events.filter(event => event.type === 'todo/write')).toHaveLength(2)
    expect(parentLog.events.some(event => event.type === 'compaction/summary')).toBe(true)
    expect(parentLog.events.some(event => event.type === 'command/run'
      && event.data?.name === 'tasks')).toBe(true)
    const compactRun = parentLog.events.findIndex(event => event.type === 'command/run'
      && event.data?.name === 'compact')
    const compactId = parentLog.events[compactRun]?.data?.commandId
    const compactDone = parentLog.events.findIndex(event => event.type === 'command/done'
      && event.data?.commandId === compactId)
    expect(compactRun).toBeGreaterThan(-1)
    expect(compactDone).toBeGreaterThan(compactRun)
    expect(parentLog.events.some(event => (event.type === 'assistant/chunk' || event.type === 'assistant/message')
      && text(event).includes('CHILD_RESULT'))).toBe(false)
    expect(childLog.events.some(event => text(event).includes('CHILD_RESULT'))).toBe(true)
    expect(parentLog.events.some(event => event.type === 'user/message'
      && (event.data?.source as { plugin?: unknown } | undefined)?.plugin === 'tool-jobs')).toBe(true)
  }, 120_000)

  it('reads and kills jobs and starts a continuable subtask through DSH', async () => {
    const shell = new PtyShell(tasksFixture, undefined, root, {
      DSH_SNAPSHOT_CHILD_FILES: presentationChildFixture,
    })
    let parent = ''
    let child = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      parent = sessionId(shell.output, start)
      shell.write('launch managed job\r')
      const launched = await shell.waitFor('Managed job launched.', start)
      await shell.waitFor('Job · printf DASHI_JOB_OUTPUT; sleep 30 · running', start)
      await shell.waitFor('idle ·', launched)

      const readAt = shell.output.length
      shell.write('/bashes\r')
      await shell.waitFor('Activity', readAt)
      shell.write('\r')
      await shell.waitFor('DASHI_JOB_OUTPUT', readAt)
      shell.write('\u001B')
      await shell.waitFor('idle ·', shell.output.length - 1)

      const killAt = shell.output.length
      shell.write('/tasks kill bash-1\r')
      await shell.waitFor('stopping bash-1', killAt)
      await shell.waitFor('Job · printf DASHI_JOB_OUTPUT; sleep 30 · killed', killAt)

      const subtaskAt = shell.output.length
      shell.write('/subtask inspect W046 continuation\r')
      await shell.waitFor('subtask ', subtaskAt)
      await shell.waitFor(' started', subtaskAt)
      child = /subtask ([0-9a-f-]{36}) started/u.exec(shell.output.slice(subtaskAt))?.[1] ?? ''
      expect(child).not.toBe('')
      await shell.waitFor('Subagent · inspect W046 continuation ·', subtaskAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const commands = sessionEvents(parent).filter(event => event.type === 'command/run')
      .map(event => event.data?.name)
    expect(commands).toEqual(expect.arrayContaining(['bashes', 'tasks', 'subtask']))
    expect(sessionEvents(child).some(event => event.type === 'user/message'
      && JSON.stringify(event.data).includes('inspect W046 continuation'))).toBe(true)
  }, 120_000)

  it('creates, lists, rejects, and stops loops through DSH Schedule', async () => {
    const shell = new PtyShell()
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)

      const createAt = shell.output.length
      shell.write('/loop 5m check the release\r')
      await shell.waitFor('scheduled schedule-1 · every 5m · check the release', createAt)

      const listAt = shell.output.length
      shell.write('/loop\r')
      await shell.waitFor('schedule-1 · every 5m · check the release', listAt)

      const rejectedAt = shell.output.length
      shell.write('/loop 1m too frequent\r')
      await shell.waitFor('every_seconds must be at least 300.', rejectedAt)

      const stopAt = shell.output.length
      shell.write('/loop stop schedule-1\r')
      await shell.waitFor('stopped schedule-1', stopAt)

      const emptyAt = shell.output.length
      shell.write('/loop\r')
      await shell.waitFor('no active schedules', emptyAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const events = sessionEvents(id)
    expect(events.filter(event => event.type === 'command/run'
      && event.data?.name === 'loop')).toHaveLength(5)
    expect(events.filter(event => event.type === 'schedule/change')
      .map(event => event.data?.operation)).toEqual(['create', 'delete'])
  }, 60_000)

  it('resumes a generated 200k-event session and pages older history on demand', async () => {
    const created = new PtyShell()
    let id = ''
    try {
      const start = await launch(created, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(created.output, start)
      const releasedAt = created.output.length
      created.write('\u0004\u0004')
      await created.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await created.close()
    }
    const shape = generateLargeSession(id)
    expect(shape).toEqual({ events: 200_000, toolCells: 2_000 })

    const stormChunks = 400
    const resumed = new PtyShell(chunkStormSnapshot(stormChunks), undefined, root, { DSH_REPLAY_PACE_MS: '10' })
    try {
      const startedAt = performance.now()
      const start = resumed.output.length
      resumed.write(`${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}\n`)
      await resumed.waitFor('idle ·', start, 20_000)
      const resumeElapsed = performance.now() - startedAt
      reportPerformance('large-resume-first-view', resumeElapsed, 'ms')
      expect(resumeElapsed).toBeLessThan(testCeiling(3_000))
      expect(resumed.output.slice(start)).toContain('large answer 49500')

      const pageAt = resumed.output.length
      resumed.write('\u001B[1;5H')
      await resumed.waitFor('large prompt 49451', pageAt, 20_000)

      resumed.write('\u001B[1;5F')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      const copyAt = resumed.output.length
      resumed.write('/copy\r')
      const oscAt = await resumed.waitFor('\u001B]52;c;', copyAt)
      const payloadStart = oscAt + '\u001B]52;c;'.length
      const payloadEnd = resumed.output.indexOf('\u0007', payloadStart)
      expect(Buffer.from(resumed.output.slice(payloadStart, payloadEnd), 'base64').toString())
        .toBe('large answer 49500')

      const historyAt = resumed.output.length
      resumed.write('/history\r')
      await resumed.waitFor('History', historyAt)
      const closedAt = resumed.output.length
      resumed.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      resumed.write('\u001B[1;5H')
      await resumed.waitFor('large prompt 49426', closedAt, 20_000)

      const streamingAt = resumed.output.length
      const streamingStartedAt = performance.now()
      resumed.write('measure chunk storm\r')
      const runningAt = await resumed.waitFor('running ·', streamingAt)
      await resumed.waitFor('idle ·', runningAt + 1, 20_000)
      const streamingElapsed = performance.now() - streamingStartedAt
      const streamingOutput = resumed.output.slice(streamingAt)
      const frames = streamingOutput.split('\u001B[?2026h').length - 1
      const framesPerSecond = Math.max(0, frames - 1) / (streamingElapsed / 1_000)
      reportPerformance('streaming-frame-rate', framesPerSecond, 'frames/s')
      expect(framesPerSecond).toBeLessThanOrEqual(testCeiling(30))
      expect(frames).toBeLessThan(stormChunks / 2)
      expect(streamingOutput).toContain('new output')
      expect(streamingOutput).not.toContain('STORM_END')

      const releasedAt = resumed.output.length
      resumed.write('\u0004\u0004')
      await resumed.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await resumed.close()
    }
  }, 120_000)
})
