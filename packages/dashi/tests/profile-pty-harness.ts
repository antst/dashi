import { execFileSync } from 'node:child_process'
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prepareSessionSnapshotFixtureForComparison } from '@deepseek-ai/dsh-llm-replay'
import { sessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { afterAll, beforeAll, expect, vi } from 'vitest'
import { type TestObserver } from './sessionbus-harness.js'
import { testCeiling } from './test-budget.js'
import { TestPtyShell } from './pty-shell.js'
import { currentRecordedJsonl, recordedSession } from './fixtures/session-format.js'
import { deriveCliPins } from '../../../scripts/dsh-cli-pins.mjs'

export const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
export const dsh = join(root, 'node_modules', '.bin', 'dsh')
export const dashiLauncher = join(root, 'packages', 'dashi-launcher', 'bin', 'dashi.js')
export const failureFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'effect-failure.mjs')
export const replayFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'replay-session.jsonl')
export const inlineScrollFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'inline-scroll-session.jsonl')
export const threeTurnFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'three-turn-session.jsonl')
export const rewindSteerFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'rewind-steer-session.jsonl')
export const headerlessTurnFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'headerless-one-turn-session.jsonl')
export const rollerFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'roller-three-turn-session.jsonl')
export const questionFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'question-session.jsonl')
export const presentationFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'presentation-session.jsonl')
export const tasksFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'tasks-session.jsonl')
export const contextInjectionFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'context-injection-session.jsonl')
export const presentationChildFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'presentation-child-session.jsonl')
export const requestContextFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'request-context-session.jsonl')
export const longTurnFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'long-turn-session.jsonl')
export const btwChildFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'btw-child-session.jsonl')
export const recapChildFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'recap-child-session.jsonl')
export const openTurnFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'open-turn-session.jsonl')
export const noUploadsFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'file-uploads-none-session.jsonl')
export const questionPlugin = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'question-plugin')
export const pluginManagementFixture = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'plugin-management')
export const replayPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'replay.patch.yml')
export const modelCatalogPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'model-catalog.patch.yml')
export const cleanReplayPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'clean-replay.patch.yml')
export const sessionListPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'session-list.patch.yml')
export const fakeEditor = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'fake-editor.mjs')
export const mcpStderrPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'mcp-stderr.patch.yml')
export const customPresetPatch = join(root, 'packages', 'dashi', 'tests', 'fixtures', 'custom-preset.patch.yml')
export const { tested: testedDshVersions } = JSON.parse(readFileSync(
  join(root, 'packages', 'dashi', 'validated-dsh-versions.json'), 'utf8',
)) as { tested: string[] }
export const testedDshVersion = process.env.DSH_TEST_VERSION ?? testedDshVersions[0] ?? ''
if (!testedDshVersions.includes(testedDshVersion)) throw new Error(`DSH ${testedDshVersion} is not a tested gate version`)
export const cliManifest = JSON.parse(readFileSync(join(root, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')) as {
  version: string; dependencies: Record<string, string>
}
if (cliManifest.version !== testedDshVersion) throw new Error(`installed DSH CLI must be ${testedDshVersion}`)
export const cliPins = deriveCliPins(cliManifest.dependencies)
export const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
// pi-tui 0.84.4 dist/stdin-buffer.js:22 holds a lone Escape for 10 ms.
// Leave ample PTY scheduling margin so two Escape keys cannot become one Alt sequence.
export const separateEscapeKeysMs = 200
export const hermeticGitEnv = {
  GIT_CONFIG_COUNT: '0',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
} as const
export const terminalFlags = ['icanon', 'echo', 'isig', 'opost'] as const
export let testDir = ''
export let home = ''
export let hardeningCwd = ''
export let hardeningHome = ''
export let launchFlagsHome = ''
export let overlayHome = ''
export let pluginHome = ''
export let pluginSandboxHome = ''
export let mcpHome = ''
export let rewindDefaultHome = ''
export let presetHome = ''

export function currentSnapshot(snapshot: string): string {
  const header = JSON.parse(readFileSync(snapshot, 'utf8').split('\n')[0] ?? '{}')
  // Native replay-generated current fixtures may retain its documented template tokens.
  if (sessionFormatCatalog.readHeader(header).status === 'current') return snapshot
  const path = join(testDir, `v4-${snapshot.split('/').at(-1) ?? 'snapshot.jsonl'}`)
  writeFileSync(path, currentRecordedJsonl(snapshot))
  return path
}

export function reportPerformance(name: string, value: number, unit: string): void {
  process.stdout.write(`performance: ${name} ${value.toFixed(2)} ${unit}\n`)
}

export function run(command: string, args: string[], env = process.env, cwd = root): string {
  try {
    return execFileSync(command, args, { cwd, env, encoding: 'utf8', timeout: 120_000 })
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string }
    throw new Error(`${command} ${args.join(' ')} failed\n${failed.stdout ?? ''}${failed.stderr ?? ''}`)
  }
}

export function quote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function packWorkspacePackage(directory: string, destination: string): string {
  const before = new Set(readdirSync(destination))
  run('pnpm', ['pack', '--pack-destination', destination], process.env, directory)
  const archive = readdirSync(destination).find(file => file.endsWith('.tgz') && !before.has(file))
  if (archive === undefined) throw new Error(`Packing ${directory} did not produce an archive`)
  return join(destination, archive)
}

export function writeDshPinHook(directory: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, '.pnpmfile.cjs'), `
const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const cliPins = ${JSON.stringify(cliPins)}
module.exports = { hooks: { readPackage(pkg) {
  for (const field of fields) for (const name of Object.keys(pkg[field] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) pkg[field][name] = ${JSON.stringify(testedDshVersion)}
    else if (cliPins[name]) pkg[field][name] = cliPins[name]
  }
  return pkg
} } }
`)
}

