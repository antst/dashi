import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, onTestFailed, vi } from 'vitest'
import { TestPtyShell } from './pty-shell.js'
import { dashiLauncher, root, prepareTestProfile, parsedFrame, quote,
  relevantTerminalMode, waitForTerminalMode } from './profile-pty-harness.js'
import { testCeiling } from './test-budget.js'

let directory = ''
let home = ''
beforeAll(() => {
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'dashi-listing-')))
  home = join(directory, 'home')
  prepareTestProfile(home)
}, 120_000)
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }) })

describe.sequential('native official DeepSeek listing under terminal ownership', () => {
  it.each(['success', 'failure', 'invalid catalog', 'refresh'] as const)('%s has no foreign terminal bytes and is visible in /status', async kind => {
    const started = performance.now(), stages: [string, number][] = []
    let stage = 'loopback listen', lastRows = '(no decoded frame)', start = 0
    let shell: TestPtyShell | undefined, exited = false
    const requests: { method: string; path: string; authenticated: boolean }[] = []
    const mark = (value: string) => { stage = value; stages.push([value, performance.now() - started]) }
    const key = 'w156-fake-listing-key'
    const server = createServer((request, response) => {
      const authenticated = request.headers['x-api-key'] === key
      requests.push({ method: request.method ?? '', path: request.url ?? '', authenticated })
      request.resume()
      if (request.method !== 'GET' || request.url !== '/models' || !authenticated) {
        response.writeHead(401, { 'content-type': 'application/json' }).end('{}')
        return
      }
      if (kind === 'failure') {
        response.writeHead(503, { 'content-type': 'application/json' }).end('{}')
        return
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [{
        id: 'deepseek-flash', name: requests.length === 1 ? 'W156 initial model' : 'W156 refreshed model', context_window: 1_048_576,
        input_modalities: ['text', 'image'], output_modalities: ['text'],
        api_capabilities: { anthropic_messages: { system_prompt_update: 'in-history', tool_update: 'addition-only' } },
        ...(kind === 'invalid catalog' ? { client_requirements: { 'deepseek-harness': { min_version: 'not-a-version' } } } : {}),
      }] }))
    })
    onTestFailed(async () => {
      if (shell) try { lastRows = (await parsedFrame(shell.output.slice(start), 80, 40)).text } catch { /* retain last decode */ }
      const packet = join(root, '.cache', 'lifecycle-failures', 'deepseek-listing', kind.replaceAll(' ', '-'))
      mkdirSync(packet, { recursive: true })
      writeFileSync(join(packet, 'terminal.txt'), shell?.output ?? '')
      writeFileSync(join(packet, 'frame.txt'), lastRows)
      writeFileSync(join(packet, 'facts.json'), JSON.stringify({ stage, stages, requests }, null, 2))
      process.stderr.write(`W156 listing failure: ${stage}; stages ${JSON.stringify(stages)}\nlast rows:\n${lastRows}\n`)
    })
    const wait = async (name: string, check: () => Promise<void> | void) => {
      mark(name)
      await vi.waitFor(async () => {
        if (shell) lastRows = (await parsedFrame(shell.output.slice(start), 80, 40)).text
        try { await check() } catch (error) { throw new Error(`Waiting for ${name}\n${lastRows}`, { cause: error }) }
      }, { timeout: testCeiling(10_000), interval: 20 })
    }
    const command = async (name: string) => {
      shell!.write(`/${name} `)
      await wait(`exact /${name} composer with completion closed`, async () => {
        const frame = await parsedFrame(shell!.output.slice(start), 80, 40)
        expect(frame.composer.trim()).toBe(`/${name}`)
        expect(frame.status).toContain('idle ·')
      })
      shell!.write('\r')
    }
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve)
      })
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('loopback listener has no port')
      const own = join(directory, kind.replaceAll(' ', '-')), patch = join(own, 'listing.patch.yml')
      mkdirSync(own)
      writeFileSync(patch, `- id: session-title-llm\n  disabled: true\n- id: llm-deepseek\n  config:\n    modelsMaxAgeMs: ${kind === 'refresh' ? '1000' : '0'}\n`)
      const env: NodeJS.ProcessEnv = { ...process.env, DSH_HOME: home,
        DEEPSEEK_API_KEY: key, DEEPSEEK_BASE_URL: 'https://api.deepseek.com/anthropic',
        DSH_LISTING_LOOPBACK: `http://127.0.0.1:${address.port}`,
        NODE_OPTIONS: `--import=${pathToFileURL(join(root, 'packages/dashi/tests/fixtures/deepseek-listing-loopback.mjs')).href}`,
        SESSIONBUS_SOCKET: join(own, 'absent.sock'), DSH_TELEMETRY_DISABLED: '1',
        PATH: `${join(root, 'node_modules/.bin')}:${process.env.PATH ?? ''}`,
        TERM: 'xterm-256color', PS1: '', PROMPT_COMMAND: '', NO_COLOR: '1',
      }
      delete env.SESSIONBUS_LAUNCH_TOKEN
      delete env.SESSIONBUS_GROUPS
      shell = new TestPtyShell(own, env)
      shell.resize(80, 40)
      shell.write("printf '__W156_BEFORE__\\n'; stty -a | tr '\\n' ' '; printf '\\n'\n")
      mark('baseline stty')
      const baseline = await waitForTerminalMode(shell, '__W156_BEFORE__', 0)
      start = shell.output.length
      shell.write(`${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(patch)} --inline; printf '__W156_EXIT__%s\\n' "$?"\n`)
      await wait('native idle root and acquired bracketed-paste mode', () => {
        expect(shell!.output.slice(start)).toMatch(/session-[\da-f-]{36}/u)
        expect(lastRows).toContain('idle ·')
        expect(shell!.output.slice(start)).toContain('\u001B[?2004h')
      })
      // No launch-time model selection: the first catalog request is a human
      // /model after acquisition, so its first listing waits for the real load.
      expect(requests).toHaveLength(0)
      const acquiredAt = start + shell.output.slice(start).indexOf('\u001B[?2004h')
      await command('model')
      await wait('authenticated native first listing and model picker', () => {
        expect(requests.length).toBeGreaterThan(0)
        expect(requests.every(r => r.method === 'GET' && r.path === '/models' && r.authenticated)).toBe(true)
        expect(lastRows).toContain('Add provider')
        if (kind === 'success' || kind === 'refresh') expect(lastRows).toContain('W156 initial model')
      })
      if (kind === 'refresh') await wait('automatic refresh settles and schedules the next listing', () => {
        // The next timer is armed only after the previous load settles. A third
        // request therefore proves one background refresh completed; an open
        // picker is a snapshot, not a subscription to catalog changes.
        expect(requests.length).toBeGreaterThanOrEqual(3)
      })
      shell.write('\u001B')
      await wait('picker cancelled back to idle', () => { expect(lastRows).toContain('idle ·') })
      if (kind === 'refresh') {
        await command('model')
        await wait('reopened picker reads the refreshed native catalog', () => {
          expect(lastRows).toContain('W156 refreshed model')
          expect(lastRows).not.toContain('W156 initial model')
        })
        shell.write('\u001B')
        await wait('refreshed picker cancelled back to idle', () => { expect(lastRows).toContain('idle ·') })
      }
      expect(shell.output.slice(acquiredAt)).not.toContain('[llm-deepseek-api-key]')
      expect(shell.output).not.toContain(key)
      await command('status')
      await wait('captured native listing diagnostic is readable in Status', () => {
        expect(lastRows).toMatch(/[1-9]\d* diagnostics captured/u)
        expect(lastRows).toContain('[llm-deepseek-api-key]')
        if (kind === 'failure') expect(lastRows).toContain('failed (')
        else expect(lastRows).toContain('loaded 1 model(s)')
        if (kind === 'invalid catalog') {
          expect(lastRows).toContain('declares an unreadable')
          expect(lastRows).toContain('client requirement')
        }
        if (kind === 'refresh') expect(Number(/(\d+) diagnostics captured/u.exec(lastRows)?.[1])).toBeGreaterThanOrEqual(2)
        expect(lastRows).toContain(kind === 'failure' || kind === 'invalid catalog' ? '[warn]' : '[error]')
      })
      shell.write('\u001B')
      await wait('Status closed back to idle', () => { expect(lastRows).toContain('idle ·') })
      shell.write('\u0004\u0004')
      mark('ordinary exit 0 and Resume with receipt')
      await shell.waitFor('__W156_EXIT__0', start)
      expect(shell.output.slice(start)).toContain('Resume with:')
      exited = true
      const modeAt = shell.output.length
      shell.write("printf '__W156_AFTER__\\n'; stty -a | tr '\\n' ' '; printf '\\n'\n")
      const restored = await waitForTerminalMode(shell, '__W156_AFTER__', modeAt)
      expect(relevantTerminalMode(restored)).toBe(relevantTerminalMode(baseline))
    } finally {
      if (shell && !exited) {
        try { process.kill(shell.childPid(), 'SIGTERM'); await shell.waitFor('__W156_EXIT__', start, 10_000) }
        catch { /* original named failure and terminal capture are retained */ }
      }
      await shell?.close()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => { if (error) reject(error); else resolve() }))
    }
  }, testCeiling(60_000))
})
