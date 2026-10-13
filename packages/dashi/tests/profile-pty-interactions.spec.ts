import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { historicalSessionFormatCatalog } from '@deepseek-ai/dsh-session-format-catalog'
import { describe, expect, it, vi } from 'vitest'
import { testCeiling } from './test-budget.js'
import { countAudibleBells } from './terminal-output.js'
import { currentRecordedJsonl, recordedSession } from './fixtures/session-format.js'
import {
  root,
  dsh,
  dashiLauncher,
  replayFixture,
  threeTurnFixture,
  rewindSteerFixture,
  headerlessTurnFixture,
  rollerFixture,
  questionFixture,
  presentationFixture,
  tasksFixture,
  presentationChildFixture,
  requestContextFixture,
  longTurnFixture,
  btwChildFixture,
  recapChildFixture,
  replayPatch,
  modelCatalogPatch,
  fakeEditor,
  customPresetPatch,
  png,
  separateEscapeKeysMs,
  testDir,
  home,
  hardeningHome,
  launchFlagsHome,
  overlayHome,
  rewindDefaultHome,
  reportPerformance,
  quote,
  PtyShell,
  waitForIdleAfter,
  relevantTerminalMode,
  type ParsedFrame,
  parsedFrame,
  firstFrame,
  prepareShell,
  launch,
  sessionId,
  waitForOtherSession,
  waitForFile,
  createNamedSession,
  expectResumable,
  findSessionFile,
  sessionEvents,
  sessionLog,
  listedSessions,
  clipboardHelper,
  chunkStormSnapshot,
  tallModelCatalogPatch,
  generateLargeSession,
  expectRestored,
  setupProfileFixtures,
} from './profile-pty-harness.js'

setupProfileFixtures()

