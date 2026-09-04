import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-presets'
import type { ModelCatalog, ModelSelection, SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-commands'
import type { FileReferenceService } from '@deepseek-ai/dsh-file-reference'
import { formatFileMention } from '@deepseek-ai/dsh-file-reference/grammar'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-stats/types'
import type { SessionSearchHit } from '@deepseek-ai/dsh-session-query'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { Overlay, OverlayOption, RootView } from './state.js'
import { detectAtTrigger } from './at-trigger.js'
import { pluginCompletionQuery, slashCompletionQuery } from './completion-trigger.js'
import { isImagePath } from './image-input.js'
import { sessionTitle } from './session-list.js'

function matchRank(name: string, query: string): number {
  const candidate = name.toLocaleLowerCase()
  const needle = query.toLocaleLowerCase()
  return candidate.startsWith(needle) ? 0 : candidate.includes(needle) ? 1 : 2
}

function selectedModel(ctx: Context, agent: Agent): ModelSelection | undefined {
  const selection = ctx.sessionProjections.snapshot(agent.session, ['modelSelection']).values.modelSelection
  return selection?.next ?? selection?.lastUsed ?? undefined
}

/** Build command and skill completion rows for one exact root. */
export async function completionOptions(
  ctx: Context,
  agent: Agent,
  input: string,
  caret = input.length,
  signal?: AbortSignal,
): Promise<readonly OverlayOption[]> {
  const plugin = pluginCompletionQuery(input, caret)
  if (plugin !== undefined) {
    let candidates: readonly string[] = ['add', 'remove', 'update', 'outdated', 'list', 'why', 'exec', 'licenses']
    if (plugin.command !== undefined) {
      const profile = fileURLToPath(new URL('.', ctx.baseUrl!))
      if (plugin.command === 'exec') {
        candidates = (await readdir(join(profile, 'node_modules', '.bin')).catch(
          (error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? [] : Promise.reject(error),
        )).sort()
      } else {
        const manifest = JSON.parse(await readFile(join(profile, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
        }
        candidates = Object.keys(manifest.dependencies ?? {}).sort()
      }
    }
    return candidates.filter(name => matchRank(name, plugin.query) < 2).map(name => ({
      group: 'Commands', label: name,
      value: { kind: 'insert', text: `/plugin ${plugin.command === undefined ? '' : `${plugin.command} `}${name} ` },
    }))
  }
  const at = detectAtTrigger(input, caret)
  if (at !== undefined) {
    const service = ctx.get('fileReferences') as FileReferenceService | undefined
    if (service === undefined) return []
    const candidates = await service.list(agent, at.query, signal ?? new AbortController().signal)
    return candidates.flatMap((candidate) => {
      const mention = formatFileMention(candidate, at.quoted)
      if (mention === undefined) return []
      const text = `${input.slice(0, at.start)}${mention}${input.slice(at.end)}`
      const image = candidate.kind === 'file' && isImagePath(candidate.path)
      return [{
        detail: candidate.kind === 'directory' ? 'directory' : image ? 'attach image' : 'file',
        group: 'Files' as const,
        label: `${candidate.path}${candidate.kind === 'directory' ? '/' : ''}`,
        value: image
          ? {
            kind: 'attach' as const,
            path: candidate.path,
            source: input,
            text: `${input.slice(0, at.start)}${input.slice(at.end)}`,
          }
          : { kind: 'insert' as const, text },
      }]
    })
  }
  const query = slashCompletionQuery(input)
  if (query === undefined) return []
  const commands = ctx.commands.list(agent)
    .filter(command => matchRank(command.name, query) < 2)
    .sort((left, right) => matchRank(left.name, query) - matchRank(right.name, query)
      || left.name.localeCompare(right.name))
    .map(command => ({
      detail: command.description,
      group: 'Commands' as const,
      label: `/${command.name}${command.input?.hint === undefined ? '' : ` ${command.input.hint}`}`,
      ...(command.input?.hint === undefined ? { submitOnEnter: true } : {}),
      value: { kind: 'insert' as const, text: `/${command.name} ` },
    }))
  const skills = (await ctx.skills.list({ cwd: agent.session.header.cwd, scope: agent, signal }))
    .filter(isUserInvocable)
    .filter(skill => matchRank(skill.name, query) < 2)
    .sort((left, right) => matchRank(left.name, query) - matchRank(right.name, query)
      || left.name.localeCompare(right.name))
    .map(skill => ({
      detail: skill.description,
      group: 'Skills' as const,
      label: `/${skill.name}`,
      value: { kind: 'insert' as const, text: `/${skill.name} ` },
    }))
  return [...commands, ...skills]
}

/** Build a filtered view of the skills resolved for one live session. */
export async function skillOverlay(
  ctx: Context, agent: Agent, filter: string, signal?: AbortSignal,
): Promise<Overlay> {
  const lookup = { cwd: agent.session.header.cwd, scope: agent, signal }
  const needle = filter.trim().toLocaleLowerCase()
  const skills = (await ctx.skills.list(lookup)).filter(skill => needle === ''
    || skill.name.toLocaleLowerCase().includes(needle)
    || skill.description.toLocaleLowerCase().includes(needle))
  const definitions = await Promise.all(skills.map(skill => ctx.skills.get(skill.name, lookup)))
  return {
    cursor: 0, kind: 'list', purpose: 'skills', title: needle === '' ? 'Skills' : `Skills · ${filter.trim()}`,
    options: skills.map((skill, index) => ({
      detail: `${skill.description} · user ${skill.invocation.userInvocable ? 'yes' : 'no'} · model ${skill.invocation.modelInvocable ? 'yes' : 'no'} · source ${skill.source} · provider ${skill.provider} · path ${definitions[index]?.path ?? 'unavailable'}`,
      label: `/${skill.name}`,
      value: { kind: 'insert', text: `/${skill.name} ` },
    })),
  }
}

/** Build the cold session picker without adopting any candidate. */
export function sessionOverlay(items: readonly SessionSummary[], currentId: string, cwd?: string): Overlay {
  return {
    cursor: 0,
    kind: 'list',
    options: items.filter(item => item.origin === undefined && (cwd === undefined || item.cwd === cwd)).map(item => ({
      active: String(item.sessionId) === currentId,
      detail: `${item.cwd ?? 'cwd unavailable'} · ${new Date(item.updatedAt).toISOString()}`,
      label: `${sessionTitle(item) ?? 'Untitled'} · ${String(item.sessionId)}`,
      value: { kind: 'resume', sessionId: String(item.sessionId) },
    })),
    purpose: 'resume',
    title: 'Resume session',
  }
}

/** Flatten DSH's provider/model/effort catalog into one terminal picker. */
export function modelOverlay(catalog: ModelCatalog, selected?: ModelSelection): Overlay {
  const options: OverlayOption[] = []
  for (const group of catalog.groups) {
    for (const model of group.models) {
      const efforts = model.reasoning?.efforts ?? []
      if (efforts.length === 0) {
        options.push({
          active: selected?.provider === group.id && selected.model === model.id,
          label: `${group.name} · ${model.name}`,
          value: { kind: 'model', model: model.id, provider: group.id },
          ...(model.description === undefined ? {} : { detail: model.description }),
        })
        continue
      }
      for (const effort of efforts) {
        options.push({
          active: selected?.provider === group.id && selected.model === model.id
            && (selected.reasoningEffort ?? model.reasoning?.defaultEffort) === effort.id,
          label: `${group.name} · ${model.name} · ${effort.name}`,
          value: { kind: 'model', effort: effort.id, model: model.id, provider: group.id },
          ...(effort.description ?? model.description) === undefined
            ? {} : { detail: effort.description ?? model.description },
        })
      }
    }
  }
  return { cursor: Math.max(0, options.findIndex(option => option.active === true)), kind: 'list', options, purpose: 'model', title: 'Model' }
}

/** Build the preset picker from the native preset service. */
export function permissionOverlay(ctx: Context, agent: Agent): Overlay {
  const current = ctx.permissionPresets.current(agent.session)
  const options = ctx.permissionPresets.names.map((preset) => {
    const option = ctx.permissionPresets.optionOf(preset)
    const spec = ctx.permissionPresets.resolve(preset)
    return {
      active: preset === current,
      confirmDetail: [`Sandbox: ${spec.sandbox}`, `Approval: ${spec.approval}`],
      danger: spec.approval === 'never',
      label: option.name,
      value: { kind: 'permission' as const, preset },
      ...(option.description === undefined ? {} : { detail: option.description }),
    }
  })
  return {
    cursor: Math.max(0, options.findIndex(option => option.active)),
    kind: 'list', options, purpose: 'permission', title: 'Permission preset',
  }
}

function number(value: unknown): string {
  return typeof value === 'number' ? value.toLocaleString('en-US') : 'unavailable'
}

function milliseconds(value: unknown): string {
  return typeof value === 'number' ? `${number(value)} ms` : 'unavailable'
}

export function sessionStatusLine(ctx: Context, agent: Agent, root: RootView, branch?: string): string {
  const { modelSelection, permissions, tokenUsage, contextPressure } = ctx.sessionProjections
    .snapshot(agent.session, ['modelSelection', 'permissions', 'tokenUsage', 'contextPressure']).values
  const model = modelSelection?.next ?? modelSelection?.lastUsed
  const input = tokenUsage === undefined ? 0 : tokenUsage.uncachedInputTokens + tokenUsage.cacheReadTokens + tokenUsage.cacheWriteTokens
  const used = contextPressure?.projectedTokens ?? contextPressure?.pressureTokens
  return [
    `model ${model == null ? `${root.provider === undefined ? '' : `${root.provider}/`}${root.model}` : `${model.provider}/${model.model}`}`,
    `permission ${permissions?.currentValue ?? root.permission ?? 'unknown'}`,
    ...(used === undefined || contextPressure?.contextWindow === undefined ? [] : [`context ${number(used)}/${number(contextPressure.contextWindow)}`]),
    ...(input === 0 ? [] : [`cache ${String(Math.min(tokenUsage?.cacheReadTokens === input ? 100 : 99, Math.round((tokenUsage?.cacheReadTokens ?? 0) / input * 100)))}%`]),
    ...(branch === undefined ? [] : [`branch ${branch}`]),
  ].join(' · ')
}
/** Read DSH-owned root facts for /status in one projection cut. */
export function statusOverlay(ctx: Context, agent: Agent, root: RootView): Overlay {
  const values = ctx.sessionProjections.snapshot(agent.session, [
    'modelSelection', 'permissions', 'tokenUsage', 'contextPressure', 'contextBreakdown',
  ]).values
  const model = values.modelSelection?.next ?? values.modelSelection?.lastUsed
  const usage = values.tokenUsage
  const pressure = values.contextPressure
  const breakdown = values.contextBreakdown
  return {
    kind: 'info',
    lines: [
      `UUID: ${root.id}`,
      `Title: ${root.title ?? 'Untitled'}`,
      `Cwd: ${root.cwd}`,
      root.parent === undefined
        ? 'Lineage: root session'
        : `Lineage: forked from ${root.parent} at turn ${String(root.parentTurn ?? 'unknown')}`,
      `Model: ${model === null || model === undefined ? root.model : `${model.provider}/${model.model}`}`,
      `Effort: ${model?.reasoningEffort ?? root.effort ?? 'default'}`,
      `Permission: ${ctx.permissionPresets.current(agent.session)}`,
      `Usage: input ${number(usage?.uncachedInputTokens)} · output ${number(usage?.outputTokens)} · cache read ${number(usage?.cacheReadTokens)} · cache write ${number(usage?.cacheWriteTokens)}`,
      `Context: ${number(pressure?.projectedTokens)} / ${number(pressure?.contextWindow)} tokens`,
      `Composition: system ${number(breakdown?.systemTokens)} · tools ${number(breakdown?.toolsTokens)} · messages ${number(breakdown?.messageTokens)}`,
    ],
    title: 'Status',
  }
}

/** Show DSH's heuristic next-request composition without treating it as an exact total. */
export function contextOverlay(ctx: Context, agent: Agent): Overlay {
  const breakdown = ctx.sessionProjections.snapshot(agent.session, ['contextBreakdown'])
    .values.contextBreakdown
  return {
    kind: 'info',
    lines: [
      `System prompt: ${number(breakdown?.systemTokens)} tokens`,
      `Tool schemas: ${number(breakdown?.toolsTokens)} tokens`,
      `Messages: ${number(breakdown?.messageTokens)} tokens`,
      'These are DSH heuristic estimates for the next request, not a provider-reported total.',
    ],
    title: 'Context',
  }
}

/** Read DSH's whole-log token and timing projections without folding session history. */
export function usageOverlay(ctx: Context, agent: Agent): Overlay {
  const values = ctx.sessionProjections.snapshot(agent.session, ['tokenUsage', 'sessionStats']).values
  const tokens = values.tokenUsage
  const stats = values.sessionStats
  const measured = stats === undefined ? undefined : stats.llmMs + stats.toolMs
  return {
    kind: 'info',
    lines: [
      `Input tokens: ${number(tokens?.uncachedInputTokens)}`,
      `Output tokens: ${number(tokens?.outputTokens)}`,
      `Cache read: ${number(tokens?.cacheReadTokens)}`,
      `Cache write: ${number(tokens?.cacheWriteTokens)}`,
      `Turns: ${number(stats?.turns)} · Steps: ${number(stats?.steps)}`,
      `Model time: ${milliseconds(stats?.llmMs)}`,
      `Tool time: ${milliseconds(stats?.toolMs)}`,
      `Measured wall time: ${milliseconds(measured)}`,
    ],
    title: 'Usage',
  }
}

/** Build the native agent-preset picker; broken presets are visible elsewhere, not selectable here. */
export function agentPresetOverlay(
  presets: readonly AgentPreset[],
  current: string,
  blank: boolean,
): Overlay {
  const options = presets.filter(preset => preset.broken === undefined).map(preset => ({
    active: preset.id === current,
    label: preset.name ?? preset.id,
    value: { kind: 'agent-preset' as const, preset: preset.id },
    ...(preset.description === undefined ? {} : { detail: preset.description }),
  }))
  return {
    cursor: Math.max(0, options.findIndex(option => option.active)),
    kind: 'list',
    notice: blank ? 'The current session is blank.' : 'Choosing a preset starts a new session.',
    options,
    purpose: 'agents',
    title: 'Agent preset',
  }
}

/** Build bounded same-cwd prompt-search rows from DSH query hits. */
export function searchOverlay(items: readonly SessionSearchHit[], rootId: string): Overlay {
  return {
    cursor: 0,
    kind: 'list',
    options: items.map(item => ({
      detail: `${String(item.header.id)} · ${item.header.cwd ?? 'cwd unavailable'}`,
      label: item.bestMatch.snippet.replaceAll(/\s+/gu, ' ').trim(),
      value: {
        kind: 'search-result', rootId, seq: item.bestMatch.seq,
        sessionId: String(item.header.id),
      },
    })),
    purpose: 'search',
    title: 'Prompt search',
  }
}

export function currentModel(ctx: Context, agent: Agent): ModelSelection | undefined {
  return selectedModel(ctx, agent)
}