export class PtyShell extends TestPtyShell {
  constructor(snapshot = replayFixture, rootEvents?: string, cwd = root, extraEnv: NodeJS.ProcessEnv = {}) {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...hermeticGitEnv,
      DSH_HOME: home,
      DSH_SNAPSHOT_FILE: currentSnapshot(snapshot),
      DSH_TELEMETRY_DISABLED: '1',
      ...(rootEvents === undefined ? {} : { DSH_DASHI_ROOT_EVENTS: rootEvents }),
      NO_COLOR: '1',
      PROMPT_COMMAND: '',
      PS1: '',
      TERM: 'xterm-256color',
    }
    for (const [name, value] of Object.entries(extraEnv)) {
      if (value === undefined) delete env[name]
      else env[name] = value
    }
    super(cwd, env)
  }
}

export async function waitForIdleAfter(shell: PtyShell, text: string, start: number): Promise<void> {
  const completedAt = await shell.waitFor(text, start)
  await shell.waitFor('idle ·', completedAt)
}

export function modeBetween(output: string, marker: string): string {
  const match = new RegExp(`${marker}\\r?\\n([^\\r\\n]+)`).exec(output)
  if (match?.[1] === undefined) throw new Error(`Missing terminal mode after ${marker}\n${output.slice(-2000)}`)
  return match[1]
}

export function relevantTerminalMode(mode: string): string {
  const fields = new Set(mode.replaceAll(';', ' ').split(/\s+/u))
  return terminalFlags.map(flag => {
    if (fields.has(`-${flag}`)) return `-${flag}`
    if (fields.has(flag)) return flag
    throw new Error(`stty output omitted ${flag}: ${mode}`)
  }).join(' ')
}

export async function waitForTerminalMode(shell: PtyShell, marker: string, start: number): Promise<string> {
  let mode = ''
  await vi.waitFor(() => {
    mode = modeBetween(shell.output.slice(start), marker)
    relevantTerminalMode(mode)
  }, { timeout: testCeiling(20_000), interval: 20 })
  return mode
}

export interface ParsedFrame {
  readonly attachments: string
  readonly composer: string
  readonly overlay: string
  readonly status: string
  readonly text: string
  readonly transcript: string
}

export function parseFrame(terminal: HeadlessTerminal): ParsedFrame {
  const viewport = terminal.buffer.active.viewportY
  const lines = Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(viewport + row)?.translateToString(true) ?? '')
  const header = Math.max(0, lines.findIndex(line => line.includes('dashi')))
  const rules = lines.flatMap((line, index) => /^[─━═]+$/u.test(line.trim()) ? [index] : [])
  const composerBottom = rules.at(-1) ?? -1
  const composerTop = rules.at(-2) ?? -1
  const bodyEnd = composerTop > header ? composerTop : lines.length - 1
  const body = lines.slice(header, bodyEnd)
  return {
    attachments: body.filter(line => /\[image \d+\]/u.test(line)).join('\n'),
    composer: composerTop >= 0 && composerBottom > composerTop
      ? lines.slice(composerTop + 1, composerBottom).join('\n')
      : lines.at(-3) ?? '',
    overlay: lines.slice(header, -1).join('\n'),
    status: composerBottom >= 0 ? lines[composerBottom + 1] ?? '' : lines.at(-1) ?? '',
    text: lines.slice(header).join('\n'),
    transcript: body.filter(line => !/\[image \d+\]/u.test(line)).join('\n'),
  }
}

