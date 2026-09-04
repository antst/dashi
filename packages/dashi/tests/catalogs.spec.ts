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

  it('builds the status line from current DSH projections', () => {
    const ctx = {
      sessionProjections: { snapshot: () => ({ values: {
        contextPressure: { contextWindow: 200_000, projectedTokens: 12_345 },
        modelSelection: { next: { model: 'recorded', provider: 'replay' } },
        permissions: { currentValue: 'workspace-write', options: [] },
        tokenUsage: { cacheReadTokens: 90, cacheWriteTokens: 0, outputTokens: 5, uncachedInputTokens: 10 },
      } }) },
    } as unknown as Context
    expect(sessionStatusLine(ctx, agent(), {
      cwd: '/work', id: 'session', model: 'fallback', status: 'idle',
    }, 'feature/status')).toBe(
      'model replay/recorded · permission workspace-write · context 12,345/200,000 · cache 90% · branch feature/status',
    )
  })
})
