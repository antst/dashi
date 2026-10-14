import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, chmodSync, constants, accessSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Terminal } from '@xterm/headless'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TestPtyShell } from './pty-shell.js'
import { testCeiling } from './test-budget.js'
import { connectTestObserver, startTestDaemon, type TestDaemon } from './sessionbus-harness.js'
import { keyRequiredEndpoint } from './fixtures/key-required-endpoint.js'
import { deriveCliPins } from '../../../scripts/dsh-cli-pins.mjs'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const dsh = join(root, 'node_modules/.bin/dsh')
const launcher = join(root, 'packages/dashi-launcher/bin/dashi.js')
let directory = ''
let daemon: TestDaemon
let endpoint: Awaited<ReturnType<typeof keyRequiredEndpoint>>
let seed = ''

function run(args: string[], env: NodeJS.ProcessEnv): void {
  execFileSync(dsh, args, { cwd: root, env, stdio: 'pipe', timeout: 120_000 })
}
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'dashi-first-run-'))
  endpoint = await keyRequiredEndpoint()
  daemon = await startTestDaemon()
  seed = join(directory, 'seed')
  const profile = join(seed, 'profiles/dashi')
  mkdirSync(profile, { recursive: true })
  const cli = JSON.parse(readFileSync(join(root, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
  // Repo-only candidate wiring: same CLI closure and workspace siblings as the existing profile PTY fixture.
  writeFileSync(join(profile, '.pnpmfile.cjs'), `const pins = ${JSON.stringify(deriveCliPins(cli.dependencies))}; module.exports={hooks:{readPackage(pkg){for(const field of ['dependencies','peerDependencies','optionalDependencies'])for(const name of Object.keys(pkg[field]??{})){if(name.startsWith('@deepseek-ai/dsh'))pkg[field][name]=${JSON.stringify(cli.version)};else if(pins[name])pkg[field][name]=pins[name]}return pkg}}}`)
  const env = { ...process.env, DSH_HOME: seed }
  run(['plugin', '--profile', 'dashi', 'install'], env)
  appendFileSync(join(profile, 'pnpm-workspace.yaml'), `\nminimumReleaseAge: 0\noverrides:\n  '@antst/dashi': 'link:${join(root, 'packages/dashi')}'\n  '@antst/dsh-file-uploads-none': 'link:${join(root, 'packages/file-uploads-none')}'\n`)
  run(['plugin', '--profile', 'dashi', 'add', join(root, 'packages/dashi-app')], env)
}, 120_000)

afterAll(async () => {
  await daemon?.close()
  await endpoint?.close()
  if (directory) rmSync(directory, { recursive: true, force: true })
})

async function screen(shell: TestPtyShell): Promise<string> {
  const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 })
  await new Promise<void>(resolve => { terminal.write(shell.output, resolve) })
  const text = Array.from({ length: terminal.rows }, (_, row) => terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true) ?? '').join('\n')
  terminal.dispose()
  return text
}

function sessionFile(directory: string, id: string): string | undefined {
  if (!existsSync(directory)) return undefined
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) { const found = sessionFile(path, id); if (found) return found }
    else if (path.includes(id) && /^session(?:\.v\d+)?\.jsonl$/u.test(entry.name)) return path
  }
}

function events(home: string, id: string): any[] {
  const path = sessionFile(join(home, 'sessions'), id)
  if (path === undefined) return []
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').slice(1).map(line => JSON.parse(line)) : []
}

async function boot(name: string, control?: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const home = join(directory, name)
  mkdirSync(join(home, 'profiles'), { recursive: true })
  // Only the immutable installed test profile is shared; settings, credentials and sessions are fresh per case.
  const { cpSync } = await import('node:fs')
  cpSync(join(seed, 'profiles/dashi'), join(home, 'profiles/dashi'), { recursive: true, dereference: false })
  const patch = join(home, 'transport.patch.yml')
  writeFileSync(patch, "- id: session-title-llm\n  disabled: true\n- id: session-persistence-jsonl\n  config:\n    root: !!js dshHomePath('sessions')\n    compression: none\n")
  if (control) appendFileSync(patch, `- insert:\n    - id: first-run-control\n      name: '${fileURLToPath(new URL(`./fixtures/${control}.mjs`, import.meta.url))}'\n`)
  const cwd = join(home, 'cwd')
  mkdirSync(cwd)
  return start(home, extraEnv)
}