export async function parsedFrame(output: string, columns = 80, rows = 24): Promise<ParsedFrame> {
  const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: columns, rows })
  await new Promise<void>(resolveWrite => { terminal.write(output, resolveWrite) })
  return parseFrame(terminal)
}

export async function firstFrame(output: string, columns = 80, rows = 24): Promise<string> {
  return (await parsedFrame(output, columns, rows)).text
}

export async function resizedFrame(
  output: string,
  changes: readonly { readonly at: number; readonly columns: number; readonly rows: number }[],
): Promise<ParsedFrame> {
  const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: 80, rows: 24 })
  let offset = 0
  for (const change of changes) {
    await new Promise<void>(resolveWrite => { terminal.write(output.slice(offset, change.at), resolveWrite) })
    terminal.resize(change.columns, change.rows)
    offset = change.at
  }
  await new Promise<void>(resolveWrite => { terminal.write(output.slice(offset), resolveWrite) })
  return parseFrame(terminal)
}

export async function prepareShell(extraEnv: NodeJS.ProcessEnv = {}, cwd = root): Promise<{ baseline: string; shell: PtyShell }> {
  const shell = new PtyShell(replayFixture, undefined, cwd, extraEnv)
  const start = shell.output.length
  shell.write("printf '__MODE_BEFORE__\\n'; stty -a | tr '\\n' ' '; printf '\\n'\n")
  return { baseline: await waitForTerminalMode(shell, '__MODE_BEFORE__', start), shell }
}

export async function launch(
  shell: PtyShell,
  command = `${quote(dsh)} --profile dashi --fullscreen`,
  ready = 'session-',
): Promise<number> {
  const start = shell.output.length
  shell.write(`${command}\n`)
  await shell.waitFor(ready, start)
  return start
}

export function sessionId(output: string, start: number): string {
  const id = /session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(output.slice(start))?.[0]
  if (id === undefined) throw new Error(`Missing session UUID\n${output.slice(start, start + 4000)}`)
  return id
}

export async function waitForOtherSession(shell: PtyShell, current: string, start: number): Promise<string> {
  const deadline = Date.now() + testCeiling(20_000)
  while (Date.now() < deadline) {
    const ids = [...shell.output.slice(start).matchAll(/session-[0-9a-f-]{36}/g)].map(match => match[0])
    const found = ids.find(id => id !== current)
    if (found !== undefined) return found
    await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
  }
  throw new Error(`Timed out waiting for a root other than ${current}\n${shell.output.slice(start)}`)
}

export async function waitForFile(path: string, expected: string | undefined): Promise<void> {
  const deadline = Date.now() + testCeiling(20_000)
  while (Date.now() < deadline) {
    if (expected === undefined ? !existsSync(path) : existsSync(path) && readFileSync(path, 'utf8') === expected) return
    await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
  }
  throw new Error(`Timed out waiting for ${path} to ${expected === undefined ? 'be absent' : `contain ${JSON.stringify(expected)}`}`)
}

export async function createNamedSession(cwd: string, title: string): Promise<string> {
  const shell = new PtyShell(threeTurnFixture, undefined, cwd)
  try {
    const start = await launch(shell,
      `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --name ${quote(title)} 'catalog fixture'`)
    const id = sessionId(shell.output, start)
    await waitForIdleAfter(shell, 'First turn complete.', start)
    const releasedAt = shell.output.length
    shell.write('\u0004\u0004')
    await shell.waitFor('\u001B[?1049l', releasedAt)
    return id
  } finally {
    await shell.close()
  }
}

export async function expectResumable(
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

export function findSessionFile(directory: string, id: string): string {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      const found = findSessionFile(path, id)
      if (found !== '') return found
    } else if (/^session(?:\.v\d+)?\.jsonl$/.test(entry) && path.includes(id)) {
      return path
    }
  }
  return ''
}