describe.sequential('shipped profile terminal lifecycle', () => {

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
      await waitForIdleAfter(shell, 'DASHI_TOOL_ROUND_TRIP complete.', start)

      const pickerAt = shell.output.length
      shell.write('/model\r')
      await shell.waitFor('Model', pickerAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })

      const secondAt = shell.output.length
      shell.write('second inline prompt\r')
      await waitForIdleAfter(shell, 'Queued turn complete.', secondAt)
      const rewindAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('Rewind to a prompt', rewindAt)
      shell.write('\u001B[A')
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

  it('recalls an injected shell command immediately in the shipped profile', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`)
      const commandAt = shell.output.length
      shell.write('!printf hi\r')
      await shell.waitFor('[exit 0]', commandAt)
      const recallAt = shell.output.length
      shell.write('\u001B[A')
      await shell.waitFor('\u001B[22;1H\u001B[2K !printf hi', recallAt)
      expect(await firstFrame(shell.output.slice(start))).toContain('!printf hi')
      shell.write('\u0003\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', recallAt)
    } finally {
      await shell.close()
    }
  }, 60_000)

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
      && JSON.stringify(event.data).includes('"kind":"plugin:dashi"'))
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
      await vi.waitFor(async () => {
        const transcript = (await parsedFrame(shell.output.slice(start))).transcript
        expect(transcript).toContain('◆ /dashi-slow-fixture')
        expect(transcript).not.toContain('running /dashi-slow-fixture')
      }, { timeout: testCeiling(20_000), interval: 20 })
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
    const skillFile = join(skill, 'SKILL.md')
    const preStepEvents = join(testDir, 'workspace-skill-pre-step.jsonl')
    mkdirSync(join(workspace, '.git'), { recursive: true })
    mkdirSync(skill, { recursive: true })
    writeFileSync(skillFile, [
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
    const canonicalSkillFile = realpathSync(skillFile)
    const columns = Math.max(240, canonicalSkillFile.length + 140)
    shell.resize(columns, 30)
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/skills\r')
      await shell.waitFor('/workspace-proof', start)
      await shell.waitFor('user yes · model yes · source project-dsh · provider filesystem · path ', start)
      await shell.waitFor(canonicalSkillFile, start)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const filteredAt = shell.output.length
      shell.write('/skills project skill discovery\r')
      await shell.waitFor('/workspace-proof', filteredAt)
      await vi.waitFor(async () => {
        const filtered = (await parsedFrame(shell.output.slice(filteredAt), columns, 30)).overlay
        expect(filtered).toContain('/workspace-proof')
        expect(filtered).not.toContain('/dashi-fixture-skill')
      }, { timeout: testCeiling(20_000), interval: 20 })
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
    expect(preStep).toContain('/workspace-proof use the fixture')
    // Base now owns the outer skill middleware; this inner fixture hook sees
    // the user input before that middleware injects the final native message.
    const invoked = events.find(event => event.type === 'user/message'
      && (event.data?.source as { kind?: unknown } | undefined)?.kind === 'skill-invocation')
    expect(invoked?.data?.source).toMatchObject({ kind: 'skill-invocation', name: 'workspace-proof', form: 'instructions' })
    expect(JSON.stringify(invoked?.data)).toContain('"name":"workspace-proof"')
    expect(JSON.stringify(invoked?.data)).toContain('WORKSPACE_SKILL_BODY')
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

  it('/clear NAME preserves the previous root under that title', async () => {
    const shell = new PtyShell()
    let previous = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      previous = sessionId(shell.output, start)
      const clearAt = shell.output.length
      shell.write('/clear W052 archived root\r')
      await waitForOtherSession(shell, previous, clearAt)
      const resumeAt = shell.output.length
      shell.write('/resume\r')
      await shell.waitFor('W052 archived root', resumeAt)
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(previous).some(event => event.type === 'session/title'
      && event.data?.title === 'W052 archived root')).toBe(true)
  }, 30_000)

  it('/agents selects declared presets and names the removed authoring API without writing files', async () => {
    const profilePatch = join(hardeningHome, 'profiles', 'dashi', 'cordis.patch.yml')
    const before = readFileSync(profilePatch, 'utf8')
    const { baseline, shell } = await prepareShell({ DSH_HOME: hardeningHome })
    let id = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --patch ${quote(customPresetPatch)} --fullscreen`)
      id = sessionId(shell.output, start)
      for (const args of ['copy standard w052-copy', 'new w052-new', 'delete w052-new']) {
        shell.write(`/agents ${args}\r`)
        await vi.waitFor(async () => {
          expect((await parsedFrame(shell.output.slice(start))).transcript)
            .toContain('DSH has no preset authoring API')
          expect(sessionEvents(id, hardeningHome).filter(event => event.type === 'command/done'
            && event.data?.kind === 'error').length).toBeGreaterThan(0)
        }, { timeout: testCeiling(20_000) })
        await vi.waitFor(async () => {
          const frame = await parsedFrame(shell.output.slice(start))
          expect(frame.transcript).toContain('presets in profile configuration.')
          expect(sessionEvents(id, hardeningHome).filter(event => event.type === 'command/done'
            && event.data?.kind === 'error')).toHaveLength(['copy standard w052-copy', 'new w052-new', 'delete w052-new'].indexOf(args) + 1)
        }, { timeout: testCeiling(20_000) })
        expect(readFileSync(profilePatch, 'utf8')).toBe(before)
        expect(existsSync(join(hardeningHome, '.agent-presets', 'w052-new'))).toBe(false)
      }
      shell.write('/agents\r')
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay).toContain('Custom terminal fixture')
      }, { timeout: testCeiling(20_000) })
      shell.write('\u001B[A')
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay).toContain('› 1 Custom terminal fixture')
      }, { timeout: testCeiling(20_000) })
      shell.write('\r')
      await vi.waitFor(async () => {
        expect(sessionEvents(id, hardeningHome).some(event => event.type === 'agent-preset/selected'
          && event.data?.agentPreset === 'custom')).toBe(true)
        expect((await parsedFrame(shell.output.slice(start))).status).toContain('idle · Enter send')
      }, { timeout: testCeiling(20_000) })
      expect(sessionId(shell.output, start)).toBe(id)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
      await expectRestored(shell, baseline)
    } finally {
      await shell.close()
    }
    const events = sessionEvents(id, hardeningHome)
    expect(events.filter(event => event.type === 'command/done' && event.data?.kind === 'error')).toHaveLength(3)
    expect(events.some(event => event.type === 'agent-preset/selected' && event.data?.agentPreset === 'custom')).toBe(true)
    expect(readFileSync(profilePatch, 'utf8')).toBe(before)
  }, 60_000)

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
      await waitForIdleAfter(shell, 'First turn complete.', turnAt)
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
        `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --provider deepseek-official --model deepseek-flash`)
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

  it('refuses a cold migration-required fork without rewriting the historical generation', async () => {
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
    const current = recordedSession(file)
    const [header, ...events] = readFileSync(threeTurnFixture, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const restore = historicalSessionFormatCatalog.createRestore(header, { recovery: 'strict', validation: 'current' })
    for (const event of events) restore.decodeRow(event)
    const historical = restore.finish()
    const encoded = `${[
      historicalSessionFormatCatalog.encodeCurrentHeader({
        ...historical.header, id, createdAt: current.header.createdAt,
        ...(current.header.cwd === undefined ? {} : { cwd: current.header.cwd }),
      }, historical.inheritedEventCount),
      ...historical.events.map(event => historicalSessionFormatCatalog.encodeCurrentEvent(event)),
    ].map(row => JSON.stringify(row)).join('\n')}\n`
    expect(file.endsWith('session.v4.jsonl')).toBe(true)
    const historicalFile = join(dirname(file), 'session.v3.jsonl')
    writeFileSync(historicalFile, encoded)
    rmSync(file)

    const shell = new PtyShell()
    try {
      const start = shell.output.length
      shell.write(`${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)} --fork-session; printf '__MIGRATION_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('Open the source Session to complete migration before forking', start)
      await shell.waitFor('__MIGRATION_EXIT__1', start)
      expect(shell.output.slice(start)).toContain('startup failed')
      expect(shell.output.slice(start)).not.toContain('\u001B[?1049h')
      expect(readFileSync(historicalFile, 'utf8')).toBe(encoded)
      expect(existsSync(file)).toBe(false)
    } finally {
      await shell.close()
    }
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

  it('recalls the last /model line with Up', async () => {
    const shell = new PtyShell()
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      const pickerAt = shell.output.length
      shell.write('/model\r')
      await shell.waitFor('Model', pickerAt)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      const recalledAt = shell.output.length
      shell.write('\u001B[A')
      await shell.waitFor('/model', recalledAt)
      expect((await firstFrame(shell.output.slice(start))).split('\n')[21]).toContain('/model')
      const clearedAt = shell.output.length
      shell.write('\u0003')
      await shell.waitFor('\u001B[22;1H\u001B[2K', clearedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
  }, 30_000)

  it('keeps the selected row reachable in a model picker taller than the terminal', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, { DSH_HOME: overlayHome })
    shell.resize(100, 12)
    let id = ''
    try {
      const start = await launch(shell,
        `${quote(dsh)} --profile dashi --patch ${quote(tallModelCatalogPatch())} --fullscreen`)
      id = sessionId(shell.output, start)
      shell.write('/model\r')
      let picker = ''
      await vi.waitFor(async () => {
        picker = (await parsedFrame(shell.output.slice(start), 100, 12)).overlay
        // W-127 appends Add provider to this fixture's 60 native model rows.
        expect(picker).toContain('↓ 54 more')
        expect(picker).toContain('W054 provider · W054 row 00')
      }, { timeout: testCeiling(20_000), interval: 20 })
      expect(picker).not.toContain('W054 row 59')

      shell.write('\u001B[B'.repeat(59))
      await vi.waitFor(async () => {
        picker = (await parsedFrame(shell.output.slice(start), 100, 12)).overlay
        expect(picker).toContain('↑ 54 more')
        expect(picker).toContain('W054 provider · W054 row 59')
        expect(picker).toContain('Add provider')
      }, { timeout: testCeiling(20_000), interval: 20 })
      const selectedAt = shell.output.length
      shell.write('\r')
      await shell.waitFor('w054-59', selectedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }
    expect(sessionEvents(id, overlayHome).some(event => event.type === 'model/selection'
      && event.data?.model === 'w054-59' && event.data.provider === 'w054-provider')).toBe(true)
  }, testCeiling(30_000))

  it.each(['--yolo', '--dangerously-skip-permissions'])(
    'applies launch model, effort, and %s before the first prompt', async (dangerFlag) => {
      const shell = new PtyShell(replayFixture, undefined, root, {
        DSH_HOME: launchFlagsHome,
        PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
      })
      let id = ''
      try {
        const start = await launch(shell,
          `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --provider deepseek-official --model deepseek-flash --effort low ${dangerFlag} 'launch flags'`)
        id = sessionId(shell.output, start)
        await waitForIdleAfter(shell, 'DASHI_TOOL_ROUND_TRIP complete.', start)
        expect(shell.output.slice(start)).not.toContain('Approval · bash')
        shell.write('/status\r')
        await shell.waitFor('Model: deepseek-official/deepseek-flash', start)
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
        await waitForIdleAfter(shell, 'First turn complete.', start)
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
        await waitForIdleAfter(shell, 'First turn complete.', start)
        const releasedAt = shell.output.length
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', releasedAt)
      } finally {
        await shell.close()
      }
      const message = sessionEvents(id, launchFlagsHome).filter(event => event.type === 'system/message')
        .at(-1)?.data?.message as { content?: Array<{ type?: string; text?: string }> } | undefined
      const system = message?.content?.filter(block => block.type === 'text').map(block => block.text).join('')
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

  it('preserves the native refusal of an unavailable launch model', async () => {
    const shell = new PtyShell(replayFixture, undefined, root, {
      DSH_HOME: launchFlagsHome,
      PATH: `${join(root, 'node_modules', '.bin')}:${process.env.PATH ?? ''}`,
    })
    try {
      const start = shell.output.length
      shell.write(`${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --model w025-unlisted; printf '__UNAVAILABLE_MODEL_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('Select an available model before sending a message.', start)
      await shell.waitFor('__UNAVAILABLE_MODEL_EXIT__1', start)
      expect(shell.output.slice(start)).toContain('startup failed')
      expect(shell.output.slice(start)).not.toContain('\u001B[?1049h')
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
      await shell.waitFor('Select an available model before sending a message.', start)
      await shell.waitFor('__W025_PROVIDER_EXIT__1', start)
      expect(shell.output.slice(start)).toContain('startup failed')
      start = shell.output.length
      shell.write(`${launcher} --provider deepseek-official --model deepseek-flash --effort w025-missing; printf '__W025_EFFORT_EXIT__%s\\n' "$?"\n`)
      await shell.waitFor('provider "deepseek-official" model "deepseek-flash" does not support reasoning effort "w025-missing"', start)
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
      await waitForIdleAfter(shell, 'DASHI_TOOL_ROUND_TRIP complete.', start)
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
      shell.write('\u001B[A')
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
      shell.write('\u001B[A\u001B[A')
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

  it('rewinds to a durable shell input and prefills its typed form', async () => {
    const shell = new PtyShell(requestContextFixture)
    let parent = ''
    let child = ''
    try {
      const start = await launch(shell,
        `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen`)
      parent = sessionId(shell.output, start)
      const shellAt = shell.output.length
      shell.write('!printf DASHI_SHELL_OUTPUT\r')
      await shell.waitFor('[exit 0]', shellAt)
      shell.write('use the rewind shell result\r')
      const completedAt = await shell.waitFor('Observed injected output: DASHI_SHELL_OUTPUT', shellAt)
      await shell.waitFor('idle ·', completedAt)
      const rewindAt = shell.output.length
      shell.write('/rewind\r')
      await shell.waitFor('Rewind to a prompt', rewindAt)
      shell.write('\u001B[A\u001B[A')
      await shell.waitFor('› 1 !printf DASHI_SHELL_OUTPUT', rewindAt)
      shell.write('\r')
      await shell.waitFor('Restore conversation', rewindAt)
      const actionAt = shell.output.length
      shell.write('\u001B[B\r')
      child = await waitForOtherSession(shell, parent, actionAt)
      await shell.waitFor('\u001B[22;1H\u001B[2K !printf DASHI_SHELL_OUTPUT', actionAt)
      const frame = await firstFrame(shell.output.slice(start))
      expect(frame).toContain('!printf DASHI_SHELL_OUTPUT')
      const clearAt = shell.output.length
      shell.write('\u0003')
      await shell.waitFor('\u001B[22;1H\u001B[2K', clearAt)
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', clearAt)
    } finally {
      await shell.close()
    }
    expect(sessionLog(child).header.parentSession).toBeUndefined()
  }, 60_000)

  it('rewinds a headerless first prompt while using the DSH default model', async () => {
    for (const action of [0, 1]) {
      const workspace = join(testDir, `rewind-default-${action}`)
      mkdirSync(workspace)
      const parent = `session-00000000-0000-0000-0000-00000000064${action}`
      const seed = new PtyShell(rollerFixture, undefined, workspace, { DSH_HOME: rewindDefaultHome })
      try {
        const seededAt = await launch(seed,
          `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --session-id ${parent}`,
          'idle ·')
        seed.write('\u0004\u0004')
        await seed.waitFor('\u001B[?1049l', seededAt)
      } finally {
        await seed.close()
      }
      writeFileSync(findSessionFile(join(rewindDefaultHome, 'replay-sessions'), parent),
        currentRecordedJsonl(headerlessTurnFixture, { id: parent, cwd: workspace, createdAt: Date.now() }))

      const shell = new PtyShell(rollerFixture, undefined, workspace, { DSH_HOME: rewindDefaultHome })
      let child = ''
      try {
        const start = await launch(shell,
          `${quote(process.execPath)} ${quote(dashiLauncher)} --patch ${quote(replayPatch)} --fullscreen --resume ${parent}`,
          'idle ·')
        const sourceTypes = sessionEvents(parent, rewindDefaultHome).map(event => event.type)
        // The native migration preserves the recorded prompt's step/system markers.
        expect(sourceTypes.slice(0, 6)).toEqual([
          'turn/start', 'step/start', 'system/message', 'user/message', 'step/end', 'turn/end',
        ])
        expect(sourceTypes).not.toContain('request/header')
        expect(sourceTypes).not.toContain('model/selection')

        const rewindAt = shell.output.length
        shell.write('/rewind\r')
        await shell.waitFor('Rewind to a prompt', rewindAt)
        shell.write('\u001B[A\r')
        await shell.waitFor('Restore code and conversation', rewindAt)
        const actionAt = shell.output.length
        shell.write(`${'\u001B[B'.repeat(action)}\r`)
        child = await waitForOtherSession(shell, parent, actionAt)
        await vi.waitFor(async () => {
          const frame = await parsedFrame(shell.output.slice(start))
          expect(frame.composer).toContain('headerless default model prompt')
          expect(frame.transcript).not.toContain('the current session has no durable model selection')
        }, { timeout: testCeiling(20_000) })

        const clearAt = shell.output.length
        shell.write('\u0003')
        await vi.waitFor(async () => {
          expect((await parsedFrame(shell.output.slice(start))).composer.trim()).toBe('')
        }, { timeout: testCeiling(20_000) })
        shell.write('\u0004\u0004')
        await shell.waitFor('\u001B[?1049l', clearAt)
      } finally {
        await shell.close()
      }
      const events = sessionEvents(parent, rewindDefaultHome)
      const commandId = events.find(event => event.type === 'command/run'
        && event.data?.name === 'rewind')?.data?.commandId
      expect(commandId).toBeDefined()
      expect(events.find(event => event.type === 'command/done'
        && event.data?.commandId === commandId)?.data?.kind).toBe('success')
      expect(sessionLog(child, rewindDefaultHome).header.parentSession).toBeUndefined()
    }
  }, testCeiling(60_000))

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
          const completion = `Roller turn ${['one', 'two', 'three'][index]} complete.`
          await shell.waitFor(completion, turnAt)
          const completedAt = shell.output.indexOf(completion, turnAt) + completion.length
          await shell.waitFor('idle ·', completedAt)
        }
        expect(readFileSync(join(workspace, 'roller-e2e.txt'), 'utf8')).toBe(
          scenario.first ? 'turn one\n' : 'turn three\n')

        const rewindAt = shell.output.length
        shell.write('/rewind\r')
        await shell.waitFor('Rewind to a prompt', rewindAt)
        shell.write('\u001B[A')
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
      await waitForIdleAfter(shell, 'First turn complete.', turnAt)

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
      await waitForIdleAfter(shell, 'First turn complete.', turnAt)

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
      await waitForIdleAfter(shell, 'First turn complete.', turnAt)
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
      const screen = (): Promise<ParsedFrame> => parsedFrame(shell.output.slice(start))
      const listAt = shell.output.length
      shell.write('@\t')
      await shell.waitFor('Complete', listAt)
      await shell.waitFor('only-here.ts', listAt)
      expect(shell.output.slice(listAt)).not.toContain('outside-secret.ts')
      shell.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      shell.write('\u0003')
      await vi.waitFor(async () => {
        expect((await screen()).composer.trim()).toBe('')
      }, { timeout: testCeiling(20_000) })

      const attachAt = shell.output.length
      shell.write('@screens/shot\t')
      await shell.waitFor('screens/shot.png', attachAt)
      shell.write('\r')
      await vi.waitFor(async () => { expect((await screen()).attachments).toContain('[image 1]') }, {
        timeout: testCeiling(20_000),
      })
      shell.write('image selected through at')
      await vi.waitFor(async () => {
        const frame = await screen()
        expect(frame.attachments).toContain('[image 1]')
        expect(frame.composer).toContain('image selected through at')
      }, { timeout: testCeiling(20_000) })
      shell.write('\u0013')
      await vi.waitFor(async () => {
        const frame = await screen()
        expect(frame.attachments).not.toContain('[image 1]')
        expect(frame.composer).not.toContain('image selected through at')
      }, {
        timeout: testCeiling(20_000),
      })
      shell.write('stashed image draft')
      await vi.waitFor(async () => {
        const frame = await screen()
        expect(frame.composer).toContain('stashed image draft')
        expect(frame.attachments).not.toContain('[image 1]')
      }, {
        timeout: testCeiling(20_000),
      })
      const restoreAt = shell.output.length
      shell.write('\u0013')
      await vi.waitFor(async () => {
        const frame = await screen()
        expect(frame.attachments).toContain('[image 1]')
        expect(frame.composer).toContain('image selected through at')
        expect(frame.composer).not.toContain('stashed image draft')
      }, {
        timeout: testCeiling(20_000),
      })
      shell.write('\r')
      await shell.waitFor('Approval · bash', restoreAt)
      shell.write('\r')
      await waitForIdleAfter(shell, 'DASHI_TOOL_ROUND_TRIP complete.', restoreAt)
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
  }, testCeiling(60_000))

  it('turns a dropped image and text file into a draft attachment and @ reference', async () => {
    const workspace = join(testDir, 'drop-workspace')
    mkdirSync(workspace)
    writeFileSync(join(workspace, 'shot.png'), png)
    writeFileSync(join(workspace, 'notes.txt'), 'dropped notes\n')
    const shell = new PtyShell(replayFixture, undefined, workspace)
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      shell.write(`\u001B[200~${workspace}/shot.png ${workspace}/notes.txt\u001B[201~`)
      await shell.waitFor('shot.png · image/png', start)
      await vi.waitFor(async () => { expect(await firstFrame(shell.output.slice(start))).toContain('@notes.txt') }, {
        timeout: testCeiling(20_000),
      })
      shell.write('\u0003\u0004\u0004')
    } finally {
      await shell.close()
    }
  }, testCeiling(60_000))

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
      await waitForIdleAfter(shell, 'DASHI_TOOL_ROUND_TRIP complete.', start)
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
      await withoutHelper.waitFor(process.platform === 'darwin'
        ? 'Clipboard image paste needs pngpaste or osascript.'
        : 'Clipboard image paste needs wl-paste or xclip.', start)
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
      expect(relevantTerminalMode(result.terminalMode)).toBe(relevantTerminalMode(baseline))
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
      await shell.waitFor('Ctrl+B 1 agent', subagentAt)
      const subagentDone = await shell.waitFor('Subagent completion acknowledged.', subagentAt, 30_000)
      await shell.waitFor('idle ·', subagentDone)
      const detailsAt = shell.output.length
      shell.write('/tasks\r')
      await shell.waitFor('Activity', detailsAt)
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay)
          .toMatch(/Subagent · inactive · \d+s · research cause/u)
      }, { timeout: testCeiling(20_000) })
      shell.write('\r')
      await shell.waitFor('mode: continuable', detailsAt)
      await shell.waitFor('Find the bounded cause summary.', detailsAt)
      child = /Background subagent ([0-9a-f-]{36})/u.exec(shell.output.slice(subagentAt))?.[1] ?? ''
      expect(child).not.toBe('')
      const detailsClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', detailsClosedAt)

      const jobAt = shell.output.length
      shell.write('run a background job\r')
      await shell.waitFor('Ctrl+B 1 job', jobAt)
      const jobDone = await shell.waitFor('Job completion acknowledged.', jobAt, 30_000)
      await shell.waitFor('idle ·', jobDone)
      const jobListAt = shell.output.length
      shell.write('/tasks\r')
      await shell.waitFor('Activity', jobListAt)
      shell.write('\u001B[B')
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay)
          .toMatch(/› Job · completed · \d+s · sleep 0\.5; printf DASHI_JOB_DONE/u)
      }, { timeout: testCeiling(20_000) })
      shell.write('\r')
      await shell.waitFor('DASHI_JOB_DONE', jobListAt)
      const jobClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', jobClosedAt)

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
    expect(parentLog.events.some(event => (event.type === 'assistant/attempt' || event.type === 'assistant/message')
      && text(event).includes('CHILD_RESULT'))).toBe(false)
    expect(childLog.events.some(event => text(event).includes('CHILD_RESULT'))).toBe(true)
    expect(parentLog.events.some(event => event.type === 'user/message'
      && (event.data?.source as { kind?: unknown } | undefined)?.kind === 'tool-jobs')).toBe(true)
  }, 120_000)

  it('reads and kills jobs and starts a native child activation through DSH', async () => {
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
      await shell.waitFor('Ctrl+B 1 job', start)
      await shell.waitFor('idle ·', launched)

      const readAt = shell.output.length
      shell.write('/bashes\r')
      await shell.waitFor('Activity', readAt)
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay)
          .toMatch(/Job · running · \d+s · printf DASHI_JOB_OUTPUT; sleep 30/u)
      }, { timeout: testCeiling(20_000) })
      shell.write('\r')
      await shell.waitFor('DASHI_JOB_OUTPUT', readAt)
      shell.write('\u001B')
      await shell.waitFor('idle ·', shell.output.length - 1)

      const killAt = shell.output.length
      shell.write('/tasks kill bash-1\r')
      await shell.waitFor('stopping bash-1', killAt)
      shell.write('/tasks\r')
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay)
          .toMatch(/Job · killed · \d+s · printf DASHI_JOB_OUTPUT; sleep 30/u)
      }, { timeout: testCeiling(20_000) })
      const killClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', killClosedAt)

      const subtaskAt = shell.output.length
      shell.write('/subtask inspect W046 continuation\r')
      await shell.waitFor('subtask ', subtaskAt)
      await shell.waitFor(' started', subtaskAt)
      child = /subtask ([0-9a-f-]{36}) started/u.exec(shell.output.slice(subtaskAt))?.[1] ?? ''
      expect(child).not.toBe('')
      shell.write('/tasks\r')
      await vi.waitFor(async () => {
        expect((await parsedFrame(shell.output.slice(start))).overlay)
          .toMatch(/Subagent · (?:running|inactive|unknown) · (?:\d+s · )?inspect W046 continuation/u)
      }, { timeout: testCeiling(20_000) })
      await vi.waitFor(() => {
        expect(sessionEvents(child).some(event => event.type === 'user/message'
          && JSON.stringify(event.data).includes('inspect W046 continuation'))).toBe(true)
      }, { timeout: testCeiling(20_000), interval: 20 })
      const childClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', childClosedAt)
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

  it('creates, fires, reads native history, and stops loops through DSH Schedule', async () => {
    const measuredAt = performance.now()
    const shell = new PtyShell(threeTurnFixture)
    let id = ''
    let scheduleId = ''
    let barrierId = ''
    const proofTexts: string[] = []
    interface ScheduleProof {
      history: {
        id: string; code?: string;
        records?: Array<{ messageId: string; prompt: string; scheduledAt: string; deliveredAt: string }>;
      }
      catalog: Array<{ id: string; scheduledAt: string; status: string; sessionId: string }>
    }
    const proof = async (input: string): Promise<string> => {
      const count = sessionEvents(id).filter(event => event.type === 'command/run'
        && event.data?.name === 'dashi-schedule-proof').length
      shell.write(`/dashi-schedule-proof ${input}\r`)
      let text = ''
      await vi.waitFor(() => {
        const events = sessionEvents(id)
        const runs = events.filter(event => event.type === 'command/run'
          && event.data?.name === 'dashi-schedule-proof')
        expect(runs).toHaveLength(count + 1)
        expect(String(runs.at(-1)?.data?.args).trim()).toBe(input)
        const done = events.filter(event => event.type === 'command/done'
          && event.data?.commandId === runs.at(-1)?.data?.commandId)
        expect(done).toHaveLength(1)
        expect(done.at(-1)?.data?.kind, String(done.at(-1)?.data?.text)).toBe('success')
        text = String(done.at(-1)?.data?.text)
      }, { timeout: testCeiling(20_000) })
      proofTexts.push(text)
      return text
    }
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      id = sessionId(shell.output, start)

      const createAt = shell.output.length
      shell.write('/loop 1m check the release\r')
      await vi.waitFor(() => {
        const created = sessionEvents(id).find(event => event.type === 'command/done'
          && event.data?.kind === 'success' && String(event.data?.text).startsWith('scheduled '))
        scheduleId = /^scheduled (schedule-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}) · every 1m · check the release$/u
          .exec(String(created?.data?.text))?.[1] ?? ''
        expect(scheduleId).not.toBe('')
      }, { timeout: testCeiling(20_000), interval: 20 })
      await vi.waitFor(async () => {
        const transcript = (await parsedFrame(shell.output.slice(createAt))).transcript
        expect(transcript).toContain(`scheduled ${scheduleId} · every 1m · check the`)
        expect(transcript).toContain('release')
      }, { timeout: testCeiling(20_000), interval: 20 })

      const listAt = shell.output.length
      shell.write('/loop\r')
      await shell.waitFor(`${scheduleId} · every 1m · check the release`, listAt)

      const rejectedAt = shell.output.length
      shell.write('/loop 0m too frequent\r')
      await shell.waitFor('every_seconds must be at least 60.', rejectedAt)

      // Observe the real native minute, not a fake clock or substituted storage/driver.
      await vi.waitFor(() => {
        const ends = sessionEvents(id).filter(event => event.type === 'turn/end')
        expect(ends).toHaveLength(1)
        expect(ends[0]?.data?.reason).toEqual({ kind: 'completed' })
      }, { timeout: testCeiling(90_000) })
      const fired = sessionEvents(id).filter(event => event.type === 'user/message'
        && (event.data?.source as { kind?: string } | undefined)?.kind === 'schedule')
      expect(fired).toHaveLength(1)
      expect(JSON.stringify(fired[0]?.data?.content)).toContain(scheduleId)
      expect(JSON.stringify(fired[0]?.data?.content)).toContain('check the release')
      const beforeStop = JSON.parse(await proof(scheduleId)) as ScheduleProof
      expect(beforeStop.history.id).toBe(scheduleId)
      expect(beforeStop.history.records).toHaveLength(1)
      expect(beforeStop.history.records?.[0]).toMatchObject({
        messageId: fired[0]?.data?.id, prompt: 'check the release',
      })
      const receipt = beforeStop.history.records?.[0]
      expect(Date.parse(receipt?.deliveredAt ?? '')).toBeGreaterThanOrEqual(Date.parse(receipt?.scheduledAt ?? ''))
      expect(beforeStop.catalog).toEqual([expect.objectContaining({
        id: scheduleId, sessionId: id, status: 'active',
      })])
      expect(Date.parse(beforeStop.catalog[0]?.scheduledAt ?? '') - Date.parse(receipt?.scheduledAt ?? '')).toBe(60_000)

      const stopAt = shell.output.length
      shell.write(`/loop stop ${scheduleId}\r`)
      await shell.waitFor(`stopped ${scheduleId}`, stopAt)

      const emptyAt = shell.output.length
      shell.write('/loop\r')
      await shell.waitFor('no active schedules', emptyAt)
      expect(JSON.parse(await proof(scheduleId))).toEqual({
        history: { id: scheduleId, code: 'schedule_not_found' }, catalog: [],
      })

      // A native one-shot is the positive boundary: after another full minute,
      // a deleted recurring reminder must still have produced only its first turn.
      const barrier = JSON.parse(await proof('barrier')) as { id: string; kind: string; scheduledAt: string }
      barrierId = barrier.id
      expect(barrierId).toMatch(/^schedule-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u)
      expect(barrier.kind).toBe('after')
      expect(Date.parse(barrier.scheduledAt)).toBeGreaterThanOrEqual(Date.parse(receipt?.scheduledAt ?? '') + 60_000)
      await vi.waitFor(() => {
        const ends = sessionEvents(id).filter(event => event.type === 'turn/end')
        expect(ends).toHaveLength(2)
        expect(ends.map(event => event.data?.reason)).toEqual([{ kind: 'completed' }, { kind: 'completed' }])
      }, { timeout: testCeiling(90_000) })
      const delivered = sessionEvents(id).filter(event => event.type === 'user/message'
        && (event.data?.source as { kind?: string } | undefined)?.kind === 'schedule')
      expect(delivered).toHaveLength(2)
      expect(delivered.filter(event => JSON.stringify(event.data?.content).includes(scheduleId))).toHaveLength(1)
      expect(JSON.stringify(delivered[1]?.data?.content)).toContain(barrierId)
      expect(JSON.stringify(delivered[1]?.data?.content)).toContain('W114 deletion barrier')
      const barrierStopAt = shell.output.length
      shell.write(`/loop stop ${barrierId}\r`)
      await shell.waitFor(`stopped ${barrierId}`, barrierStopAt)
      const finalListAt = shell.output.length
      shell.write('/loop\r')
      await shell.waitFor('no active schedules', finalListAt)
      expect(JSON.parse(await proof(scheduleId))).toEqual({
        history: { id: scheduleId, code: 'schedule_not_found' }, catalog: [],
      })
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const events = sessionEvents(id)
    expect(events.filter(event => event.type === 'command/run'
      && event.data?.name === 'loop')).toHaveLength(7)
    // Alpha.2 persists schedule changes in native storage, not the session event log.
    expect(events.filter(event => event.type === 'command/done').map(event => event.data)).toEqual([
      expect.objectContaining({ kind: 'success', text: `scheduled ${scheduleId} · every 1m · check the release` }),
      expect.objectContaining({ kind: 'success', text: `${scheduleId} · every 1m · check the release` }),
      expect.objectContaining({ kind: 'error', text: 'every_seconds must be at least 60.' }),
      expect.objectContaining({ kind: 'success', text: proofTexts[0] }),
      expect.objectContaining({ kind: 'success', text: `stopped ${scheduleId}` }),
      expect.objectContaining({ kind: 'success', text: 'no active schedules' }),
      expect.objectContaining({ kind: 'success', text: proofTexts[1] }),
      expect.objectContaining({ kind: 'success', text: proofTexts[2] }),
      expect.objectContaining({ kind: 'success', text: `stopped ${barrierId}` }),
      expect.objectContaining({ kind: 'success', text: 'no active schedules' }),
      expect.objectContaining({ kind: 'success', text: proofTexts[3] }),
    ])
    console.log(`performance: native-loop-fire-delete-barrier ${(performance.now() - measuredAt).toFixed(2)} ms`)
  }, testCeiling(220_000))

  it('/btw and /recap answer in titled forks without changing the main conversation', async () => {
    const cwd = join(testDir, `btw-${String(Date.now())}`)
    mkdirSync(cwd)
    const shell = new PtyShell(threeTurnFixture, undefined, cwd, {
      DSH_SNAPSHOT_CHILD_FILES: [btwChildFixture, recapChildFixture].join(delimiter),
    })
    let parent = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      parent = sessionId(shell.output, start)
      shell.write('establish the main conversation\r')
      const completedAt = await shell.waitFor('First turn complete.', start)
      await shell.waitFor('idle ·', completedAt)

      const btwAt = shell.output.length
      shell.write('/btw why is this isolated\r')
      await shell.waitFor('Btw · turn 1', btwAt)
      await shell.waitFor('BTW_SIDE_ANSWER', btwAt)
      const closedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', closedAt)

      const recapAt = shell.output.length
      shell.write('/recap\r')
      await shell.waitFor('Btw · turn 1', recapAt)
      await shell.waitFor('RECAP_SIDE_ANSWER', recapAt)
      const recapClosedAt = shell.output.length
      shell.write('\u001B')
      await shell.waitFor('idle ·', recapClosedAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const main = sessionLog(parent)
    const firstEnd = main.events.findIndex(event => event.type === 'turn/end')
    expect(main.events.slice(firstEnd + 1).map(event => event.type)).toEqual([
      'command/run', 'command/done', 'command/run', 'command/done',
    ])
    expect(main.events.filter(event => event.type === 'command/run').map(event => event.data))
      .toEqual([{ commandId: expect.any(String), name: 'btw', source: { kind: 'user' } },
        { commandId: expect.any(String), name: 'recap', source: { kind: 'user' } }])

    const rows = listedSessions(cwd)
    const cases = [
      ['btw · why is this isolated', 'why is this isolated'],
      ['btw · Summarize this conversation so far in', 'Summarize this conversation so far in ten lines: goal, decisions, open items.'],
    ] as const
    const children = rows.map(row => ({ id: row.sessionId, log: sessionLog(row.sessionId) }))
      .filter(child => child.log.header.parentSession === parent)
    for (const [title, prompt] of cases) {
      const child = children.find(item => item.log.events.filter(event => event.type === 'session/title')
        .at(-1)?.data?.title === title)
      expect(child, JSON.stringify(rows)).toBeDefined()
      const id = child?.id ?? ''
      expect(rows.map(row => row.sessionId)).toContain(id)
      const log = child?.log ?? sessionLog(id)
      expect(log.header.parentSession).toBe(parent)
      const suffix = log.events.slice(log.events.findIndex(event => event.type === 'session/end-seed') + 1)
      expect(suffix.filter(event => event.type === 'user/message')).toHaveLength(1)
      expect(JSON.stringify(suffix)).toContain(prompt)
      expect(JSON.stringify(suffix)).toContain(prompt.startsWith('Summarize') ? 'RECAP_SIDE_ANSWER' : 'BTW_SIDE_ANSWER')
    }
  }, 90_000)

  it('/btw refuses a running root without changing its conversation', async () => {
    const cwd = join(testDir, `btw-running-${String(Date.now())}`)
    mkdirSync(cwd)
    const shell = new PtyShell(threeTurnFixture, undefined, cwd, {
      DSH_REPLAY_PACE_MS: '300', DSH_SNAPSHOT_CHILD_FILES: btwChildFixture,
    })
    let parent = ''
    try {
      const start = await launch(shell, `${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen`)
      parent = sessionId(shell.output, start)
      shell.write('completed boundary\r')
      const completedAt = await shell.waitFor('First turn complete.', start)
      await shell.waitFor('idle ·', completedAt)
      const runningAt = shell.output.length
      shell.write('open source turn\r')
      await shell.waitFor('running ·', runningAt)
      shell.write('/btw inspect the stable boundary\r')
      await shell.waitFor('finish or interrupt the turn first', runningAt)
      await waitForIdleAfter(shell, 'Second turn complete.', runningAt)
      const releasedAt = shell.output.length
      shell.write('\u0004\u0004')
      await shell.waitFor('\u001B[?1049l', releasedAt)
    } finally {
      await shell.close()
    }

    const rows = listedSessions(cwd)
    expect(rows.map(row => row.sessionId)).toContain(parent)
    expect(rows.filter(row => sessionLog(row.sessionId).header.parentSession === parent)).toHaveLength(0)
    const humanMessages = sessionLog(parent).events.filter(event => event.type === 'user/message'
      && (event.data?.source as { kind?: string } | undefined)?.kind === 'user')
    expect(humanMessages).toHaveLength(2)
    expect(JSON.stringify(humanMessages)).toContain('open source turn')
    expect(JSON.stringify(humanMessages)).not.toContain('inspect the stable boundary')
  }, 90_000)

  it('resumes a generated 50k-event session and pages older history on demand', async () => {
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
    // V4 needs a protected head, title, steps and advertisements: 2 + 8166*6 + 501*2 = 50k.
    const shape = generateLargeSession(id, 8_166, 501)
    expect(shape).toEqual({ events: 50_000, toolCells: 501 })

    const stormChunks = 400
    const resumed = new PtyShell(chunkStormSnapshot(stormChunks), undefined, root, { DSH_REPLAY_PACE_MS: '10' })
    try {
      const startedAt = performance.now()
      const start = resumed.output.length
      resumed.write(`${quote(dsh)} --profile dashi --patch ${quote(replayPatch)} --fullscreen --resume ${quote(id)}\n`)
      await resumed.waitFor('idle ·', start, 20_000)
      const resumeElapsed = performance.now() - startedAt
      reportPerformance('large-resume-first-view', resumeElapsed, 'ms')
      // rc.2 measured 11,879.11 ms at 50k events; gate bound 15,000 ms.
      expect(resumeElapsed).toBeLessThan(testCeiling(15_000))
      expect(resumed.output.slice(start)).toContain('large answer 8166')

      const pageAt = resumed.output.length
      resumed.write('\u001B[1;5H')
      await resumed.waitFor('large prompt 8117', pageAt, 20_000)

      resumed.write('\u001B[1;5F')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 100) })
      const copyAt = resumed.output.length
      resumed.write('/copy\r')
      const oscAt = await resumed.waitFor('\u001B]52;c;', copyAt)
      const payloadStart = oscAt + '\u001B]52;c;'.length
      const payloadEnd = resumed.output.indexOf('\u0007', payloadStart)
      expect(Buffer.from(resumed.output.slice(payloadStart, payloadEnd), 'base64').toString())
        .toBe('large answer 8166')

      const historyAt = resumed.output.length
      resumed.write('/history\r')
      await resumed.waitFor('History', historyAt)
      const closedAt = resumed.output.length
      resumed.write('\u001B')
      await new Promise(resolveDelay => { setTimeout(resolveDelay, separateEscapeKeysMs) })
      resumed.write('\u001B[1;5H')
      await resumed.waitFor('large prompt 8092', closedAt, 20_000)

      const streamingAt = resumed.output.length
      resumed.write('measure chunk storm\r')
      const runningAt = await resumed.waitFor('running ·', streamingAt)
      const firstFrame = resumed.frameTimes.length
      await resumed.waitFor('idle ·', runningAt + 1, 20_000)
      const streamingOutput = resumed.output.slice(streamingAt)
      // Exclude the immediate running/idle transition frames; this measures timer-driven streaming redraws.
      const frameTimes = resumed.frameTimes.slice(firstFrame, -1)
      const frames = frameTimes.length
      const frameSpan = (frameTimes.at(-1) ?? 0) - (frameTimes[0] ?? 0)
      const framesPerSecond = Math.max(0, frames - 1) / Math.max(frameSpan / 1_000, Number.EPSILON)
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
