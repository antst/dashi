import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import {
  agentPresetOverlay, completionOptions, contextOverlay, modelOverlay, permissionOverlay, sessionOverlay,
  sessionStatusLine,
} from '../src/catalogs.js'

function agent(): Agent {
  return { session: { header: { cwd: '/work' } } } as unknown as Agent
}

describe('terminal catalogs', () => {
  it('completes the fixed pnpm plugin vocabulary and leaves later arguments free', async () => {
    const ctx = {} as Context
    const options = await completionOptions(ctx, agent(), '/plugin ')
    expect(options.map(option => option.label)).toEqual([
      'add', 'remove', 'update', 'outdated', 'list', 'why', 'exec', 'licenses',
    ])
    expect((await completionOptions(ctx, agent(), '/plugin ex')).map(option => option.value)).toEqual([
      { kind: 'insert', text: '/plugin exec ' },
    ])
    await expect(completionOptions(ctx, agent(), '/plugin add package')).resolves.toEqual([])
  })

  it('rereads profile binaries and direct dependencies for plugin completion', async () => {
    const profile = mkdtempSync(join(tmpdir(), 'dashi-plugin-completion-'))
    try {
      const bin = join(profile, 'node_modules', '.bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, 'fixture-bin'), '')
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { '@antst/fixture': '1.0.0' } }))
      const ctx = { baseUrl: pathToFileURL(join(profile, 'agent.cordis.yml')).href } as Context
      expect((await completionOptions(ctx, agent(), '/plugin exec fix')).map(option => option.label)).toEqual(['fixture-bin'])
      for (const command of ['remove', 'update', 'why']) {
        expect((await completionOptions(ctx, agent(), `/plugin ${command} antst`)).map(option => option.label)).toEqual(['@antst/fixture'])
      }
      writeFileSync(join(bin, 'later-bin'), '')
      writeFileSync(join(profile, 'package.json'), JSON.stringify({ dependencies: { 'later-dependency': '2.0.0' } }))
      expect((await completionOptions(ctx, agent(), '/plugin exec later')).map(option => option.label)).toEqual(['later-bin'])
      expect((await completionOptions(ctx, agent(), '/plugin update later')).map(option => option.label)).toEqual(['later-dependency'])
      await expect(completionOptions(ctx, agent(), '/plugin exec later --flag')).resolves.toEqual([])
    } finally {
      rmSync(profile, { force: true, recursive: true })
    }
  })

  it('groups native commands and only user-invocable skills without executing either', async () => {
    const listCommands = vi.fn(() => [
      { name: 'status', description: 'Show status' },
      { name: 'stop', description: 'Stop work' },
    ])
    const listSkills = vi.fn(async () => [
      {
        name: 'story', description: 'Write a story', invocation: { modelInvocable: true, userInvocable: true },
        provider: 'fixture', source: 'runtime',
      },
      {
        name: 'secret', description: 'Hidden', invocation: { modelInvocable: true, userInvocable: false },
        provider: 'fixture', source: 'runtime',
      },
    ])
    const root = agent()
    const ctx = { commands: { list: listCommands }, skills: { list: listSkills } } as unknown as Context
    const options = await completionOptions(ctx, root, '/st')
    expect(options.map(option => [option.group, option.label, option.value])).toEqual([
      ['Commands', '/status', { kind: 'insert', text: '/status ' }],
      ['Commands', '/stop', { kind: 'insert', text: '/stop ' }],
      ['Skills', '/story', { kind: 'insert', text: '/story ' }],
    ])
    expect(listSkills).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/work', scope: root }))
  })

  it('orders slash prefix matches before substring matches', async () => {
    const ctx = {
      commands: { list: () => [
        { name: 'restart', description: 'Restart' },
        { name: 'status', description: 'Status' },
      ] },
      skills: { list: async () => [] },
    } as unknown as Context
    const options = await completionOptions(ctx, agent(), '/sta')
    expect(options.map(option => [option.label, option.submitOnEnter])).toEqual([
      ['/status', true], ['/restart', true],
    ])
  })

  it('uses the native cwd-bounded file service and shared mention grammar for @ completion', async () => {
    const list = vi.fn(async () => [
      { kind: 'directory' as const, path: 'src/lib' },
      { kind: 'file' as const, path: 'src/my file.ts' },
      { kind: 'file' as const, path: 'screens/shot.png' },
    ])
    const ctx = { get: (name: string) => name === 'fileReferences' ? { list } : undefined } as unknown as Context
    const root = agent()
    const options = await completionOptions(ctx, root, 'look @sr now', 8)
    expect(list).toHaveBeenCalledWith(root, 'sr', expect.any(AbortSignal))
    expect(options.map(option => [option.group, option.label, option.value])).toEqual([
      ['Files', 'src/lib/', { kind: 'insert', text: 'look @src/lib/ now' }],
      ['Files', 'src/my file.ts', { kind: 'insert', text: 'look @"src/my file.ts" now' }],
      ['Files', 'screens/shot.png', {
        kind: 'attach', path: 'screens/shot.png', source: 'look @sr now', text: 'look  now',
      }],
    ])
  })

  it('offers no @ approximation when file reference service is absent', async () => {
    const ctx = { get: () => undefined } as unknown as Context
    await expect(completionOptions(ctx, agent(), '@src', 4)).resolves.toEqual([])
  })

  it('projects session, model effort, and permission service data into list rows', () => {
    const sessions = sessionOverlay([{
      blank: false,
      cwd: '/elsewhere',
      running: false,
      sessionId: 'session-a' as never,
      updatedAt: 0,
      projections: { asOfSeq: 1, values: { title: 'Named' } },
    }, {
      blank: false, cwd: '/work', running: false,
      sessionId: 'session-hidden' as never, updatedAt: 1,
    }], 'other', '/elsewhere')
    expect(sessions).toMatchObject({ kind: 'list', purpose: 'resume' })
    if (sessions.kind !== 'list') throw new Error('expected list')
    expect(sessions.options[0]).toMatchObject({ label: 'Named · session-a', detail: expect.stringContaining('/elsewhere') })
    expect(sessions.options).toHaveLength(1)

    const models = modelOverlay({
      default: { model: 'one', provider: 'replay' },
      failures: [],
      groups: [{ id: 'replay', name: 'Replay', models: [{
        id: 'one', name: 'One', reasoning: {
          defaultEffort: 'low',
          efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }],
        },
      }] }],
      routableProviders: ['replay'],
    }, { model: 'one', provider: 'replay', reasoningEffort: 'high' })
    if (models.kind !== 'list') throw new Error('expected list')
    expect(models.options.map(option => [option.label, option.active])).toEqual([
      ['Replay · One · Low', false], ['Replay · One · High', true],
    ])

    const ctx = { permissionPresets: {
      current: () => 'workspace-write',
      names: ['workspace-write', 'danger-full-access'],
      optionOf: (name: string) => ({ name }),
      resolve: (name: string) => name === 'danger-full-access'
        ? { sandbox: 'danger-full-access', approval: 'never' }
        : { sandbox: 'workspace-write', approval: 'ask' },
    } } as unknown as Context
    const permissions = permissionOverlay(ctx, agent())
    if (permissions.kind !== 'list') throw new Error('expected list')
    expect(permissions.options[1]).toMatchObject({ danger: true, confirmDetail: [
      'Sandbox: danger-full-access', 'Approval: never',
    ] })
  })

  it('projects context estimates and selectable native agent presets without owning either', () => {
    const ctx = { sessionProjections: { snapshot: () => ({ values: { contextBreakdown: {
      messageTokens: 300, systemTokens: 100, toolsTokens: 200,
    } } }) } } as unknown as Context
    expect(contextOverlay(ctx, agent())).toMatchObject({
      kind: 'info', title: 'Context', lines: [
        'System prompt: 100 tokens',
        'Tool schemas: 200 tokens',
        'Messages: 300 tokens',
        expect.stringContaining('heuristic'),
      ],
    })

    const overlay = agentPresetOverlay([
      { id: 'standard', name: 'Standard', description: 'Daily work', trust: 'system', path: '/standard' },
      { id: 'broken', trust: 'user', path: '/broken', broken: 'bad config' },
      { id: 'ptc', trust: 'system', path: '/ptc' },
    ], 'standard', false)
    expect(overlay).toMatchObject({
      kind: 'list', notice: 'Choosing a preset starts a new session.', purpose: 'agents',
      options: [
        { active: true, label: 'Standard', detail: 'Daily work', value: { kind: 'agent-preset', preset: 'standard' } },
        { active: false, label: 'ptc', value: { kind: 'agent-preset', preset: 'ptc' } },
      ],
    })
  })

  it('builds the HUD from DSH projections with optional effort and activity', () => {
    for (const effort of [undefined, 'high']) {
      const ctx = {
        sessionProjections: { snapshot: () => ({ values: {
          contextPressure: { contextWindow: 200_000, projectedTokens: 42_000 },
          modelSelection: { next: { model: 'gpt-5.6-terra', provider: 'openai', reasoningEffort: effort } },
          permissions: { currentValue: 'workspace-write', options: [] },
          tokenUsage: { cacheReadTokens: 34_080, cacheWriteTokens: 0, outputTokens: 0, uncachedInputTokens: 13_920 },
        } }) },
      } as unknown as Context
      expect(sessionStatusLine(ctx, agent(), {
        cwd: '/work', id: 'session', model: 'fallback', status: 'idle',
        ...(effort === undefined ? {} : {
          jobs: [{ id: 'job', kind: 'bash', label: 'build', startedAt: 0, status: 'running' as const }],
          subagents: [{ id: 'child', label: 'research', mode: 'one-shot' as const, state: 'running' as const }],
          title: 'dashi',
        }),
      }, 'dtui/develop')).toBe(
        `gpt-5.6-terra${effort === undefined ? '' : ` · ${effort}`} · workspace-write · ctx 42k/200k 21% · cache 71% · 48k tok${effort === undefined ? '' : ' · 1 agents · 1 jobs · dashi'} · dtui/develop`,
      )
    }
  })
})