export function sessionEvents(id: string, sessionHome = home): Array<{ type: string; data?: Record<string, unknown> }> {
  const file = findSessionFile(join(sessionHome, 'replay-sessions'), id)
  if (file === '') throw new Error(`Missing persisted session ${id}`)
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1)
    .map(line => JSON.parse(line) as { type: string; data?: Record<string, unknown> })
}

export function sessionLog(id: string, sessionHome = home): {
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

export function listedSessions(cwd: string): Array<{ sessionId: string; title: string | null }> {
  const output = run(dsh, ['--profile', 'dashi', '--patch', sessionListPatch, 'sessions', 'list', '--all', '--json'], {
    ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
  }, cwd)
  return (JSON.parse(output) as { sessions: Array<{ sessionId: string; title: string | null }> }).sessions
}

export function clipboardHelper(image: boolean): string {
  const directory = join(testDir, `clipboard-${image ? 'image' : 'empty'}-${String(Date.now())}`)
  mkdirSync(directory)
  symlinkSync(process.execPath, join(directory, 'node'))
  for (const command of ['sed', 'dirname', 'uname']) symlinkSync(`/usr/bin/${command}`, join(directory, command))
  if (image) {
    const helper = join(directory, process.platform === 'darwin' ? 'pngpaste' : 'wl-paste')
    writeFileSync(helper, `#!${process.execPath}\nprocess.stdout.write(Buffer.from('${png.toString('base64')}', 'base64'))\n`)
    chmodSync(helper, 0o755)
  }
  return directory
}

export function currentReplayFixture(rows: Record<string, unknown>[]): string {
  const [header, ...chunks] = rows as Array<Record<string, unknown> & {
    data?: { turn?: number; step?: number }
  }>
  const events: Record<string, unknown>[] = []
  let turn: number | undefined
  let step: number | undefined
  for (let index = 0; index < chunks.length;) {
    const current = chunks[index]
    if (current?.data?.turn !== turn) {
      if (turn !== undefined) events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
      turn = current?.data?.turn
      step = undefined
      events.push({ type: 'turn/start', data: { turn } })
    }
    step = current?.data?.step
    events.push({ type: 'step/start', data: { turn, step } })
    while (chunks[index]?.data?.turn === turn && chunks[index]?.data?.step === step) events.push(chunks[index++] ?? {})
    events.push({ type: 'step/end', data: { turn, step } })
  }
  if (turn !== undefined) events.push({ type: 'turn/end', data: { turn, reason: { kind: 'completed' } } })
  return prepareSessionSnapshotFixtureForComparison(`${[header, ...events].map(row => JSON.stringify(row)).join('\n')}\n`)
}

export function replayText(turn: number, step: number, text: string): Record<string, unknown> {
  return { type: 'assistant/attempt', data: { turn, step, stream: [
    { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: 0, index: 0, dt: [], texts: [text] },
    { type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block: { type: 'text', text } } },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'stop' } } },
  ] } }
}

export function replayTool(turn: number, step: number, id: string, action: string,
  args: Record<string, unknown>): Record<string, unknown> {
  const parameters = JSON.stringify({ action, arguments: args })
  return { type: 'assistant/attempt', data: { turn, step, stream: [
    { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } },
    { type: 'tool-call-chunks', time0: 0, index: 0, dt: [], id, name: 'sessionbus', args: [parameters] },
    { type: 'chunk', time: 0, chunk: {
      type: 'block-end', index: 0, block: { type: 'tool-call', id, name: 'sessionbus', arguments: parameters },
    } },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  ] } }
}

export function replayStreamingList(turn: number, step: number): Record<string, unknown> {
  const texts = ['ACTIVE_STREAM_MARKER ', ...Array.from({ length: 16 }, () => '. ')]
  const complete = texts.join('')
  const parameters = JSON.stringify({ action: 'list', arguments: {} })
  return { type: 'assistant/attempt', data: { turn, step, stream: [
    { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 0, blockType: 'text' } },
    { type: 'text-chunks', time0: 0, index: 0, dt: Array.from({ length: texts.length - 1 }, () => 0), texts },
    { type: 'chunk', time: 0, chunk: { type: 'block-end', index: 0, block: { type: 'text', text: complete } } },
    { type: 'chunk', time: 0, chunk: { type: 'block-start', index: 1, blockType: 'tool-call' } },
    { type: 'tool-call-chunks', time0: 0, index: 1, dt: [], id: 'active-list', name: 'sessionbus', args: [parameters] },
    { type: 'chunk', time: 0, chunk: {
      type: 'block-end', index: 1, block: { type: 'tool-call', id: 'active-list', name: 'sessionbus', arguments: parameters },
    } },
    { type: 'chunk', time: 0, chunk: { type: 'finish', reason: { kind: 'tool-calls' } } },
  ] } }
}

