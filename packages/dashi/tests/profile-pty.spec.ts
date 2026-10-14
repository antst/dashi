import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { Terminal as HeadlessTerminal } from '@xterm/headless'
import { describe, expect, it, vi } from 'vitest'
import { MultiplexerPane, type MultiplexerKind } from './multiplexer.js'
import { connectTestObserver, startTestDaemon } from './sessionbus-harness.js'
import { testCeiling } from './test-budget.js'
import { assertActiveRuntime, type RuntimeRecord } from './runtime-record.js'
import { countAudibleBells } from './terminal-output.js'
import { currentRecordedJsonl, recordedSession } from './fixtures/session-format.js'
import { turnWorking } from '../src/turn-working.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  root,
  dsh,
  dashiLauncher,
  failureFixture,
  replayFixture,
  inlineScrollFixture,
  threeTurnFixture,
  rollerFixture,
  contextInjectionFixture,
  btwChildFixture,
  openTurnFixture,
  noUploadsFixture,
  pluginManagementFixture,
  replayPatch,
  cleanReplayPatch,
  sessionListPatch,
  fakeEditor,
  mcpStderrPatch,
  testedDshVersion,
  separateEscapeKeysMs,
  hermeticGitEnv,
  testDir,
  home,
  hardeningCwd,
  hardeningHome,
  pluginHome,
  pluginSandboxHome,
  mcpHome,
  presetHome,
  reportPerformance,
  run,
  quote,
  packWorkspacePackage,
  PtyShell,
  waitForIdleAfter,
  waitForTerminalMode,
  relevantTerminalMode,
  parsedFrame,
  firstFrame,
  resizedFrame,
  prepareShell,
  launch,
  sessionId,
  waitForOtherSession,
  createNamedSession,
  expectResumable,
  findSessionFile,
  sessionEvents,
  sessionLog,
  listedSessions,
  replayText,
  replayTool,
  replayStreamingList,
  sessionbusReplay,
  waitForDashiPeer,
  chunkStormSnapshot,
  presenterFailureSnapshot,
  generateLargeSession,
  expectRestored,
  setupProfileFixtures,
} from './profile-pty-harness.js'

setupProfileFixtures()