async function start(home: string, extraEnv: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env, DSH_HOME: home, DEEPSEEK_BASE_URL: endpoint.url,
    SESSIONBUS_SOCKET: daemon.socket, SESSIONBUS_GROUPS: '["w127"]', DSH_TELEMETRY_DISABLED: '1',
    PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH ?? ''}`, TERM: 'xterm-256color', PS1: '', PROMPT_COMMAND: '',
  }
  delete (env as NodeJS.ProcessEnv).DEEPSEEK_API_KEY
  Object.assign(env, extraEnv)
  const shell = new TestPtyShell(join(home, 'cwd'), env)
  shell.write(`${quote(process.execPath)} ${quote(launcher)} --patch ${quote(join(home, 'transport.patch.yml'))} --fullscreen; printf '__W127_EXIT__%s\\n' "$?"\n`)
  try {
    await shell.waitFor('idle ·')
    const id = /session-[\da-f-]{36}/u.exec(shell.output)?.[0]
    if (id === undefined) throw new Error('first-run screen omitted native session id')
    return { home, shell, id }
  } catch (error) { await shell.close(); throw error }
}

async function commandDone(home: string, id: string, text: string, after = -1): Promise<void> {
  await vi.waitFor(() => { expect(events(home, id).some(event => event.seq > after && event.type === 'command/done' && String(event.data.text).includes(text))).toBe(true) }, { timeout: testCeiling(20_000), interval: 20 })
}

async function selectRow(shell: TestPtyShell, label: string): Promise<void> {
  await vi.waitFor(async () => {
    const footer = (await screen(shell)).split('\n').at(-1)?.trim() ?? ''
    expect(footer.startsWith('decision 1/') || footer.startsWith('model ·')).toBe(true)
  }, { timeout: testCeiling(20_000) })
  // Move by native cursor observations, not a hard-coded catalog index.
  for (let index = 0; index < 200; index++) {
    const frame = await screen(shell)
    if (frame.split('\n').some(line => line.includes(label) && /[›❯▶]/u.test(line))) { shell.write('\r'); return }
    shell.write('\u001B[B')
    const cursor = /›\s+(\d+)/u.exec(frame)?.[1]
    await vi.waitFor(async () => { expect(/›\s+(\d+)/u.exec(await screen(shell))?.[1]).not.toBe(cursor) }, { timeout: testCeiling(20_000), interval: 20 })
  }
  throw new Error(`Picker did not select ${label}`)
}

async function keyQuestion(shell: TestPtyShell, key: string): Promise<void> {
  await vi.waitFor(async () => { expect(await screen(shell)).toContain('Enter the credential') }, { timeout: testCeiling(20_000) })
  shell.write(`${key}\r`)
}

async function completed(home: string, id: string, marker: string): Promise<void> {
  try { await vi.waitFor(() => {
    const log = events(home, id)
    const assistant = log.find(event => event.type === 'assistant/message' && JSON.stringify(event.data.message.content).includes(`${marker} completed`))
    expect(assistant).toBeDefined()
    expect(log.some(event => event.type === 'turn/end' && event.data.turn === assistant?.data.turn && event.data.reason.kind === 'completed')).toBe(true)
  }, { timeout: testCeiling(20_000), interval: 20 }) } catch (error) {
    console.error('W127 native outcomes', JSON.stringify(events(home, id).filter(event => ['turn/end', 'command/done', 'assistant/message'].includes(event.type))).replaceAll(endpoint.key(), '[redacted-test-key]'))
    console.error('W127 endpoint observations', JSON.stringify(endpoint.accepted), endpoint.rejected())
    throw error
  }
}

function noSecret(shell: TestPtyShell, home: string, id: string, key: string): void {
  for (const value of [key, key.slice(0, 12)]) {
    expect(shell.output.includes(value), 'secret leaked into raw PTY/scrollback').toBe(false)
    expect(JSON.stringify(events(home, id)).includes(value), 'secret leaked into native history/commands').toBe(false)
  }
  const audit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) audit(path)
      else if (entry.isFile() && path !== join(home, '.credentials.yaml')) {
        const bytes = readFileSync(path)
        for (const value of [key, key.slice(0, 12)]) expect(bytes.includes(Buffer.from(value)), `secret leaked into ${path}`).toBe(false)
      }
    }
  }
  audit(home)
}

async function close(shell: TestPtyShell, home: string, id: string): Promise<void> {
  try {
    if ((await screen(shell)).includes('decision 1/')) shell.write('\u001B')
    await vi.waitFor(() => {
      const log = events(home, id)
      const done = new Set(log.filter(event => event.type === 'command/done').map(event => event.data.commandId))
      expect(log.filter(event => event.type === 'command/run').every(event => done.has(event.data.commandId))).toBe(true)
    }, { timeout: testCeiling(20_000), interval: 20 })
    if (!(await screen(shell)).includes('idle ·')) await leavePicker(shell)
    shell.write('\u0004\u0004')
    await shell.waitFor('__W127_EXIT__0')
    noSecret(shell, home, id, endpoint.key())
  } finally { await shell.close() }
}

async function leavePicker(shell: TestPtyShell, purpose = 'model'): Promise<void> {
  await vi.waitFor(async () => { expect((await screen(shell)).split('\n').at(-1)?.trim().startsWith(`${purpose} ·`)).toBe(true) }, { timeout: testCeiling(20_000) })
  shell.write('\u001B')
  await vi.waitFor(async () => { expect((await screen(shell)).split('\n').at(-1)?.trim().startsWith('idle ·')).toBe(true) }, { timeout: testCeiling(20_000) })
}

const credentialDigest = (home: string): string => existsSync(join(home, '.credentials.yaml'))
  ? createHash('sha256').update(readFileSync(join(home, '.credentials.yaml'))).digest('hex') : 'absent'

describe.sequential('known-provider first run, real native writers and authenticated turns', () => {
  it('guides a fresh profile, fails the first prompt, then completes a NEW prompt with a masked stored key', async () => {
    const { home, shell, id } = await boot('fresh')
    const key = endpoint.key()
    const requests = endpoint.accepted.length
    try {
      await shell.waitFor('credential DEEPSEEK_API_KEY is not configured')
      expect((await fetch(`${endpoint.url}/messages`, { method: 'POST' })).status).toBe(401)
      expect((await fetch(`${endpoint.url}/messages`, { method: 'POST', headers: { 'x-api-key': 'wrong-test-key' } })).status).toBe(401)
      const rejected = endpoint.rejected()
      shell.write('W127_FIRST_PROMPT\r')
      await vi.waitFor(() => { expect(events(home, id).some(event => event.type === 'turn/end' && event.data.reason.error?.code === 'MISSING_CREDENTIAL')).toBe(true) }, { timeout: testCeiling(20_000) })
      await shell.waitFor('deepseek-official: use /login to sign in')
      expect(endpoint.accepted.length).toBe(requests)
      expect(endpoint.rejected()).toBe(rejected)
      shell.write('/model\r')
      await selectRow(shell, 'Set credential for DeepSeek')
      await keyQuestion(shell, key)
      await commandDone(home, id, 'credential stored')
      expect(events(home, id).filter(event => event.type === 'turn/start')).toHaveLength(1)
      await leavePicker(shell)
      await vi.waitFor(async () => { expect(await screen(shell)).not.toContain('Set credential for DeepSeek') }, { timeout: testCeiling(20_000) })
      shell.write('W127_NEW_PROMPT\r')
      await completed(home, id, 'W127_NEW_PROMPT')
      expect(events(home, id).filter(event => event.type === 'turn/start')).toHaveLength(2)
      expect(endpoint.accepted.slice(requests)).toEqual([{ marker: 'W127_NEW_PROMPT', path: '/v1/messages' }])
      shell.write('/export transcript.md\r')
      await commandDone(home, id, 'exported')
      const exported = readFileSync(join(home, 'cwd/transcript.md'), 'utf8')
      expect(exported).toContain('W127_NEW_PROMPT completed')
      expect(exported.includes(key), 'secret leaked into native transcript export').toBe(false)
      expect(exported.includes(key.slice(0, 12)), 'secret prefix leaked into native transcript export').toBe(false)
      shell.write('/history\r')
      await vi.waitFor(async () => { expect((await screen(shell)).split('\n').at(-1)?.trim().startsWith('history ·')).toBe(true) }, { timeout: testCeiling(20_000) })
      await leavePicker(shell, 'history')
      noSecret(shell, home, id, key)
    } finally { await close(shell, home, id) }
    // A second ordinary launch reads the real native credential document written above.
    const configured = await start(home)
    try {
      configured.shell.write('W127_CONFIGURED_PROMPT\r')
      await completed(home, configured.id, 'W127_CONFIGURED_PROMPT')
    } finally { await close(configured.shell, home, configured.id) }
    expect(configured.shell.output).not.toContain('credential DEEPSEEK_API_KEY is not configured')
  }, testCeiling(30_000))
  it('adds a dormant native catalog route and chooses its flow from the unfiltered native login list', async () => {
    const { home, shell, id } = await boot('catalog')
    try {
      shell.write('/model\r')
      await shell.waitFor('Add provider')
      await selectRow(shell, 'Add provider')
      await shell.waitFor('Choose a provider DSH already knows')
      await selectRow(shell, 'deepseek')
      await vi.waitFor(async () => { expect(await screen(shell)).toContain('provider deepseek added') }, { timeout: testCeiling(20_000) })
      await selectRow(shell, 'DeepSeek · llm-pi-ai/deepseek')
      await shell.waitFor('Enter DeepSeek API key')
      shell.write(`${endpoint.key()}\r`)
      await commandDone(home, id, 'signed in to DeepSeek')
      await leavePicker(shell)
      await vi.waitFor(async () => { expect(await screen(shell)).not.toContain('Add provider') }, { timeout: testCeiling(20_000) })
      // Transport redirection only: W-127 adds the native catalog defaults, not a custom endpoint form.
      shell.write(`/config llm-pi-ai providers.deepseek.baseURL=${JSON.stringify(endpoint.url)}\r`)
      await commandDone(home, id, 'updated llm-pi-ai.providers.deepseek.baseURL')
      shell.write('/model\r')
      await shell.waitFor('deepseek ·')
      await selectRow(shell, 'deepseek ·')
      shell.write('W127_CATALOG_PROMPT\r')
      await completed(home, id, 'W127_CATALOG_PROMPT')
      noSecret(shell, home, id, endpoint.key())
    } catch (error) {
      console.error('W127 catalog screen', (await screen(shell)).replaceAll(endpoint.key(), '[redacted-test-key]'))
      throw error
    } finally { await close(shell, home, id) }
  }, testCeiling(30_000))
  it('requires shared-reference replacement confirmation, permits cancellation, and completes with the replacement', async () => {
    const { home, shell, id } = await boot('replacement')
    const old = endpoint.key()
    try {
      shell.write('/model credential deepseek-official\r')
      await keyQuestion(shell, old)
      await commandDone(home, id, 'credential stored')
      await leavePicker(shell)
      const before = credentialDigest(home)
      endpoint.rotate()
      shell.write('/model credential deepseek-official\r')
      await shell.waitFor('Other profiles use the same shared credential store')
      await selectRow(shell, 'Cancel')
      await commandDone(home, id, 'credential replacement cancelled')
      expect(credentialDigest(home)).toBe(before)
      await leavePicker(shell)
      const replacedAfter = events(home, id).at(-1)?.seq ?? -1
      shell.write('/model credential deepseek-official\r')
      await selectRow(shell, 'Replace')
      await keyQuestion(shell, endpoint.key())
      await vi.waitFor(() => { expect(credentialDigest(home)).not.toBe(before) }, { timeout: testCeiling(20_000) })
      await commandDone(home, id, 'credential stored', replacedAfter)
      await leavePicker(shell)
      shell.write('W127_REPLACEMENT\r')
      await completed(home, id, 'W127_REPLACEMENT')
      noSecret(shell, home, id, old); noSecret(shell, home, id, endpoint.key())
    } finally { await close(shell, home, id) }
  }, testCeiling(30_000))

  it('cancels a masked question without a write, then keeps it answerable through native peer delivery', async () => {
    const { home, shell, id } = await boot('cancel-peer')
    const observer = await connectTestObserver(daemon.socket, 'w127', 'W127 setup observer')
    try {
      shell.write('/model credential deepseek-official\r')
      await shell.waitFor('Enter the credential')
      shell.write(endpoint.key().slice(0, 12))
      await vi.waitFor(async () => { expect(await screen(shell)).toContain('•••') }, { timeout: testCeiling(20_000) })
      shell.write('\u001B')
      await commandDone(home, id, 'model setup cancelled')
      expect(credentialDigest(home)).toBe('absent')
      await leavePicker(shell)
      shell.write('/model credential deepseek-official\r')
      await shell.waitFor('Enter the credential')
      let target = ''
      await vi.waitFor(async () => { target = (await observer.list()).sessions.find(row => row.session_id.startsWith(id + '@'))?.session_id ?? ''; expect(target).not.toBe('') }, { timeout: testCeiling(20_000) })
      const result = await observer.send({ target, message: 'W127_PEER_DURING_SETUP' })
      expect(result.deliveries[0]?.disposition).toBe('injected')
      await vi.waitFor(() => { expect(events(home, id).some(event => event.type === 'turn/end' && event.data.reason.error?.code === 'MISSING_CREDENTIAL')).toBe(true) }, { timeout: testCeiling(20_000) })
      expect(await screen(shell)).toContain('Enter the credential')
      shell.write(`${endpoint.key()}\r`)
      await commandDone(home, id, 'credential stored')
      await leavePicker(shell)
      shell.write('W127_AFTER_PEER\r')
      await completed(home, id, 'W127_AFTER_PEER')
      noSecret(shell, home, id, endpoint.key())
    } finally { await observer.close(); await close(shell, home, id) }
  }, testCeiling(30_000))

  it('reports a committed provider separately from a real EACCES credential failure', async () => {
    const { home, shell, id } = await boot('partial')
    try {
      shell.write('/model add\r')
      await shell.waitFor('Choose a provider DSH already knows')
      await selectRow(shell, 'deepseek')
      await shell.waitFor('Choose a sign-in option')
      await selectRow(shell, 'DeepSeek · llm-pi-ai/deepseek')
      await shell.waitFor('Enter DeepSeek API key')
      chmodSync(home, 0o500)
      let refused = false
      try { accessSync(home, constants.W_OK) } catch { refused = true }
      if (!refused) throw new Error('EACCES control invalid: this process can still write the credential directory (for example root)')
      shell.write(`${endpoint.key()}\r`)
      // Native pi-ai wraps the OS failure as code auth; its native message retains the EACCES cause.
      await commandDone(home, id, 'EACCES: permission denied')
      expect(events(home, id).find(event => event.type === 'command/done' && event.data.text?.includes('EACCES: permission denied'))?.data.text).toContain('provider deepseek added; sign-in failed:')
      expect(readFileSync(join(home, 'profiles/dashi/cordis.patch.yml'), 'utf8')).toContain('deepseek:')
      expect(credentialDigest(home)).toBe('absent')
      noSecret(shell, home, id, endpoint.key())
    } finally { chmodSync(home, 0o700); await close(shell, home, id) }
  }, testCeiling(30_000))
  it('refuses a stale native settings revision without deleting the concurrent provider or writing credentials', async () => {
    const { home, shell, id } = await boot('revision', 'first-run-revision')
    const observer = await connectTestObserver(daemon.socket, 'w127', 'W127 revision observer')
    try {
      shell.write('/model add\r')
      await shell.waitFor('Choose a provider DSH already knows')
      let target = ''
      await vi.waitFor(async () => { target = (await observer.list()).sessions.find(row => row.session_id.startsWith(id + '@'))?.session_id ?? ''; expect(target).not.toBe('') }, { timeout: testCeiling(20_000) })
      await observer.send({ target, message: 'W127_CONCURRENT_NATIVE_WRITER' })
      await vi.waitFor(() => { expect(readFileSync(join(home, 'profiles/dashi/cordis.patch.yml'), 'utf8')).toContain('Concurrent native update') }, { timeout: testCeiling(20_000) })
      await selectRow(shell, 'deepseek')
      await vi.waitFor(() => { expect(events(home, id).some(event => event.type === 'command/done' && event.data.kind === 'error' && event.data.text.includes('changed since it was read'))).toBe(true) }, { timeout: testCeiling(20_000) })
      expect(readFileSync(join(home, 'profiles/dashi/cordis.patch.yml'), 'utf8')).toContain('Concurrent native update')
      expect(credentialDigest(home)).toBe('absent')
    } finally { await observer.close(); await close(shell, home, id) }
  }, testCeiling(30_000))

  it('cancels provider selection and replacement of an inherited credential without changing its fallback', async () => {
    const { home, shell, id } = await boot('read-only', undefined, { DEEPSEEK_API_KEY: endpoint.key() })
    try {
      shell.write('/model add\r')
      await shell.waitFor('Choose a provider DSH already knows')
      shell.write('\u001B')
      await commandDone(home, id, 'model setup cancelled')
      expect(readFileSync(join(home, 'profiles/dashi/cordis.patch.yml'), 'utf8')).not.toContain('deepseek:')
      await leavePicker(shell)
      shell.write('/model credential deepseek-official\r')
      await shell.waitFor('Replace credential')
      await selectRow(shell, 'Cancel')
      await commandDone(home, id, 'credential replacement cancelled')
      expect(shell.output).not.toContain('Enter the credential')
      expect(credentialDigest(home)).toBe('absent')
      await leavePicker(shell)
      shell.write('/model credential "abc\r')
      await commandDone(home, id, 'usage: /model [credential PROVIDER | add]')
      expect(shell.output).not.toContain('SyntaxError')
      await leavePicker(shell)
      shell.write('W127_ENV_PROMPT\r')
      await completed(home, id, 'W127_ENV_PROMPT')
      noSecret(shell, home, id, endpoint.key())
    } finally { await close(shell, home, id) }
    expect(shell.output).not.toContain('credential DEEPSEEK_API_KEY is not configured')
  }, testCeiling(30_000))

  it('keeps an actual wrong-key authentication error distinct from a missing credential, without replay', async () => {
    const { home, shell, id } = await boot('wrong-key')
    const wrong = `${endpoint.key()}-wrong`
    const rejected = endpoint.rejected()
    const requests = endpoint.accepted.length
    try {
      shell.write('/model credential deepseek-official\r')
      await keyQuestion(shell, wrong)
      await commandDone(home, id, 'credential stored')
      await leavePicker(shell)
      const turnAt = shell.output.length
      shell.write('W127_WRONG_KEY\r')
      await vi.waitFor(() => { expect(events(home, id).some(event => event.type === 'turn/end' && event.data.reason.error?.code === 'AUTH')).toBe(true) }, { timeout: testCeiling(20_000) })
      expect(endpoint.rejected()).toBe(rejected + 1)
      expect(endpoint.accepted.length).toBe(requests)
      expect(events(home, id).filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(shell.output.slice(turnAt)).not.toContain('deepseek-official: use /login to sign in')
      noSecret(shell, home, id, wrong)
    } finally { await close(shell, home, id) }
  }, testCeiling(30_000))

  it('keeps a saved provider when its native login question is cancelled', async () => {
    const { home, shell, id } = await boot('cancel-login')
    try {
      shell.write('/model add\r')
      await shell.waitFor('Choose a provider DSH already knows')
      await selectRow(shell, 'deepseek')
      await selectRow(shell, 'DeepSeek · llm-pi-ai/deepseek')
      await shell.waitFor('Enter DeepSeek API key')
      shell.write('\u001B')
      await commandDone(home, id, 'provider deepseek added; login cancelled')
      expect(readFileSync(join(home, 'profiles/dashi/cordis.patch.yml'), 'utf8')).toContain('deepseek:')
      expect(credentialDigest(home)).toBe('absent')
      expect(events(home, id).filter(event => event.type === 'turn/start')).toHaveLength(0)
    } finally { await close(shell, home, id) }
  }, testCeiling(30_000))

  it('keeps a provider saved when sign-in flow selection is cancelled before any login attempt', async () => {
    const { home, shell, id } = await boot('cancel-flow')
    try {
      shell.write('/model add\r')
      await shell.waitFor('Choose a provider DSH already knows')
      await selectRow(shell, 'deepseek')
      await shell.waitFor('Choose a sign-in option')
      shell.write('\u001B')
      await commandDone(home, id, 'provider deepseek added; sign-in cancelled')
      expect(events(home, id).at(-1)?.data.text).not.toContain('ASK_ABORTED')
      expect(readFileSync(join(home, 'profiles/dashi/cordis.patch.yml'), 'utf8')).toContain('deepseek:')
      expect(credentialDigest(home)).toBe('absent')
    } finally { await close(shell, home, id) }
  }, testCeiling(30_000))

  it('records a successful credential write before reporting a subsequent picker read failure', async () => {
    const { home, shell, id } = await boot('picker-failure', 'first-run-catalog-failure')
    try {
      shell.write('/model credential deepseek-official\r')
      await keyQuestion(shell, endpoint.key())
      await commandDone(home, id, 'credential stored')
      await shell.waitFor('W127_CATALOG_READ_FAILED')
      const result = events(home, id).find(event => event.type === 'command/done')
      expect(result?.data.kind).toBe('success')
      expect(result?.data.text).toContain('credential stored')
      expect(credentialDigest(home)).not.toBe('absent')
      shell.write('W127_PICKER_FAILURE_PROMPT\r')
      await completed(home, id, 'W127_PICKER_FAILURE_PROMPT')
    } finally { await close(shell, home, id) }
  }, testCeiling(30_000))

  it('does not let an old plain-login completion dismiss the new root model picker', async () => {
    const { home, shell, id } = await boot('old-login', 'first-run-delayed-login')
    let currentId = id
    try {
      shell.write('/login w127/delayed-login key\r')
      await shell.waitFor('W127_OLD_LOGIN_PENDING')
      await vi.waitFor(() => { expect(endpoint.loginWaiting()).toBe(true) }, { timeout: testCeiling(20_000) })
      shell.write('\u001B')
      // Closing the notice does not settle the deliberately pending native login command.
      await vi.waitFor(async () => { expect((await screen(shell)).split('\n').at(-1)?.trim()).toContain('running /login') }, { timeout: testCeiling(20_000) })
      shell.write('/new\r')
      await vi.waitFor(() => {
        currentId = [...shell.output.matchAll(/session-[\da-f-]{36}/gu)].map(match => match[0]).find(value => value !== id) ?? id
        expect(currentId).not.toBe(id)
      }, { timeout: testCeiling(20_000) })
      shell.write('/model\r')
      await vi.waitFor(async () => { expect((await screen(shell)).split('\n').at(-1)?.trim().startsWith('model ·')).toBe(true) }, { timeout: testCeiling(20_000) })
      endpoint.releaseLogin()
      await commandDone(home, id, 'signed in to W127 delayed login')
      shell.write('\u001B[B')
      await vi.waitFor(async () => { expect(await screen(shell)).toContain('› 2 Add provider') }, { timeout: testCeiling(20_000) })
      expect((await screen(shell)).split('\n').at(-1)?.trim().startsWith('model ·')).toBe(true)
      expect(await screen(shell)).toContain(currentId)
    } catch (error) {
      console.error('W127 old-login frame', (await screen(shell)).replaceAll(endpoint.key(), '[redacted-test-key]').replaceAll(endpoint.key().slice(0, 12), '[redacted-test-prefix]'))
      console.error('W127 old-login commands', JSON.stringify(events(home, id).filter(event => ['command/run', 'command/done'].includes(event.type))))
      throw error
    } finally { endpoint.cancelLogin(); await close(shell, home, currentId) }
  }, testCeiling(30_000))
})