export function sessionbusReplay(name: string, rows: Record<string, unknown>[]): string {
  const path = join(testDir, `${name}.jsonl`)
  writeFileSync(path, currentReplayFixture([
    { type: 'session', version: 3, id: name, createdAt: 1, cwd: '/recorded', isSeeded: false, delegationDepth: 0 },
    ...rows,
  ]))
  return path
}

export async function waitForDashiPeer(observer: TestObserver): Promise<{ session_id: string }> {
  let peer: { session_id: string } | undefined
  await vi.waitFor(async () => {
    peer = (await observer.list()).sessions.find(session => session.product === 'dashi')
    expect(peer).toBeDefined()
  }, { timeout: testCeiling(20_000), interval: 20 })
  return peer as { session_id: string }
}

export function chunkStormSnapshot(chunks = 400): string {
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
  writeFileSync(path, currentReplayFixture(rows))
  return path
}

export function tallModelCatalogPatch(): string {
  const path = join(testDir, 'tall-model-catalog.patch.yml')
  const models = Array.from({ length: 60 }, (_, index) => [
    `              - id: w054-${String(index).padStart(2, '0')}`,
    `                name: W054 row ${String(index).padStart(2, '0')}`,
    '                contextWindow: 100000',
  ].join('\n')).join('\n')
  writeFileSync(path, `- id: llm-deepseek
  disabled: true
- id: session-title-llm
  disabled: true
- id: session-persistence-jsonl
  config:
    root: !!js dshHomePath('replay-sessions')
    compression: none
- insert:
    - id: llm-replay
      name: '@deepseek-ai/dsh-llm-replay'
      config:
        file: !!js process.env.DSH_SNAPSHOT_FILE
        paceMs: 0
        providers:
          - id: w054-provider
            name: W054 provider
            models:
${models}
`)
  return path
}

export function presenterFailureSnapshot(): string {
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
  writeFileSync(path, currentReplayFixture(rows))
  return path
}

export function generateLargeSession(
  id: string, turns = 49_500, toolCells = 2_000, sessionHome = home,
): { readonly events: number; readonly toolCells: number } {
  const file = findSessionFile(join(sessionHome, 'replay-sessions'), id)
  if (file === '') throw new Error(`Missing persisted session ${id}`)
  const original = recordedSession(file)
  writeFileSync(file, `${JSON.stringify(sessionFormatCatalog.encodeCurrentHeader(
    original.header, original.inheritedEventCount,
  ))}\n`)
  let rows: string[] = []
  let seq = 0
  const add = (type: string, data: Record<string, unknown>, extra: Record<string, unknown> = {}): void => {
    rows.push(JSON.stringify(sessionFormatCatalog.encodeCurrentEvent({
      type, data, ...extra, seq, time: 1_800_000_000_000 + seq,
    } as Parameters<typeof sessionFormatCatalog.encodeCurrentEvent>[0])))
    seq++
    if (rows.length === 1_000) {
      appendFileSync(file, `${rows.join('\n')}\n`)
      rows = []
    }
  }
  // Retain DSH's native protected head so the next real step can replace it.
  const head = recordedSession(threeTurnFixture).events.find(event => event.type === 'system/message')
  if (head === undefined) throw new Error('native recorded fixture has no system head')
  add('session/title', { title: 'Large generated history', source: { kind: 'user' }, messageSeqs: [] })
  for (let turn = 1; turn <= turns; turn++) {
    add('turn/start', { turn })
    add('step/start', { turn, step: 1 })
    if (turn === 1) add('system/message', head.data as Record<string, unknown>, { surfaceOp: 'append' })
    add('user/message', {
      id: `large-user-${String(turn)}`, role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: `large prompt ${String(turn)}` }],
    }, { surfaceOp: 'append' })
    if (turn <= toolCells) {
      const callId = `large-call-${String(turn)}`
      const arguments_ = `{"path":"large-${String(turn)}"}`
      add('assistant/message', {
        turn, step: 1, message: {
          id: `large-assistant-${String(turn)}`, role: 'assistant',
          source: { kind: 'model', provider: 'replay', model: 'recorded' },
          content: [{ type: 'tool-call', id: callId, name: 'inspect', arguments: arguments_ }],
        }, stream: [],
      }, { surfaceOp: 'append' })
      add('tool/call', { turn, step: 1, callId, name: 'inspect', arguments: arguments_ })
      add('tool/result', {
        turn, step: 1, message: {
          id: `large-result-${String(turn)}`, role: 'tool', source: { kind: 'tool', callId },
          toolCallId: callId,
          content: [{ type: 'text', text: `large tool result ${String(turn)}` }],
        },
      }, { surfaceOp: 'append' })
    } else {
      add('assistant/message', {
        turn, step: 1, message: {
          id: `large-assistant-${String(turn)}`, role: 'assistant',
          source: { kind: 'model', provider: 'replay', model: 'recorded' },
          content: [{ type: 'text', text: `large answer ${String(turn)}` }],
        }, stream: [],
      }, { surfaceOp: 'append' })
    }
    add('step/end', { turn, step: 1 })
    add('turn/end', { turn, reason: { kind: 'completed' } })
  }
  if (rows.length > 0) appendFileSync(file, `${rows.join('\n')}\n`)
  // Fail at fixture production if the native V4 lifecycle is not admissible.
  recordedSession(file)
  return { events: seq, toolCells }
}