describe.sequential('shipped profile terminal lifecycle', () => {
  it('shows native request, chunks, pending tool and retry facts, pulses, then clears at turn end', async ({ onTestFailed }) => {
    // Published keyless replay adapter, scripted override; real DSH loop/tools/retry records, not a model recording.
    const started = performance.now()
    const gate = join(testDir, 'w143-tool-release')
    const patch = join(testDir, 'w143-replay.patch.yml')
    writeFileSync(patch, readFileSync(replayPatch, 'utf8').replace('            name: Replay',
      '            name: Replay\n            retryPolicy:\n              mode: normal\n              maxRetries: 1\n              retryableCodes: [TIMEOUT]\n              backoff: {initialDelayMs: 1000, maxDelayMs: 1000, jitterRatio: 0}'))
    const shell = new PtyShell(replayFixture, undefined, root, {
      // Phase pacing; the real pulse proof covers the whole open turn, not its first-chunk window.
      DSH_WORKING_PROOF: gate, DSH_REPLAY_PACE_MS: '750',
      DSH_SNAPSHOT_OVERRIDE: join(root, 'packages/dashi/tests/fixtures/working-row.override.json'),
    })
    let stage = 'first session header'
    const stages: [string, number][] = [[stage, performance.now() - started]]
    let lastRows = '(no decoded frame yet)'
    let start = 0
    const row = (text: string) => text.split('\n').find(line => /^[·•●] /u.test(line))
    const shapes = new Set<string>()
    onTestFailed(async () => {
      const elapsed = performance.now() - started
      const failedStage = stage
      try { lastRows = (await parsedFrame(shell.output.slice(start))).text }
      catch { lastRows += '\n(last frame could not be decoded)' }
      process.stderr.write(`W143 native failure: waiting for ${failedStage} at ${elapsed.toFixed(0)} ms\n`
        + `elapsed stages: ${JSON.stringify(stages)}\nlast decoded rows:\n${lastRows}\n`)
    })
    const mark = (name: string): void => { stage = name; stages.push([name, performance.now() - started]) }
    const wait = async (name: string, check: (frame: Awaited<ReturnType<typeof parsedFrame>>) => void, interval?: number): Promise<void> => {
      mark(name)
      await vi.waitFor(async () => {
        const frame = await parsedFrame(shell.output.slice(start))
        lastRows = frame.text
        const line = row(frame.text)
        if (line !== undefined) shapes.add(line[0]!)
        try { check(frame) }
        catch (error) { throw new Error(`Waiting for ${name}\nlast decoded rows:\n${lastRows}`, { cause: error }) }
      }, { timeout: testCeiling(20_000), ...(interval === undefined ? {} : { interval }) })
    }
    let id = ''
    try {
      start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(patch)} --fullscreen`)
      id = sessionId(shell.output, start)
      await wait('first idle frame', frame => { expect(frame.status).toContain('idle ·') })
      shell.write('W143 exercise working facts\r')
      await wait('Retry wait', frame => {
        expect(row(frame.text)).toMatch(/Retry wait · \d+s · turn \d+s · retry 1/u)
      })
      await wait('Waiting for model', frame => {
        const line = row(frame.text)
        expect(line).toMatch(/Waiting for model · \d+s · turn \d+s · retry 1/u)
      }, 20)
      for (const phase of ['Reasoning', 'Receiving text', 'Tool request']) await wait(phase, frame => {
        expect(row(frame.text)).toContain(phase)
      }, 20)
      await wait('Tool pending dashi_working_hold', frame => {
        expect(row(frame.text)).toMatch(/Tool pending · \d+s · turn \d+s · dashi_working_hold/u)
      })
      writeFileSync(gate, 'release after observed native pending call\n')
      await wait('native completed text, idle frame and working row absent', frame => {
        expect(frame.text).toContain('W143_NATIVE_COMPLETE')
        expect(frame.status).toContain('idle ·')
        expect(row(frame.text)).toBeUndefined()
      })
      mark('two pulse shapes observed while the native turn was open')
      expect(shapes.size).toBeGreaterThanOrEqual(2)
      const exitAt = shell.output.length
      shell.write('\u0004\u0004')
      mark('alternate screen released after ordinary exit')
      await shell.waitFor('\u001B[?1049l', exitAt)
    } finally {
      await shell.close()
      if (process.env.DSH_WORKING_CAPTURE !== undefined) writeFileSync(process.env.DSH_WORKING_CAPTURE, shell.output)
    }
    mark('native call, result, retry and completed-turn records')
    const events = sessionLog(id).events as unknown as SessionEvent[]
    if (process.env.DSH_WORKING_CAPTURE !== undefined) writeFileSync(`${process.env.DSH_WORKING_CAPTURE}.events.json`, JSON.stringify(events, null, 2))
    const retries = events.filter(event => String(event.type) === 'llm/retry' || String(event.type) === 'llm/retry-started')
    expect(retries.map(event => (event.data as unknown as { retry: number }).retry)).toEqual([1, 1])
    for (const [index, event] of retries.entries()) {
      const view = turnWorking(events.slice(0, events.indexOf(event) + 1))
      expect(view?.phase).toBe(index === 0 ? 'Retry wait' : 'Retrying')
      expect(view?.tail).toBe('retry 1')
    }
    expect(events.some(event => event.type === 'tool/call' && event.data.name === 'dashi_working_hold')).toBe(true)
    expect(events.some(event => event.type === 'tool/result' && JSON.stringify(event.data).includes('W143_NATIVE_TOOL_RESULT'))).toBe(true)
    expect(events.some(event => event.type === 'turn/end' && event.data.reason.kind === 'completed')).toBe(true)
    expect(turnWorking(events)).toBeUndefined()
    process.stdout.write(`performance: native-working-stages ${JSON.stringify(stages)}\n`)
    reportPerformance('native-working-row', performance.now() - started, 'ms')
  }, 60_000)

  it('lists unowned jobs and keeps human output reads separate from the native model cursor', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const id = sessionId(shell.output, start)
      shell.write('/dashi-unowned-job-proof\r')
      await vi.waitFor(async () => {
        const frame = await parsedFrame(shell.output.slice(start))
        expect(frame.status).toContain('Ctrl+B activity')
        expect(frame.transcript).not.toContain('Job ·')
      }, { timeout: testCeiling(20_000) })
      for (let read = 0; read < 2; read++) {
        shell.write('/tasks\r')
        await vi.waitFor(async () => {
          expect((await parsedFrame(shell.output.slice(start))).overlay)
            .toMatch(/Job · bash-1 · \d+s · completed · W114 unowned output/u)
        }, { timeout: testCeiling(20_000) })
        shell.write('\r')
        await vi.waitFor(async () => {
          expect((await parsedFrame(shell.output.slice(start))).overlay).toContain('W114_OUTPUT_STILL_UNCONSUMED')
        }, { timeout: testCeiling(20_000) })
        shell.write('\u001B')
        await vi.waitFor(async () => {
          expect((await parsedFrame(shell.output.slice(start))).status).toContain('idle · Ctrl+B activity · Enter send')
        }, { timeout: testCeiling(20_000) })
      }
      shell.write('/dashi-unowned-job-proof consume\r')
      await vi.waitFor(() => {
        const records = sessionEvents(id).filter(event => event.type === 'command/done'
          && String(event.data?.text).includes('W114_RESULT_STILL_UNCONSUMED'))
        expect(records).toHaveLength(1)
        const read = JSON.parse(String(records[0]?.data?.text)) as {
          result: string; chunks: Array<{ text: string }>; job: { owner?: string }
        }
        expect(read.result).toBe('W114_RESULT_STILL_UNCONSUMED')
        expect(read.chunks.map(chunk => chunk.text)).toEqual(['W114_OUTPUT_STILL_UNCONSUMED'])
        expect(read.job.owner).toBeUndefined()
      }, { timeout: testCeiling(20_000) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, testCeiling(60_000))

  it('boots scoped subagent shadowing and preserves native model-selection settings in fresh roots', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, { DSH_HOME: presetHome })
    const proof = async (id: string, count: number): Promise<Record<string, unknown>> => {
      let result: Record<string, unknown> = {}
      await vi.waitFor(() => {
        const done = sessionEvents(id, presetHome).filter(event => event.type === 'command/done')
        expect(done).toHaveLength(count)
        expect(done.at(-1)?.data?.kind, String(done.at(-1)?.data?.text)).toBe('success')
        result = JSON.parse(String(done.at(-1)?.data?.text)) as Record<string, unknown>
      }, { timeout: testCeiling(20_000) })
      return result
    }
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const first = sessionId(shell.output, start)
      shell.write('/dashi-preset-proof\r')
      const defaults = await proof(first, 1)
      expect(defaults).toMatchObject({
        preset: 'standard', scopedShadowsHost: true,
        settings: { enabled: false, allowedModels: [] }, selectionParameters: [], listModels: false, policy: [],
      })
      expect(defaults.rows).toEqual([
        '@deepseek-ai/dsh-tool-ask-user', '@deepseek-ai/dsh-tool-present',
        '@deepseek-ai/dsh-tool-ralph', '@deepseek-ai/dsh-time-context', '@deepseek-ai/dsh-tool-subagent',
      ])
      shell.write('/dashi-preset-proof enable\r')
      expect(await proof(first, 2)).toMatchObject({
        scopedShadowsHost: true, settings: { enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }] },
        selectionParameters: [], listModels: false, policy: [],
      })
      expect(readFileSync(join(presetHome, 'profiles', 'dashi', 'cordis.patch.yml'), 'utf8'))
        .toContain('deepseek-flash')
      const nextAt = shell.output.length
      shell.write('/new\r')
      const next = await waitForOtherSession(shell, first, nextAt)
      shell.write('/dashi-preset-proof\r')
      expect(await proof(next, 1)).toMatchObject({
        preset: 'standard', scopedShadowsHost: true,
        selectionParameters: ['provider', 'model', 'reasoning_effort'], listModels: true,
        policy: [{ allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }] }],
      })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, testCeiling(60_000))

  it('shows inherited MCP server stderr in the active terminal', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, { DSH_HOME: mcpHome })
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --patch ${quote(mcpStderrPatch)} --fullscreen`)
      await shell.waitFor('W057_MCP_STDERR_LIVE', start)
      expect(await firstFrame(shell.output.slice(start))).toContain('W057_MCP_STDERR_LIVE')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('shows the configured model and git repo/branch in the persistent status line', async () => {
    const workspace = join(testDir, 'status-workspace')
    mkdirSync(workspace)
    run('git', ['init', '--initial-branch=status-proof'], { ...process.env, ...hermeticGitEnv }, workspace)
    const shell = new PtyShell(threeTurnFixture, undefined, workspace)
    try {
      shell.resize(200, 24)
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      await shell.waitFor('deepseek-flash', start)
      await shell.waitFor('status-workspace/status-proof', start)
      run('git', ['branch', '-m', 'status-after-turn'], { ...process.env, ...hermeticGitEnv }, workspace)
      const turnAt = shell.output.length
      shell.write('refresh status branch\r')
      await shell.waitFor('First turn complete.', turnAt)
      await shell.waitFor('status-workspace/status-after-turn', turnAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

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

  it('boots the same credential-guidance frame through the dashi launcher', async () => {
    const direct = new PtyShell(replayFixture, undefined, root, { DEEPSEEK_API_KEY: undefined })
    let id = ''
    let expected = ''
    try {
      const start = await launch(direct, `${quote(dsh)} --profile dashi`)
      id = sessionId(direct.output, start)
      await vi.waitFor(async () => {
        const frame = await parsedFrame(direct.output.slice(start))
        expect(frame.transcript, frame.text).toContain('credential DEEPSEEK_API_KEY is not configured')
        expect(frame.status, frame.text).toContain('idle ·')
        expected = frame.text
      }, { timeout: testCeiling(20_000), interval: 20 })
      const releasedAt = direct.output.length
      direct.write('\u0004\u0004')
      await direct.waitFor('Resume with:', releasedAt)
    } finally {
      await direct.close()
    }

    const viaLauncher = new PtyShell(replayFixture, undefined, root, {
      DEEPSEEK_API_KEY: undefined,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(viaLauncher,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --resume ${quote(id)}`)
      let actual = ''
      await vi.waitFor(async () => {
        const frame = await parsedFrame(viaLauncher.output.slice(start))
        expect(frame.transcript, frame.text).toContain('credential DEEPSEEK_API_KEY is not configured')
        expect(frame.status, frame.text).toContain('idle ·')
        actual = frame.text
      }, { timeout: testCeiling(20_000), interval: 20 })
      expect(actual).toBe(expected)
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
    const missingSessionbusRuntime = join(testDir, 'missing-sessionbus-runtime')
    const missingSessionbusSocket = join(missingSessionbusRuntime, 'sessionbus', 'presence.sock')
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: pluginHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      SESSIONBUS_LAUNCH_TOKEN: undefined,
      SESSIONBUS_SOCKET: undefined,
      XDG_RUNTIME_DIR: missingSessionbusRuntime,
    })
    const launcher = `${quote(process.execPath)} ${quote(dashiLauncher)}`
    try {
      let start = shell.output.length
      shell.write(`${launcher} --help; printf '__W034_HELP_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('__W034_HELP_EXIT__0', start)
      expect(shell.output.slice(start)).toContain(`dashi ${JSON.parse(readFileSync(join(root, 'packages', 'dashi', 'package.json'), 'utf8')).version as string} on DSH ${testedDshVersion}`)
      expect(shell.output.slice(start)).toContain('Launch flags:')
      expect(shell.output.slice(start)).toContain('--permission PRESET')
      start = shell.output.length
      shell.write(`${launcher} --version; printf '__W034_VERSION_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('__W034_VERSION_EXIT__0', start)
      expect(shell.output.slice(start).replaceAll('\r\n', '\n').replaceAll('\r', '\n'))
        .toContain(`\n${testedDshVersion}\n`)

      start = await launch(shell, `${launcher} --patch ${quote(replayPatch)} --fullscreen --yolo`)
      shell.write('/plugins\r')
      for (const row of [
        'include:dashi · @antst/dashi · enabled · active',
        'include:sessionbus · @sessionbus/dsh · enabled · active',
        'include:roller · @antst/roller · enabled · active',
      ]) {
        await shell.waitFor(row, start)
      }
      expect(shell.output.slice(start)).toContain('enabled')
      expect(shell.output.slice(start)).toContain('active')
      // The session-controller row is above /plugins' materialized viewport; the live prompt proves it active.
      shell.write('sessionbus no-daemon proof\r')
      const completedAt = await shell.waitFor('DASHI_TOOL_ROUND_TRIP complete.', start)
      await shell.waitFor('idle ·', completedAt)

      const addAt = shell.output.length
      shell.write(`/plugin add ${quote(archive)}\r`)
      await shell.waitFor('bundles load on the next launch; plain plugins need a patch row', addAt)
      const profileManifest = JSON.parse(readFileSync(join(pluginHome, 'profiles', 'dashi', 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
      }
      expect(profileManifest.dependencies?.['@antst/dashi-plugin-management-fixture']).toContain('.tgz')

      const missingAt = shell.output.length
      shell.write('/plugin add @antst/dashi-w034-package-does-not-exist\r')
      await shell.waitFor('[exit 1]', missingAt)
      expect(shell.output.slice(missingAt)).toContain('@antst/dashi-w034-package-does-not-exist')
      expect(shell.output.slice(missingAt)).toContain('[exit 1]')
      const diagnostics = [...shell.output.slice(start).matchAll(/sessionbus: ([^\r\n]*)/gu)]
        .map(match => match[1] ?? '')
      const connectionFailures = diagnostics.filter(line => line.includes(missingSessionbusSocket))
      expect(connectionFailures.length).toBeGreaterThan(0)
      expect(connectionFailures.every(line => line.startsWith('connect ENOENT '))).toBe(true)
      // Bound retries during this 60-second case so a reconnect hot loop fails visibly.
      expect(connectionFailures.length).toBeLessThan(20)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

  it('invokes the Sessionbus skill with slash-command prompt text', async () => {
    const daemon = await startTestDaemon()
    const snapshot = sessionbusReplay('sessionbus-slash', [replayText(1, 1, 'slash ok')])
    const shell = new PtyShell(snapshot, undefined, root, {
      SESSIONBUS_GROUPS: '["w101-slash"]',
      SESSIONBUS_LAUNCH_TOKEN: undefined,
      SESSIONBUS_SOCKET: daemon.socket,
    })
    shell.resize(180, 40)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      const submittedAt = shell.output.length
      shell.write('/sessionbus reply with exactly: slash ok\r')
      await vi.waitFor(() => {
        expect(sessionEvents(id).some(event => event.type.startsWith('assistant/')
          && JSON.stringify(event.data).includes('slash ok'))).toBe(true)
      }, { timeout: testCeiling(20_000), interval: 20 })
      await shell.waitFor('idle ·', submittedAt)
      expect((await parsedFrame(shell.output.slice(start), 180, 40)).transcript).toContain('</skill_content>')
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
      await daemon.close()
    }
    expect(sessionEvents(id).some(event => event.type === 'user/message'
      && JSON.stringify(event.data?.source).includes('skill-invocation')
      && JSON.stringify(event.data).includes('sessionbus'))).toBe(true)
  }, 60_000)

  it('wakes an idle dashi peer and replies to its Sessionbus observer without a keypress', async () => {
    const daemon = await startTestDaemon()
    const group = 'w101-idle'
    const observer = await connectTestObserver(daemon.socket, group, 'W101 idle observer')
    const observerId = (await observer.list()).self_info?.session_id
    if (observerId === undefined) throw new Error('Sessionbus observer omitted self_info')
    const snapshot = sessionbusReplay('sessionbus-idle', [
      replayTool(1, 1, 'idle-send', 'send', { target: observerId, message: 'pong' }),
      replayText(1, 2, 'Idle peer turn complete.'),
    ])
    const shell = new PtyShell(snapshot, undefined, root, {
      SESSIONBUS_GROUPS: JSON.stringify([group]),
      SESSIONBUS_LAUNCH_TOKEN: undefined,
      SESSIONBUS_SOCKET: daemon.socket,
    })
    shell.resize(180, 40)
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      await shell.waitFor('idle ·', start)
      const dashiPeer = await waitForDashiPeer(observer)
      const sent = await observer.send({
        target: dashiPeer.session_id,
        message: 'reply over the bus with exactly: pong',
      })
      expect(sent.deliveries).toMatchObject([{ target: dashiPeer.session_id, disposition: 'injected' }])
      expect((await observer.waitForMessage('pong')).body).toBe('pong')
      await waitForIdleAfter(shell, 'Idle peer turn complete.', start)
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start), 180, 40)).transcript)
          .toContain('<cross-session-message from="W101 idle observer@w101"')
      }, { timeout: testCeiling(20_000), interval: 20 })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
      await observer.close()
      await daemon.close()
    }
  }, 60_000)

  it('admits a Sessionbus message during a running turn at the next step boundary', async () => {
    const daemon = await startTestDaemon()
    const group = 'w101-running'
    const observer = await connectTestObserver(daemon.socket, group, 'W101 running observer')
    const observerId = (await observer.list()).self_info?.session_id
    if (observerId === undefined) throw new Error('Sessionbus observer omitted self_info')
    const snapshot = sessionbusReplay('sessionbus-running', [
      replayStreamingList(1, 1),
      replayTool(1, 2, 'running-send', 'send', { target: observerId, message: 'active pong' }),
      replayText(1, 3, 'Active boundary complete.'),
    ])
    const shell = new PtyShell(snapshot, undefined, root, {
      DSH_REPLAY_PACE_MS: '100',
      SESSIONBUS_GROUPS: JSON.stringify([group]),
      SESSIONBUS_LAUNCH_TOKEN: undefined,
      SESSIONBUS_SOCKET: daemon.socket,
    })
    shell.resize(180, 40)
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      await shell.waitFor('idle ·', start)
      const dashiPeer = await waitForDashiPeer(observer)
      shell.write('start the active turn\r')
      await shell.waitFor('ACTIVE_STREAM_MARKER', start)
      const sent = await observer.send({ target: dashiPeer.session_id, message: 'active boundary message' })
      expect(sent.deliveries).toMatchObject([{ target: dashiPeer.session_id, disposition: 'injected' }])
      expect((await observer.waitForMessage('active pong')).body).toBe('active pong')
      await waitForIdleAfter(shell, 'Active boundary complete.', start)
      const events = sessionEvents(sessionId(shell.output, start))
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      const injectedIndex = events.findIndex(event => event.type === 'user/message'
        && JSON.stringify(event.data).includes('active boundary message'))
      expect(injectedIndex).toBeGreaterThan(0)
      const boundary = events.slice(0, injectedIndex).reverse().find(event => event.type === 'step/start')
      expect(boundary?.data).toMatchObject({ turn: 1 })
      expect(Number(boundary?.data?.step)).toBeGreaterThan(1)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
      await observer.close()
      await daemon.close()
    }
  }, 60_000)

  it('renders human input and a Sessionbus sender envelope as distinct transcript cells', async () => {
    const daemon = await startTestDaemon()
    const group = 'w101-visual'
    const observer = await connectTestObserver(daemon.socket, group, 'W101 visual observer')
    const snapshot = sessionbusReplay('sessionbus-visual', [
      replayText(1, 1, 'Human path complete.'),
      replayText(2, 1, 'Peer path complete.'),
    ])
    const shell = new PtyShell(snapshot, undefined, root, {
      SESSIONBUS_GROUPS: JSON.stringify([group]),
      SESSIONBUS_LAUNCH_TOKEN: undefined,
      SESSIONBUS_SOCKET: daemon.socket,
    })
    shell.resize(200, 50)
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      await shell.waitFor('idle ·', start)
      const dashiPeer = await waitForDashiPeer(observer)
      shell.write('human visual marker\r')
      await waitForIdleAfter(shell, 'Human path complete.', start)
      await observer.send({ target: dashiPeer.session_id, message: 'peer visual marker' })
      await waitForIdleAfter(shell, 'Peer path complete.', start)
      await vi.waitFor(async () => {
        const transcript = (await parsedFrame(shell.output.slice(start), 200, 50)).transcript
        expect(transcript).toMatch(/You\s*\n\s*human visual marker/u)
        expect(transcript).toContain('Context · <cross-session-message from="W101 visual observer@w101"')
        expect(transcript).toContain('peer visual marker')
      }, { timeout: testCeiling(20_000), interval: 20 })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
      await observer.close()
      await daemon.close()
    }
  }, 60_000)

  it('completes /plugin verbs and binaries from the running profile', async () => {
    const bin = join(pluginHome, 'profiles', 'dashi', 'node_modules', '.bin')
    mkdirSync(bin, { recursive: true })
    const binary = join(bin, 'w060-fixture-bin')
    writeFileSync(binary, '#!/bin/sh\n')
    chmodSync(binary, 0o755)
    const shell = new PtyShell(replayFixture, undefined, root, { DSH_HOME: pluginHome })
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('/plugin ex')
      await shell.waitFor('› 1 exec', start)
      const tabAt = shell.output.length
      shell.write('\t')
      await shell.waitFor('/plugin exec', tabAt)
      shell.write('\t')
      await shell.waitFor('w060-fixture-bin', tabAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      shell.write('\u0003')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('/plugin changes the profile outside the default session sandbox', async () => {
    const archives = join(testDir, 'plugin-sandbox-archives')
    mkdirSync(archives)
    const archive = packWorkspacePackage(pluginManagementFixture, archives)
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: pluginSandboxHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`)
      shell.write(`/plugin add ${quote(archive)}\r`)
      await shell.waitFor('bundles load on the next launch; plain plugins need a patch row', start)
      const manifest = JSON.parse(readFileSync(
        join(pluginSandboxHome, 'profiles', 'dashi', 'package.json'), 'utf8',
      )) as { dependencies?: Record<string, string> }
      expect(manifest.dependencies?.['@antst/dashi-plugin-management-fixture']).toContain('.tgz')
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
      await shell.waitFor('subagent-model-selection-settings', readAt)
      await shell.waitFor('base:', readAt)
      await shell.waitFor('user: {}', readAt)
      let configText = ''
      await vi.waitFor(() => {
        configText = sessionEvents(sessionId(shell.output, 0)).filter(event => event.type === 'command/done')
          .map(event => String(event.data?.text)).at(-1) ?? ''
        expect(configText.split('\n')[0]).toBe(join(home, 'profiles', 'dashi', 'cordis.patch.yml'))
      }, { timeout: testCeiling(20_000), interval: 20 })
      const documentPath = configText.split('\n')[0] ?? ''
      const namespace = configText.split('\n').find(line => line.endsWith('subagent-model-selection-settings')) ?? ''
      expect(documentPath).toBe(join(home, 'profiles', 'dashi', 'cordis.patch.yml'))
      expect(namespace).not.toBe('')

      const updateAt = shell.output.length
      shell.write(`/config ${namespace} enabled=true\r`)
      await vi.waitFor(() => {
        expect(sessionEvents(sessionId(shell.output, 0)).filter(event => event.type === 'command/done')
          .map(event => event.data).at(-1)).toMatchObject({
          kind: 'success', text: `updated ${namespace}.enabled`,
        })
      }, { timeout: testCeiling(20_000), interval: 20 })
      await shell.waitFor(`updated ${namespace}.enabled`, updateAt)
      expect(readFileSync(documentPath, 'utf8')).toContain('enabled: true')

      const changedAt = shell.output.length
      shell.write('/config\r')
      await vi.waitFor(() => {
        const config = sessionEvents(sessionId(shell.output, 0)).filter(event => event.type === 'command/done')
          .map(event => String(event.data?.text)).at(-1)
        expect(config).toContain('user: {"enabled":true}')
      }, { timeout: testCeiling(20_000), interval: 20 })
      await shell.waitFor('subagent-model-selection-settings', changedAt)
      // Restore the native default before later tests create roots in this shared fixture.
      const restoreAt = shell.output.length
      shell.write(`/config ${namespace} enabled=false\r`)
      await shell.waitFor(`updated ${namespace}.enabled`, restoreAt)
      await vi.waitFor(() => {
        expect(readFileSync(documentPath, 'utf8')).toContain('enabled: false')
      }, { timeout: testCeiling(20_000), interval: 20 })
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
      await shell.waitFor('https://example.invalid/login', start)
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
    const original = recordedSession(file)
    writeFileSync(file, currentRecordedJsonl(contextInjectionFixture, original.header))

    const resumed = new PtyShell()
    try {
      const start = await launch(resumed,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}`)
      await resumed.waitFor('idle ·', start)
      const transcript = (await parsedFrame(resumed.output.slice(start))).transcript
      const context = transcript.indexOf('Context · instructions · Workspace instructions · 18 lines')
      const prompt = transcript.indexOf('VISIBLE_CONTEXT_PROMPT')
      expect(context).toBeGreaterThanOrEqual(0)
      expect(prompt).toBeGreaterThan(context)
      expect(transcript).not.toContain('CONTEXT_BODY_18')
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
      expect(realpathSync(result.file)).toBe(realpathSync(instruction))
      expect(relevantTerminalMode(result.terminalMode)).toBe(relevantTerminalMode(baseline))
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
      await shell.waitFor('created', createdAt)
      expect(existsSync(instruction)).toBe(true)
      const content = readFileSync(instruction, 'utf8')
      expect(content).toBe('# init-workspace\n\n## Working agreement\n\n- Add project-specific architecture guidance.\n- Add required build, test, and lint commands.\n- Add repository conventions and constraints.\n')

      const refusedAt = shell.output.length
      shell.write('/init\r')
      await shell.waitFor('cannot overwrite existing', refusedAt)
      await shell.waitFor('without reading it first', refusedAt)
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
      await waitForIdleAfter(next, 'First turn complete.', promptAt)
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
      await waitForIdleAfter(shell, 'First turn complete.', turnAt)
      turnAt = shell.output.length
      shell.write('second copy turn\r')
      await waitForIdleAfter(shell, 'Second turn complete.', turnAt)
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
    run('git', ['init', '-q'], { ...process.env, ...hermeticGitEnv }, workspace)
    writeFileSync(tracked, 'W038_BEFORE\n')
    run('git', ['add', 'tracked.txt'], { ...process.env, ...hermeticGitEnv }, workspace)
    run('git', ['-c', 'user.name=dashi', '-c', 'user.email=dashi@example.invalid',
      'commit', '-qm', 'fixture'], { ...process.env, ...hermeticGitEnv }, workspace)
    writeFileSync(tracked, 'W038_AFTER\n')
    const shell = new PtyShell(rollerFixture, undefined, workspace)
    try {
      shell.resize(100, 40)
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write('record a turn diff\r')
      await waitForIdleAfter(shell, 'Roller turn one complete.', start)

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
      await shell.waitFor('Last completed turn diff', openedAt)
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
      const armedAt = all.output.length
      all.write('\u0004')
      await all.waitFor('Ctrl+C or Ctrl+D again to exit', armedAt)
      all.write('\u0004')
      await all.waitFor('\u001B[?1049l', armedAt)
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

  it('installs packed packages with published DSH and runs the daily flow through the launcher', async () => {
    const cleanRoot = mkdtempSync(join(testDir, 'clean-install-'))
    const archives = join(cleanRoot, 'archives')
    const prefix = join(cleanRoot, 'prefix')
    const cleanHome = join(cleanRoot, 'home')
    mkdirSync(archives)
    mkdirSync(prefix)
    const noUploadsArchive = packWorkspacePackage(join(root, 'packages', 'file-uploads-none'), archives)
    const pluginArchive = packWorkspacePackage(join(root, 'packages', 'dashi'), archives)
    const appArchive = packWorkspacePackage(join(root, 'packages', 'dashi-app'), archives)
    const launcherArchive = packWorkspacePackage(join(root, 'packages', 'dashi-launcher'), archives)
    expect([noUploadsArchive, pluginArchive, appArchive, launcherArchive].every(existsSync)).toBe(true)

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
    run('pnpm', ['install', `@deepseek-ai/dsh@${testedDshVersion}`, launcherArchive], process.env, prefix)
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
      `  '@antst/dashi-app>@antst/dsh-file-uploads-none': 'file:${noUploadsArchive}'`,
      `  '@antst/dashi-app>@antst/dashi': 'file:${pluginArchive}'`,
      '',
    ].join('\n'))
    run(cleanDsh, ['plugin', '--profile', 'dashi', 'add', appArchive], cleanEnv)
    run('pnpm', ['add', '--save-exact', `@deepseek-ai/dsh-llm-replay@${testedDshVersion}`], cleanEnv, profile)
    const workspaceVersion = (JSON.parse(readFileSync(
      join(root, 'packages', 'dashi', 'package.json'), 'utf8',
    )) as { version: string }).version
    // The package manager selects the launcher; DSH selects the active profile packages.
    const launcherManifest = createRequire(realpathSync(cleanLauncher)).resolve('@antst/dashi-launcher/package.json')
    expect(JSON.parse(readFileSync(launcherManifest, 'utf8')).version).toBe(workspaceVersion)

    for (const path of [manifestPath, workspacePath, join(profile, 'pnpm-lock.yaml')]) {
      const installed = readFileSync(path, 'utf8')
      expect(installed).not.toContain('link:')
      expect(installed).not.toContain(root)
    }

    const runtimePath = join(cleanRoot, 'runtime.json')
    const runtimePatch = join(cleanRoot, 'runtime.patch.yml')
    const observer = new URL('./fixtures/runtime-observer.mjs', import.meta.url).href
    writeFileSync(runtimePatch, `- insert:\n    - id: runtime-observer\n      name: '${observer}'\n`)
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: cleanHome,
      DASHI_RUNTIME_RECORD: runtimePath,
      PATH: `${join(prefix, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = await launch(shell, `${quote(cleanLauncher)} --patch ${quote(cleanReplayPatch)} --patch ${quote(runtimePatch)}`)
      await vi.waitFor(() => { expect(existsSync(runtimePath), shell.output.slice(-4000)).toBe(true) }, {
        timeout: testCeiling(20_000),
      })
      const runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as RuntimeRecord
      assertActiveRuntime(runtime, testedDshVersion, workspaceVersion)
      expect(runtime.packages['@antst/roller']?.version).toBe('0.1.4')
      for (const pkg of Object.values(runtime.packages)) expect(pkg.dir).not.toContain(root)
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
      shell.write('\u001B[A')
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
    } finally {
      await shell.close()
    }
  }, 180_000)

  it('boots without web uploads and relays the unstaged-file error', async () => {
    const shell = new PtyShell(noUploadsFixture)
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const id = sessionId(shell.output, start)
      shell.write('prove the no-upload profile boots\r')
      const idleAt = await shell.waitFor('Queued turn complete.', start)
      await shell.waitFor('idle ·', idleAt)
      shell.resize(120, 60)
      shell.write('/plugins\r')
      await shell.waitFor('file-uploads-none · @antst/dsh-file-uploads-none · enabled · active', start)
      await vi.waitFor(() => {
        const events = sessionEvents(id)
        const commandId = events.find(event => event.type === 'command/run'
          && event.data?.name === 'plugins')?.data?.commandId
        expect(events.some(event => event.type === 'command/done'
          && event.data?.commandId === commandId)).toBe(true)
      }, { timeout: testCeiling(20_000), interval: 20 })
      const fileAt = shell.output.length
      shell.write('/dashi-file-fixture\r')
      await shell.waitFor('session/attachment-invalid: FILE_NOT_STAGED', fileAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('Resume with:', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

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
        ...process.env, ...hermeticGitEnv, DSH_HOME: hardeningHome, DSH_SNAPSHOT_FILE: replayFixture,
        DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', PROMPT_COMMAND: '', PS1: '',
      })
      try {
        pane.send(`stty -a > ${quote(pane.modeBefore)}; ${quote(dsh)} --profile dashi --patch ${quote(replayPatch)}; code=$?; stty -a > ${quote(pane.modeAfter)}; printf '__MUX_EXIT__%s\\n' "$code"\r`)
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
        ...process.env, ...hermeticGitEnv, DSH_HOME: hardeningHome, DSH_SNAPSHOT_FILE: threeTurnFixture,
        DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', PROMPT_COMMAND: '', PS1: '',
      })
      try {
        pane.send(`stty -a > ${quote(pane.modeBefore)}; ${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}; code=$?; stty -a > ${quote(pane.modeAfter)}; printf '__MUX_EXIT__%s\\n' "$code"\r`)
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
      await shell.waitFor('running ·', turnAt)
      await shell.waitFor('STORM_START', start)
      const narrowAt = shell.output.length - start
      shell.resize(48, 12)
      await vi.waitFor(async () => {
        expect((await resizedFrame(shell.output.slice(start), [
          { at: narrowAt, columns: 48, rows: 12 },
        ])).transcript).toContain('STORM_MIDDLE')
      }, { timeout: testCeiling(20_000), interval: 20 })
      const wideAt = shell.output.length - start
      shell.resize(100, 30)
      let frame = await resizedFrame(shell.output.slice(start), [
        { at: narrowAt, columns: 48, rows: 12 },
        { at: wideAt, columns: 100, rows: 30 },
      ])
      await vi.waitFor(async () => {
        frame = await resizedFrame(shell.output.slice(start), [
          { at: narrowAt, columns: 48, rows: 12 },
          { at: wideAt, columns: 100, rows: 30 },
        ])
        expect(frame.transcript).toContain('STORM_END')
        expect(frame.status, frame.text).toContain('idle ·')
      }, { timeout: testCeiling(20_000), interval: 20 })
      expect(frame.text).not.toContain('\uFFFD')
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
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay).toContain('Approval · bash')
      }, { timeout: testCeiling(20_000), interval: 20 })
      const narrowAt = shell.output.length - start
      shell.resize(48, 12)
      await vi.waitFor(async () => {
        const overlay = (await resizedFrame(shell.output.slice(start), [
          { at: narrowAt, columns: 48, rows: 12 },
        ])).overlay
        expect(overlay).toContain('Approval · bash')
        expect(overlay).toContain('Allow once')
      }, { timeout: testCeiling(20_000), interval: 20 })
      const wideAt = shell.output.length - start
      shell.resize(100, 30)
      let frame = await resizedFrame(shell.output.slice(start), [
        { at: narrowAt, columns: 48, rows: 12 },
        { at: wideAt, columns: 100, rows: 30 },
      ])
      await vi.waitFor(async () => {
        frame = await resizedFrame(shell.output.slice(start), [
          { at: narrowAt, columns: 48, rows: 12 },
          { at: wideAt, columns: 100, rows: 30 },
        ])
        expect(frame.overlay).toContain('Approval · bash')
        expect(frame.overlay).toContain('Allow once')
      }, { timeout: testCeiling(20_000), interval: 20 })
      expect(frame.text).not.toContain('\uFFFD')
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
    expect(generateLargeSession(id, 30, 0)).toEqual({ events: 182, toolCells: 0 })

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
    expect(realpathSync(String(sessionLog(first).header.cwd))).toBe(realpathSync(firstCwd))
    expect(realpathSync(String(sessionLog(second).header.cwd))).toBe(realpathSync(firstCwd))
    expect(realpathSync(String(sessionLog(other).header.cwd))).toBe(realpathSync(otherCwd))
    expect(sessionLog(first).header.id).toBe(first)
    expect(sessionLog(second).header.id).toBe(second)
    expect(sessionLog(other).header.id).toBe(other)

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
      for (const [sessionId, title, cwd] of [
        [first, 'List first', firstCwd],
        [second, 'List second', firstCwd],
        [other, 'List other', otherCwd],
      ] as const) {
        const item = envelope.sessions.find(session => session.sessionId === sessionId)
        expect(item).toMatchObject({ sessionId, title })
        expect(realpathSync(String(item?.cwd))).toBe(realpathSync(cwd))
      }
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
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output)).status).not.toContain('Ctrl+C or Ctrl+D again to exit')
      }, { timeout: testCeiling(5_000), interval: 20 })
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

  it('arms Ctrl+D during a running turn before exiting on the second press', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, { DSH_REPLAY_PACE_MS: '500' })
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'keep running'`)
      await shell.waitFor('Inspecting the recorded request.', start)
      const armedAt = shell.output.length
      shell.write('\u0004')
      await shell.waitFor('Ctrl+C or Ctrl+D again to exit', armedAt)
      expect(() => { process.kill(shell.childPid(), 0) }).not.toThrow()
      const releasedAt = shell.output.length
      shell.write('\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await shell.waitFor('Resume with:', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('resumes an idle session with an open trailing turn', async () => {
    const cwd = join(testDir, `open-turn-${String(Date.now())}`)
    mkdirSync(cwd)
    const parent = 'session-00000000-0000-0000-0000-000000000690'
    const seed = new PtyShell(replayFixture, undefined, cwd)
    try {
      const seededAt = await launch(seed,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --session-id ${parent}`,
        'idle ·')
      seed.write('\u0004\u0004')
      await seed.waitFor('\u001B[?1049l', seededAt)
    } finally {
      await seed.close()
    }
    writeFileSync(findSessionFile(join(home, 'replay-sessions'), parent),
      currentRecordedJsonl(openTurnFixture, { id: parent, cwd, createdAt: Date.now() }))

    const shell = new PtyShell(btwChildFixture, undefined, cwd, {
      DSH_SNAPSHOT_CHILD_FILES: replayFixture,
    })
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${parent}`,
        'idle ·')
      expect(await firstFrame(shell.output.slice(start))).toContain('idle · Enter send')
      let overlayAt = shell.output.length
      shell.write('/history\r')
      await shell.waitFor('History', overlayAt)
      await vi.waitFor(async () => {
        const history = (await parsedFrame(shell.output.slice(start))).overlay
        expect(history).toContain('open prompt')
        expect(history).not.toContain('outcome · interrupted')
        expect(history).not.toMatch(/[\u2800-\u28ff]/u)
      }, { timeout: testCeiling(20_000), interval: 20 })
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)

      overlayAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('trailing turn open; completed boundaries only', overlayAt)
      const rewindClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', rewindClosedAt)
      overlayAt = shell.output.length
      shell.write('/diff turn\r')
      await shell.waitFor('Last completed turn diff · trailing turn open', overlayAt)
      const diffClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', diffClosedAt)
      overlayAt = shell.output.length
      shell.write('/btw use the stable boundary\r')
      await shell.waitFor('Btw · turn 1 · trailing turn open', overlayAt)
      const btwClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', btwClosedAt)
      const promptAt = shell.output.length
      shell.write('fresh prompt after open tail\r')
      await shell.waitFor('Approval · bash', promptAt)
      shell.write('\r')
      await waitForIdleAfter(shell, 'Recorded answer: DASHI_TOOL_ROUND_TRIP complete.', promptAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const rows = listedSessions(cwd)
    const child = rows.map(row => ({ id: row.sessionId, log: sessionLog(row.sessionId) }))
      .find(item => item.log.header.parentSession === parent)
    expect(child, JSON.stringify(rows)).toBeDefined()
    const humanMessages = child?.log.events.filter(event => event.type === 'user/message'
      && (event.data?.source as { kind?: string } | undefined)?.kind === 'user') ?? []
    expect(JSON.stringify(humanMessages)).not.toContain('open prompt')
    expect(JSON.stringify(humanMessages)).toContain('use the stable boundary')
    expect(JSON.stringify(child?.log.events)).toContain('BTW_SIDE_ANSWER')
  }, testCeiling(90_000))

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
  }, testCeiling(30_000))

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
      shell.write(`/bin/sh -c 'printf "close stdin\\r"; printf "%s" "$$" > "$1"; exec tail -f /dev/null' _ ${quote(writerPidFile)} | ${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen; printf '__DECISION_EOF__%s\\n' "$?"\n`)
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

  it.each([false, true])('restores after native SIGTERM with a held-flush fault armed=%s', async armed => {
    const evidence = join(root, '.cache', 'w137-forced-exit', `${process.pid}-${Date.now()}-${armed}`)
    mkdirSync(evidence, { recursive: true })
    const receiptPath = join(evidence, 'native-exit.json')
    const patch = join(evidence, 'fixture.patch.yml')
    const fixture = new URL('./fixtures/held-flush.mjs', import.meta.url).href
    writeFileSync(patch, `- insert:\n    - id: held-flush-fixture\n      name: '${fixture}'\n`)
    const { baseline, shell } = await prepareShell({
      DSH_DASHI_HELD_FLUSH_RECEIPT: receiptPath,
      DEEPSEEK_API_KEY: undefined,
      SESSIONBUS_LAUNCH_TOKEN: undefined,
      SESSIONBUS_GROUPS: undefined,
      SESSIONBUS_SOCKET: join(evidence, 'absent.sock'),
    })
    let passed = false
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(patch)} --fullscreen`)
      await shell.waitFor('idle ·', start)
      if (armed) {
        const armingAt = shell.output.length
        shell.write('/dashi-arm-held-flush\r')
        await shell.waitFor('W137_FLUSH_ARMED', armingAt)
        await shell.waitFor('W137_FLUSH_ENTERED', armingAt)
        await vi.waitFor(async () => {
          expect((await parsedFrame(shell.output)).status).toContain('idle ·')
        }, { timeout: testCeiling(20_000) })
      }
      const pid = shell.childPid()
      const signalledAt = shell.output.length
      process.kill(pid, 'SIGTERM')
      await vi.waitFor(() => {
        expect(existsSync(receiptPath)).toBe(true)
        expect(() => { process.kill(pid, 0) }).toThrow()
      }, { timeout: testCeiling(20_000), interval: 20 })
      const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as {
        pid: number; code: number; signalledAt: number; exitedAt: number;
        armedSession?: string; flushEnteredAt?: number; heldAt?: number;
        held: boolean; maintenanceError?: string; stack: string;
      }
      expect(receipt.pid).toBe(pid)
      expect(receipt.code).toBe(0)
      expect(receipt.signalledAt).toBeTypeOf('number')
      if (armed) {
        expect(receipt.armedSession).toBe(sessionId(shell.output, start))
        expect(receipt.maintenanceError).toBeUndefined()
        expect(receipt.flushEnteredAt).toBeTypeOf('number')
        expect(receipt.flushEnteredAt).toBeLessThanOrEqual(receipt.signalledAt)
        expect(receipt.held).toBe(true)
        expect(receipt.heldAt).toBeTypeOf('number')
        expect(receipt.heldAt).toBeGreaterThanOrEqual(receipt.signalledAt)
        expect(receipt.heldAt).toBeLessThan(receipt.exitedAt)
        expect(shell.output.slice(signalledAt)).toContain('W137_FLUSH_HELD')
        expect(receipt.stack).toContain('Timeout.')
        expect(receipt.stack).toContain('profile-boot-')
        expect(receipt.stack).toContain('forceExitOnce')
      } else {
        expect(receipt.held).toBe(false)
        expect(receipt.stack).not.toContain('Timeout.')
      }
      const terminal = new HeadlessTerminal({ allowProposedApi: true, cols: 80, rows: 24 })
      await new Promise<void>(resolveWrite => { terminal.write(shell.output, resolveWrite) })
      const buffer = terminal.buffer.active.type
      const restoredAt = shell.output.length
      shell.write("printf '__MODE_AFTER__\\n'; stty -a | tr '\\n' ' '; printf '\\n__SHELL_OK__\\n'\n")
      const restored = await waitForTerminalMode(shell, '__MODE_AFTER__', restoredAt)
      await shell.waitFor('__SHELL_OK__', restoredAt)
      writeFileSync(join(evidence, 'terminal.txt'), shell.output)
      writeFileSync(join(evidence, 'observed.json'), JSON.stringify({
        armed, pid, buffer, baseline: relevantTerminalMode(baseline), restored: relevantTerminalMode(restored),
        alternateScreenLeave: shell.output.slice(signalledAt).includes('\u001B[?1049l'),
        signalToExitMs: receipt.exitedAt - receipt.signalledAt,
      }, null, 2) + '\n')
      expect(buffer).toBe('normal')
      expect(shell.output.slice(signalledAt)).toContain('\u001B[?1049l')
      expect(relevantTerminalMode(restored)).toBe(relevantTerminalMode(baseline))
      passed = true
    } finally {
      await shell.close()
      if (passed) rmSync(evidence, { recursive: true, force: true })
    }
  }, testCeiling(30_000))

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
      await shell.waitFor(`Resume with: start dashi again with --resume ${id}`, releasedAt)
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

  it('starts resumed tool cards expanded only with --verbose', async () => {
    const seed = new PtyShell()
    let id = ''
    try {
      const start = await launch(seed,
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen 'seed verbose mode'`)
      id = sessionId(seed.output, start)
      await seed.waitFor('Approval · bash', start)
      seed.write('\r')
      await waitForIdleAfter(seed, 'DASHI_TOOL_ROUND_TRIP complete.', start)
      const releasedAt = seed.output.length
      seed.write('\u0004\u0004')
      await seed.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await seed.close()
    }

    for (const [flag, expanded] of [['', false], [' --verbose', true]] as const) {
      const resumed = new PtyShell()
      try {
        const start = await launch(resumed,
          `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen${flag} --resume ${quote(id)}`)
        await resumed.waitFor('idle ·', start)
        const frame = await firstFrame(resumed.output.slice(start))
        expect(/^  DASHI_TOOL_ROUND_TRIP$/mu.test(frame)).toBe(expanded)
        expect(frame).toContain(`cards ${expanded ? 'expanded' : 'collapsed'}`)
        if (expanded) {
          const toggledAt = resumed.output.length
          resumed.write('\u000f')
          await resumed.waitFor('cards hidden', toggledAt)
        }
        const releasedAt = resumed.output.length
        resumed.write('\u0004\u0004')
        await resumed.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await resumed.close()
      }
    }
  }, 90_000)
})