export async function expectRestored(shell: PtyShell, baseline: string): Promise<void> {
  const start = shell.output.length
  shell.write("printf '__MODE_AFTER__\\n'; stty -a | tr '\\n' ' '; printf '\\n__SHELL_OK__\\n'\n")
  const restored = await waitForTerminalMode(shell, '__MODE_AFTER__', start)
  await shell.waitFor('__SHELL_OK__', start)
  expect(relevantTerminalMode(restored)).toBe(relevantTerminalMode(baseline))
}

export function prepareTestProfile(profileHome: string): void {
  const env = { ...process.env, DSH_HOME: profileHome }
  const plugin = join(root, 'packages', 'dashi')
  const noUploads = join(root, 'packages', 'file-uploads-none')
  const profile = join(root, 'packages', 'dashi-app')
  const profileDir = join(profileHome, 'profiles', 'dashi')
  writeDshPinHook(profileDir)
  run(dsh, ['plugin', '--profile', 'dashi', 'install'], env)
  appendFileSync(join(profileDir, 'pnpm-workspace.yaml'),
    `\nminimumReleaseAge: 0\noverrides:\n  '@antst/dashi': 'link:${plugin}'\n  '@antst/dsh-file-uploads-none': 'link:${noUploads}'\n`)
  run(dsh, ['plugin', '--profile', 'dashi', 'add', profile], env)
  run('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh-llm-replay@${testedDshVersion}`], env,
    profileDir)
  run('pnpm', ['add', questionPlugin], env, profileDir)
}


// Each isolated spec registers its own lifecycle and creates unique private homes.
export function setupProfileFixtures(): void {
  beforeAll(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), 'dashi-profile-')))
    home = join(testDir, 'home')
    hardeningHome = join(testDir, 'hardening-home')
    launchFlagsHome = join(testDir, 'launch-flags-home')
    overlayHome = join(testDir, 'overlay-home')
    pluginHome = join(testDir, 'plugin-home')
    pluginSandboxHome = join(testDir, 'plugin-sandbox-home')
    mcpHome = join(testDir, 'mcp-home')
    rewindDefaultHome = join(testDir, 'rewind-default-home')
    presetHome = join(testDir, 'preset-home')
    hardeningCwd = join(testDir, 'hardening-workspace')
    mkdirSync(hardeningCwd)
    prepareTestProfile(home)
    prepareTestProfile(hardeningHome)
    prepareTestProfile(launchFlagsHome)
    prepareTestProfile(overlayHome)
    prepareTestProfile(pluginHome)
    prepareTestProfile(pluginSandboxHome)
    prepareTestProfile(mcpHome)
    prepareTestProfile(rewindDefaultHome)
    prepareTestProfile(presetHome)
    run('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh-mcp-client@${testedDshVersion}`],
      { ...process.env, DSH_HOME: mcpHome }, join(mcpHome, 'profiles', 'dashi'))
  }, 120_000)

  afterAll(() => {
    if (testDir !== '') rmSync(testDir, { recursive: true, force: true })
  })
}
