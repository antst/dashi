import type { Context, Fiber } from '@deepseek-ai/cordis'
import { basename } from 'node:path'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '@deepseek-ai/dsh-attachment'
import type {
  ModelSelection,
  SessionControlFrame,
  SessionFollowFrame,
  SessionProjectionBaseline,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller'
import type { CommandDefinition, CommandExecution, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { AuthorizationDeclinedError, type AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { parseCredentialKey } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-fs'
import type { PluginInventoryGateway } from '@deepseek-ai/dsh-host-plugin-inventory'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { createUserMessage, type ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-permission-presets'
import { SessionId, SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-token-meter'
import type { ApprovalOutcome as DshApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { AskUserQuestionAnswer } from '@deepseek-ai/dsh-user-questions'
import {
  agentPresetOverlay,
  completionOptions,
  contextOverlay,
  currentModel,
  modelOverlay,
  permissionOverlay,
  searchOverlay,
  sessionOverlay,
  skillOverlay,
  statusOverlay,
} from './catalogs.js'
import { diffOverlay } from './diff-view.js'
import { eventsFromRecords } from './history-records.js'
import { admitDraftImages, encodeDraftImages, readDraftImages } from './image-input.js'
import { contextPercent, jobViews, subagentViews } from './presentation.js'
import {
  humanPrompt, humanPrompts, inheritedTurn, rewindActionOverlay, rewindOverlay,
} from './rewind.js'
import type {
  ActivatableOverlayValue,
  DecisionAnswer,
  DraftAttachment,
  OverlayOption,
  OverlayValue,
  PendingDecision,
  RootView,
  SendMode,
  TerminalCell,
  UiAction,
} from './state.js'
import { createToolPresenter, type ToolPresenter } from './tool-presentation.js'
import { quoteShellWord, runHumanShell } from './shell-command.js'
import { markdownTranscript } from './session-export.js'
import { isSessionId, sessionMatches, sessionNotFound } from './session-list.js'
import { memoryOverlay } from './memory.js'
import { foldCells, pendingShellCells } from './transcript.js'
import type { TuiRoot } from './tui-root.js'

export interface RootLaunchOptions {
  readonly agentPreset?: string; readonly continue: boolean
  readonly cwd: string
  readonly effort?: string; readonly forkSession: boolean
  readonly name?: string
  readonly images?: readonly string[]
  readonly model?: string
  readonly permission?: string
  readonly prompt?: string
  readonly provider?: string
  readonly resume?: string; readonly sessionId?: string
}

export interface SessionRuntime {
  readonly initialAttachments: readonly DraftAttachment[]
  readonly initialCells: readonly TerminalCell[]
  readonly initialHasMore: boolean
  readonly initialPrompts: readonly string[]
  readonly root: RootView
  readonly summary: string
  activate(value: ActivatableOverlayValue): Promise<void>
  attach(path: string): Promise<DraftAttachment | undefined>
  complete(query: string, caret: number): Promise<readonly OverlayOption[]>
  cyclePermission(): Promise<void>
  interrupt(): void
  loadHistory(rootId: string): Promise<void>
  search(query: string, rootId: string): Promise<void>
  shutdown(): Promise<void>
  start(): void
  submit(text: string, mode: SendMode, attachments: readonly DraftAttachment[]): Promise<void>
}

export interface DecisionBindings {
  readonly cancel: (id: string) => void
  readonly request: (decision: PendingDecision) => Promise<DecisionAnswer>
}

interface Binding {
  readonly abort: AbortController
  readonly agent: Agent
  readonly events: SessionEvent[]
  readonly controlIterator: AsyncIterator<SessionControlFrame>
  readonly iterator: AsyncIterator<SessionFollowFrame>
  readonly presenter: ToolPresenter
  commandScope?: Fiber
  readonly cursor: number
  disposers: Array<() => void>
  pump?: Promise<void>
  controlPump?: Promise<void>
  hasMore: boolean
  presentationTimer: ReturnType<typeof setTimeout> | undefined
  root: RootView
  timer: ReturnType<typeof setTimeout> | undefined
}

function starterAgents(cwd: string): string {
  return `# ${basename(cwd)}\n\n## Working agreement\n\n- Add project-specific architecture guidance.\n- Add required build, test, and lint commands.\n- Add repository conventions and constraints.\n`
}

type RootOperation = Extract<OverlayValue, {
  kind: 'fork' | 'new' | 'open-resume' | 'open-rewind' | 'resume' | 'rewind'
}>

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function continuation(items: readonly SessionSummary[], cwd: string): SessionId {
  const candidates = items.filter(item => item.cwd === cwd
    && item.parentSessionId === undefined && item.origin === undefined)
    .sort((left, right) => right.updatedAt - left.updatedAt
      || String(left.sessionId).localeCompare(String(right.sessionId)))
  const chosen = candidates[0]
  if (chosen === undefined) throw new Error(`no resumable DSH session in ${cwd}`)
  return chosen.sessionId
}

function projectionString(projections: SessionProjectionBaseline, key: string): string | undefined {
  const value = projections.values[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

function projectionModel(projections: SessionProjectionBaseline): ModelSelection | undefined {
  const value = projections.values.modelSelection
  return value?.next ?? value?.lastUsed ?? undefined
}

function modelFromEvent(event: SessionEvent): ModelSelection | undefined {
  if (event.type !== 'request/header') return undefined
  const config = event.data.header.config
  return {
    model: config.model,
    provider: config.provider,
    ...(config.reasoningEffort === undefined ? {} : { reasoningEffort: String(config.reasoningEffort) }),
  }
}

function turnStartTime(events: readonly SessionEvent[], turn: number): number | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event?.type === 'turn/start' && event.data.turn === turn) return event.time
  }
}

function titleFromEvent(event: SessionEvent): string | undefined {
  if (String(event.type) !== 'session/title') return undefined
  const data = event.data as unknown as Record<string, unknown>
  return typeof data.title === 'string' ? data.title : undefined
}

async function firstSnapshot(
  iterator: AsyncIterator<SessionFollowFrame>,
): Promise<Extract<SessionFollowFrame, { type: 'snapshot' }>> {
  const first = await iterator.next()
  if (first.done === true || first.value.type !== 'snapshot') {
    throw new Error('DSH session follow ended before its opening snapshot')
  }
  return first.value
}

async function firstControl(
  iterator: AsyncIterator<SessionControlFrame>,
): Promise<Extract<SessionControlFrame, { type: 'baseline' }>> {
  const first = await iterator.next()
  if (first.done === true || first.value.type !== 'baseline') {
    throw new Error('DSH session control ended before its opening baseline')
  }
  return first.value
}

function usage(raw: string, expected: string): CommandResult | undefined {
  return raw.trim() === '' ? undefined : { kind: 'error', text: `usage: ${expected}` }
}

function configValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function configLayer(value: unknown): string {
  return value === undefined ? '—' : JSON.stringify(value)
}

/** Create or resume the exact current root and own its replaceable terminal binding. */
export async function createSessionRuntime(
  ctx: Context,
  options: RootLaunchOptions,
  tuiRoot: TuiRoot,
  dispatch: (action: UiAction) => void,
  decisions?: DecisionBindings,
): Promise<SessionRuntime> {
  const lifetime = new AbortController()
  let accepting = true
  let started = false
  let shutdown: Promise<void> | undefined
  let decisionSequence = 0

  let initialId = options.resume === undefined
    ? options.continue
      ? continuation((await ctx.sessionController.list({}, lifetime.signal)).items, options.cwd)
      : (await ctx.sessionController.create({ cwd: options.cwd, ...(options.agentPreset === undefined ? {} : { agentPreset: options.agentPreset }), ...(options.sessionId === undefined ? {} : { sessionId: SessionId(options.sessionId) }) })).sessionId
    : SessionId(options.resume)
  if (options.forkSession) initialId = (await ctx.sessionController.fork({ sessionId: initialId })).sessionId

  const prepare = async (sessionId: SessionId, name?: string): Promise<Binding> => {
    const abort = new AbortController()
    try {
      const resolved = await ctx.sessionController.resolveAgent(sessionId)
      if ('error' in resolved) throw resolved.error
      const agent = resolved.agent
      let title: string | undefined
      if (name !== undefined) title = (await ctx.sessionController.rename({ sessionId, title: name })).title
      await ctx.sessions.flush(agent.session)
      const iterator = ctx.sessionController.follow({
        address: { kind: 'session', sessionId }, maxMessages: 50,
      }, abort.signal)[Symbol.asyncIterator]()
      const controlIterator = ctx.sessionController.control(abort.signal)[Symbol.asyncIterator]()
      const [opening, controlOpening, subagents] = await Promise.all([
        firstSnapshot(iterator), firstControl(controlIterator), subagentViews(ctx, sessionId, abort.signal),
      ])
      title ??= projectionString(opening.projections, 'title')
      const selected = projectionModel(opening.projections)
      const provider = selected?.provider ?? agent.options.provider
      const effort = selected?.reasoningEffort ?? agent.options.reasoningEffort
      const initialContextPercent = contextPercent(controlOpening.value.projections[sessionId]?.values.contextPressure)
      const parentTurn = agent.session.header.parentSession === undefined ? undefined
        : inheritedTurn(agent.session.snapshotEvents(), agent.session.inheritedEventCount)
      return {
        abort,
        agent,
        controlIterator,
        cursor: opening.cursor,
        disposers: [],
        events: eventsFromRecords(opening.records),
        hasMore: opening.hasMore,
        iterator,
        presenter: createToolPresenter(tool => ctx.tools.get(tool, agent)),
        presentationTimer: undefined,
        root: {
          ...(initialContextPercent === undefined ? {} : { contextPercent: initialContextPercent }),
          cwd: opening.header.cwd ?? options.cwd,
          id: String(sessionId),
          jobs: jobViews(controlOpening.value.jobs[sessionId] ?? []),
          model: selected?.model ?? agent.options.model ?? 'default',
          permission: ctx.permissionPresets.current(agent.session),
          status: agent.status,
          subagents,
          ...(provider === undefined ? {} : { provider }),
          ...(effort === undefined ? {} : { effort: String(effort) }),
          ...(agent.session.header.parentSession === undefined
            ? {} : { parent: String(agent.session.header.parentSession) }),
          ...(parentTurn === undefined ? {} : { parentTurn }),
          ...(title === undefined ? {} : { title }),
        },
        timer: undefined,
      }
    } catch (error) {
      abort.abort()
      throw error
    }
  }

  let binding = await prepare(initialId, options.name)
  const initialAttachments = await readDraftImages(binding.root.cwd, options.images ?? [])
  const current = (): Binding => binding
  const report = (error: unknown, rootId = current().root.id): void => {
    dispatch({ type: 'runtime-error', message: detail(error), rootId })
  }

  const executeAccepted = async (
    bound: Binding,
    line: string,
    images: ReturnType<typeof encodeDraftImages>,
    onSettled?: (execution: CommandExecution) => void,
  ): Promise<boolean> => {
    const from = bound.agent.session.seq
    const execution = ctx.commands.execute(bound.agent, line, images, lifetime.signal)
    const accepted = bound.agent.session.snapshotEvents(from).some(event => event.type === 'command/run')
    if (!accepted) {
      const result = await execution
      if (result === undefined) return false
      onSettled?.(result)
      return true
    }
    void execution.then(result => {
      if (result !== undefined) onSettled?.(result)
    }).catch((error: unknown) => {
      if (!lifetime.signal.aborted) report(error, bound.root.id)
    })
    return true
  }

  const decide = <T>(decision: PendingDecision, signal: AbortSignal | undefined): Promise<T> => {
    if (decisions === undefined) return Promise.reject(new Error('dashi decision surface is not ready'))
    const abortDecision = (): void => { decisions.cancel(decision.id) }
    signal?.addEventListener('abort', abortDecision, { once: true })
    return decisions.request(decision).finally(() => {
      signal?.removeEventListener('abort', abortDecision)
    }) as Promise<T>
  }

  const authorizationPrompt = (bound: Binding, prompt: AuthorizationPrompt, detail?: string): Promise<string> =>
    decide<Exclude<DecisionAnswer, string>>({
      answers: [], cursor: 0, custom: '', id: `authorization:${String(++decisionSequence)}`, index: 0, kind: 'question', owner: { id: bound.root.id, ...(bound.root.title === undefined ? {} : { label: bound.root.title }) }, selected: [],
      questions: [{ allowCustom: prompt.kind !== 'select', ...(detail === undefined ? {} : { detail }), header: 'Login', id: 'authorization', multiSelect: false, options: prompt.kind === 'select' ? prompt.options : [], question: prompt.message, secret: prompt.kind === 'secret' }],
    }, prompt.signal).then(result => prompt.kind === 'select' ? prompt.options[prompt.options.findIndex(option => option.label === result.answers[0]?.selected[0])]?.id ?? ''
      : result.answers[0]?.custom ?? '').catch(error => {
      if (prompt.signal?.aborted !== true && (error as { code?: unknown }).code === 'ASK_ABORTED') throw new AuthorizationDeclinedError()
      throw error
    })
  const transcriptCells = (bound: Binding): readonly TerminalCell[] => [
    ...foldCells(bound.events, bound.presenter, { truncatedStart: bound.hasMore }),
    ...pendingShellCells(bound.agent.inbox.nextStep),
  ]

  const publish = (bound: Binding): void => {
    bound.timer = undefined
    dispatch({
      type: 'transcript-changed', cells: transcriptCells(bound),
      hasMore: bound.hasMore, rootId: bound.root.id,
    })
  }
  const schedule = (bound: Binding): void => {
    if (bound.timer === undefined) bound.timer = setTimeout(() => { publish(bound) }, 34)
  }
  const refreshSubagents = async (bound: Binding): Promise<void> => {
    const subagents = await subagentViews(ctx, bound.agent.id, bound.abort.signal)
    if (bound.abort.signal.aborted || current() !== bound) return
    bound.root = { ...bound.root, subagents }
    dispatch({ type: 'root-presentation', rootId: bound.root.id, subagents })
  }
  const scheduleSubagents = (bound: Binding): void => {
    if (bound.presentationTimer !== undefined) clearTimeout(bound.presentationTimer)
    bound.presentationTimer = setTimeout(() => {
      bound.presentationTimer = undefined
      void refreshSubagents(bound).catch((error: unknown) => {
        if (!bound.abort.signal.aborted) report(error, bound.root.id)
      })
    }, 34)
  }
  const consume = (bound: Binding, frame: Exclude<SessionFollowFrame, { type: 'snapshot' }>): void => {
    const [event] = eventsFromRecords([frame])
    if (event === undefined) return
    bound.events.push(event)
    if (event.type === 'turn/end') {
      const startedAt = turnStartTime(bound.events, event.data.turn)
      if (startedAt !== undefined) {
        dispatch({
          durationMs: Math.max(0, event.time - startedAt), rootId: bound.root.id, type: 'turn-ended',
        })
      }
    }
    const title = titleFromEvent(event)
    if (title !== undefined && title !== bound.root.title) {
      bound.root = { ...bound.root, title }
      dispatch({ type: 'root-title', rootId: bound.root.id, title })
    }
    const model = modelFromEvent(event)
    if (model !== undefined) {
      const { effort: _oldEffort, ...root } = bound.root
      bound.root = {
        ...root, model: model.model, provider: model.provider,
        ...(model.reasoningEffort === undefined ? {} : { effort: model.reasoningEffort }),
      }
      dispatch({
        type: 'root-model', rootId: bound.root.id, model: model.model, provider: model.provider,
        ...(model.reasoningEffort === undefined ? {} : { effort: model.reasoningEffort }),
      })
    }
    const prompt = humanPrompt(event)
    if (prompt !== undefined) dispatch({ type: 'prompt-recorded', rootId: bound.root.id, text: prompt })
    schedule(bound)
  }
  const follow = async (bound: Binding): Promise<void> => {
    try {
      for (;;) {
        const next = await bound.iterator.next()
        if (next.done === true) break
        if (next.value.type === 'snapshot') {
          report('DSH session follow emitted a second snapshot', bound.root.id)
          continue
        }
        consume(bound, next.value)
      }
    } catch (error) {
      if (!bound.abort.signal.aborted) report(error, bound.root.id)
    }
  }
  const followControl = async (bound: Binding): Promise<void> => {
    try {
      for (;;) {
        const next = await bound.controlIterator.next()
        if (next.done === true) break
        const frame = next.value
        if (frame.type === 'baseline') {
          report('DSH session control emitted a second baseline', bound.root.id)
        } else if (frame.type === 'jobs' && String(frame.sessionId) === bound.root.id) {
          const jobs = jobViews(frame.jobs)
          bound.root = { ...bound.root, jobs }
          dispatch({ type: 'root-presentation', jobs, rootId: bound.root.id })
        } else if (frame.type === 'projection') {
          if (String(frame.sessionId) === bound.root.id && frame.key === 'contextPressure') {
            const percent = contextPercent(frame.value)
            const { contextPercent: _previous, ...root } = bound.root
            bound.root = { ...root, ...(percent === undefined ? {} : { contextPercent: percent }) }
            dispatch({ type: 'root-presentation', contextPercent: percent ?? null, rootId: bound.root.id })
          }
          if (frame.key === 'subagent' || frame.key === 'subagentTiming'
            || frame.key === 'title' || frame.key === 'tokenUsage') scheduleSubagents(bound)
        }
      }
    } catch (error) {
      if (!bound.abort.signal.aborted) report(error, bound.root.id)
    }
  }

  const openPermission = (bound: Binding): void => {
    dispatch({ type: 'open-overlay', overlay: permissionOverlay(ctx, bound.agent) })
  }
  const openModel = async (bound: Binding): Promise<void> => {
    const catalog = await ctx.sessionController.modelCatalog()
    const overlay = modelOverlay(catalog, currentModel(ctx, bound.agent))
    if (overlay.kind === 'list' && overlay.options.length === 0) {
      throw new Error(catalog.failures.map(failure => `${failure.name}: ${failure.message}`).join('; ') || 'no models available')
    }
    dispatch({ type: 'open-overlay', overlay })
  }

  const replace = async (sessionId: SessionId, name?: string): Promise<void> => {
    const previous = current()
    if (previous.agent.status === 'running') throw new Error('wait for or interrupt the running root before switching sessions')
    if (previous.root.id === String(sessionId) && name === undefined) return
    const candidate = await prepare(sessionId, name)
    await install(candidate)
    binding = candidate
    tuiRoot.bind(candidate.agent)
    dispatch({
      type: 'root-bound', cells: transcriptCells(candidate),
      hasMore: candidate.hasMore, prompts: humanPrompts(candidate.events), root: candidate.root,
    })
    if (started) {
      candidate.pump = follow(candidate)
      candidate.controlPump = followControl(candidate)
    }
    await stop(previous)
  }

  const readyForRootOperation = async (operation: RootOperation): Promise<Binding | undefined> => {
    const bound = current()
    if (bound.agent.status === 'idle') return bound
    if (operation.interrupt !== true) {
      dispatch({ type: 'open-overlay', overlay: {
        acceptLabel: 'Interrupt',
        cursor: 1,
        detail: ['The current turn will stop before the session changes.'],
        kind: 'confirm',
        title: 'Interrupt current turn?',
        value: { ...operation, interrupt: true },
      } })
      return undefined
    }
    bound.agent.cancel({ kind: 'user' }, { keepInbox: true })
    await bound.agent.whenIdle()
    if (current() !== bound) throw new Error('the current root changed while interruption completed')
    return bound
  }

  const restoreFiles = async (bound: Binding, target: number | 'start'): Promise<void> => {
    const execution = await ctx.commands.execute(
      bound.agent, `/roller-restore ${String(target)}`, [], lifetime.signal,
    )
    if (execution === undefined) throw new Error('roller-restore disappeared before execution')
    if (execution.result.kind === 'error') throw new Error(execution.result.text ?? 'roller restore failed')
  }

  const restoreFirstConversation = async (bound: Binding, prompt: string): Promise<void> => {
    const agentPreset = ctx.sessionProjections.stateOf(bound.agent.session, 'agentPreset')
      ?? ctx.agentPresets.defaultId
    const modelProjection = ctx.sessionProjections.snapshot(bound.agent.session, ['modelSelection'])
      .values.modelSelection
    const selection = modelProjection?.next ?? modelProjection?.lastUsed ?? undefined
    const created = await ctx.sessionController.create({ cwd: bound.root.cwd, agentPreset })
    let selectionFailure: unknown
    try {
      if (selection === undefined) throw new Error('the current session has no durable model selection')
      await ctx.sessionController.selectModel({ sessionId: created.sessionId, ...selection })
    } catch (error) {
      selectionFailure = error
    }
    await replace(created.sessionId)
    dispatch({ type: 'composer-set', text: prompt })
    if (selectionFailure !== undefined) throw selectionFailure
  }

  const runRootOperation = async (operation: RootOperation): Promise<void> => {
    const bound = await readyForRootOperation(operation)
    if (bound === undefined) return
    switch (operation.kind) {
      case 'new': {
        const created = await ctx.sessionController.create({
          cwd: bound.root.cwd,
          ...(operation.agentPreset === undefined ? {} : { agentPreset: operation.agentPreset }),
        })
        await replace(created.sessionId, operation.title)
        return
      }
      case 'open-resume':
        dispatch({
          type: 'open-overlay',
          overlay: sessionOverlay((await ctx.sessionController.list({}, lifetime.signal)).items, bound.root.id,
            operation.all === true ? undefined : bound.root.cwd),
        })
        return
      case 'resume':
        if (isSessionId(operation.sessionId)) await replace(SessionId(operation.sessionId))
        else {
          const matches = sessionMatches(
            (await ctx.sessionController.list({}, lifetime.signal)).items, operation.sessionId,
            operation.all === true ? undefined : bound.root.cwd,
          )
          const [match] = matches
          if (match === undefined) throw sessionNotFound(operation.sessionId)
          if (matches.length === 1) await replace(match.sessionId)
          else dispatch({ type: 'open-overlay', overlay: sessionOverlay(matches, bound.root.id) })
        }
        return
      case 'fork': {
        const child = await ctx.sessionController.fork({ sessionId: bound.agent.id })
        await replace(child.sessionId)
        return
      }
      case 'open-rewind': {
        const roller = ctx.commands.list(bound.agent).some(command => command.name === 'roller-restore')
        const overlay = rewindOverlay(bound.agent.session.snapshotEvents(), roller)
        if (overlay.kind !== 'list' || overlay.options.length === 0) {
          throw new Error('the current session has no human prompt to rewind')
        }
        dispatch({ type: 'open-overlay', overlay })
        return
      }
      case 'rewind': {
        if (operation.mode === 'code') {
          await restoreFiles(bound, operation.atSeq ?? 'start')
          return
        }
        if (operation.atSeq === undefined) {
          if (operation.mode === 'both') await restoreFiles(bound, 'start')
          await restoreFirstConversation(bound, operation.prompt)
          return
        }
        const child = await ctx.sessionController.fork({
          atSeq: operation.atSeq, sessionId: bound.agent.id,
        })
        await replace(child.sessionId)
        if (operation.mode === 'both') await restoreFiles(current(), operation.atSeq)
        dispatch({ type: 'composer-set', text: operation.prompt })
        return
      }
    }
  }

  const commandDefinitions = (bound: Binding): readonly CommandDefinition[] => {
    const nativePermission = ctx.commands.find(bound.agent, 'permission')
    if (nativePermission === undefined) throw new Error('dashi: DSH supplied no /permission command')
    const ensureCurrent = (invocation: CommandInvocation): CommandResult | undefined =>
      current().agent === invocation.agent ? undefined : { kind: 'error', text: 'this root is no longer current' }
    const tasks = (invocation: CommandInvocation): CommandResult => {
      const stale = ensureCurrent(invocation)
      if (stale !== undefined) return stale
      const raw = invocation.rawInput.trim()
      if (raw === '') {
        dispatch({ type: 'open-details' })
        return { kind: 'success' }
      }
      const match = /^kill\s+(\S+)$/u.exec(raw)
      if (match?.[1] === undefined) return { kind: 'error', text: 'usage: /tasks [kill ID]' }
      const result = ctx.jobs.kill(JobId(match[1]), bound.agent, 'stopped by /tasks')
      return { kind: 'success', text: result === 'requested' ? `stopping ${match[1]}` : `${match[1]} already finished` }
    }
    const definitions: readonly CommandDefinition[] = [
      {
        name: 'help', description: 'Show keyboard and command help',
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/help')
          if (invalid !== undefined) return invalid
          dispatch({ type: 'help' })
          return { kind: 'success' }
        },
      },
      {
        name: 'status', description: 'Show exact session, model, permission, and usage facts',
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/status')
          if (invalid !== undefined) return invalid
          dispatch({ type: 'open-overlay', overlay: statusOverlay(ctx, bound.agent, bound.root) })
          return { kind: 'success' }
        },
      },
      {
        name: 'context', description: 'Show DSH context composition estimates',
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/context')
          if (invalid !== undefined) return invalid
          dispatch({ type: 'open-overlay', overlay: contextOverlay(ctx, bound.agent) })
          return { kind: 'success' }
        },
      },
      {
        name: 'memory', description: 'Open an instruction file loaded by DSH',
        handler: (invocation) => {
          const invalid = ensureCurrent(invocation) ?? usage(invocation.rawInput, '/memory')
          if (invalid !== undefined) return invalid
          dispatch({ type: 'open-overlay', overlay: memoryOverlay(bound.agent) })
          return { kind: 'success' }
        },
      },
      {
        name: 'skills', description: 'List skills resolved for this session', input: { hint: '[TEXT]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const overlay = await skillOverlay(ctx, bound.agent, invocation.rawInput, invocation.signal)
          const replaced = ensureCurrent(invocation)
          if (replaced !== undefined) return replaced
          dispatch({ type: 'open-overlay', overlay })
          return { kind: 'success' }
        },
      },
      {
        name: 'config', description: 'Show or update native DSH settings', input: { hint: '[NAMESPACE KEY=VALUE]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const raw = invocation.rawInput.trim()
          if (raw === '') return { kind: 'success', text: ctx.settings.describe({ redactSecrets: true }).map(item =>
            `${String(item.ns)}\n  value: ${configLayer(item.value)}\n  base: ${configLayer(item.base)}\n  user: ${configLayer(item.user)}`,
          ).join('\n') }
          const match = /^(\S+)\s+([^\s=]+)=(.*)$/su.exec(raw)
          if (match?.[1] === undefined || match[2] === undefined || match[3] === undefined) {
            return { kind: 'error', text: 'usage: /config [NAMESPACE KEY=VALUE]' }
          }
          const value = configValue(match[3])
          if (match[2].includes('.')) await ctx.settings.mutate(match[1], [{ op: 'set', path: match[2].split('.'), value }])
          else await ctx.settings.update(match[1], { [match[2]]: value })
          return { kind: 'success', text: `updated ${match[1]}.${match[2]}` }
        },
      },
      { name: 'login', description: 'List or start provider sign-in', input: { hint: '[KEY [METHOD]]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const values = invocation.rawInput.trim().split(/\s+/u).filter(Boolean)
          if (values.length === 0) return { kind: 'success', text: ctx.authorization.list().map(entry => `${String(entry.key)} · ${entry.label} · ${entry.methods.map(method => `${method.id}: ${method.label}`).join(', ')}${entry.inFlight ? ' · in progress' : ''}`).join('\n') || 'no authorization flows' }
          if (values.length > 2) return { kind: 'error', text: 'usage: /login [KEY [METHOD]]' }
          const entry = ctx.authorization.describe(parseCredentialKey(values[0]!))
          if (entry === undefined) return { kind: 'error', text: `no authorization flow for ${values[0]}` }
          const notices: string[] = []
          const outcome = await ctx.authorization.begin({ key: entry.key, ...(values[1] === undefined ? {} : { method: values[1] }), signal: invocation.signal,
            interaction: { notify: notice => {
              notices.push(notice.message, ...(notice.url === undefined ? [] : [notice.url]), ...(notice.code === undefined ? [] : [`Code: ${notice.code}`]))
              dispatch({ type: 'open-overlay', overlay: { kind: 'info', title: 'Login', lines: notices } })
            }, prompt: prompt => authorizationPrompt(bound, prompt, notices.join('\n')) },
          }).finally(() => { dispatch({ type: 'overlay-close' }) })
          return { kind: 'success', text: outcome.status === 'authorized' ? `signed in to ${entry.label}` : 'login cancelled' }
        },
      },
      { name: 'logout', description: 'List or forget provider credentials', input: { hint: '[KEY]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const raw = invocation.rawInput.trim()
          if (raw === '') return { kind: 'success', text: (await ctx.credentials.listRecords()).map(record => `${String(record.key)} · ${record.kind}`).join('\n') || 'no stored credentials' }
          if (/\s/u.test(raw)) return { kind: 'error', text: 'usage: /logout [KEY]' }
          await ctx.credentials.deleteRecord(parseCredentialKey(raw))
          return { kind: 'success', text: `signed out ${raw}` }
        },
      },
      {
        name: 'diff', description: 'Show working tree or last-turn file changes', input: { hint: '[turn]' }, handler: async (invocation) => {
          const invalid = ensureCurrent(invocation)
          if (invalid !== undefined) return invalid
          const mode = invocation.rawInput.trim()
          if (mode !== '' && mode !== 'turn') return { kind: 'error', text: 'usage: /diff [turn]' }
          dispatch({ type: 'open-overlay', overlay: await diffOverlay(ctx, bound.agent, bound.presenter, mode, lifetime.signal) })
          return { kind: 'success' }
        },
      },
      {
        name: 'plugins', description: 'List the running profile plugins',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          if (invocation.rawInput.trim() !== '') return { kind: 'error', text: 'usage: /plugins' }
          const servers = new Map<string, string>()
          for (const entry of ctx.loader.entries()) if (entry.options.name === '@deepseek-ai/dsh-mcp-client'
            && typeof entry.options.config?.serverName === 'string') servers.set(entry.id, entry.options.config.serverName)
          const snapshot = await (ctx.get('pluginInventory') as PluginInventoryGateway).list()
          return { kind: 'success', text: snapshot.entries.map(entry =>
            `${String(entry.entryId)} · ${entry.moduleName}${servers.has(String(entry.entryId)) ? ` · ${servers.get(String(entry.entryId))}` : ''} · ${entry.enabled ? 'enabled' : 'disabled'} · ${entry.fiberPhase ?? 'inactive'}`,
          ).join('\n') }
        },
      },
      {
        name: 'plugin', description: 'Run DSH profile plugin management', input: { hint: 'ARGS' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          if (invocation.rawInput.trim() === '') return { kind: 'error', text: 'usage: /plugin ARGS' }
          const command = `dsh plugin --profile ${quoteShellWord(decodeURIComponent(new URL(ctx.baseUrl!).pathname).split('/').at(-2)!)}${invocation.rawInput}`
          const [message, result] = await bound.agent.runMaintenance(signal => runHumanShell(ctx, bound.agent, command, signal, 'changes load on the next launch; exit and run dashi again'))
          bound.agent.inject(message)
          await ctx.sessions.flush(bound.agent.session)
          publish(bound)
          return result.exitCode === 0 ? { kind: 'success' } : { kind: 'error', text: `dsh plugin exited ${String(result.exitCode ?? result.signal ?? 'without status')}` }
        },
      },
      {
        name: 'new', description: 'Start a new session', input: { hint: '[--name TITLE]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const raw = invocation.rawInput.trim()
          const match = /^--name\s+(.+)$/su.exec(raw)
          if (raw !== '' && match === null) return { kind: 'error', text: 'usage: /new [--name TITLE]' }
          const title = match?.[1]?.trim()
          await runRootOperation({ kind: 'new', ...(title === undefined ? {} : { title }) })
          return { kind: 'success' }
        },
      },
      {
        name: 'clear', description: 'Start a new session',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/clear')
          if (invalid !== undefined) return invalid
          await runRootOperation({ kind: 'new' })
          return { kind: 'success' }
        },
      },
      {
        name: 'resume', description: 'Resume a session by name or ID, or open the picker', input: { hint: '[--all] [NAME|UUID]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const raw = invocation.rawInput.trim()
          const all = raw === '--all' || raw.startsWith('--all ')
          const value = all ? raw.slice('--all'.length).trim() : raw
          if (raw.startsWith('--') && !all) return { kind: 'error', text: 'usage: /resume [--all] [NAME|UUID]' }
          await runRootOperation(value === '' ? { kind: 'open-resume', ...(all ? { all: true } : {}) }
            : { kind: 'resume', sessionId: value, ...(all ? { all: true } : {}) })
          return { kind: 'success' }
        },
      },
      {
        name: 'fork', description: 'Fork at the latest completed turn',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/fork')
          if (invalid !== undefined) return invalid
          await runRootOperation({ kind: 'fork' })
          return { kind: 'success' }
        },
      },
      {
        name: 'rewind', description: 'Restore conversation or code at a prompt',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/rewind')
          if (invalid !== undefined) return invalid
          await runRootOperation({ kind: 'open-rewind' })
          return { kind: 'success' }
        },
      },
      {
        name: 'history', description: 'Browse loaded transcript cells',
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/history')
          if (invalid !== undefined) return invalid
          dispatch({ type: 'open-history' })
          return { kind: 'success' }
        },
      },
      {
        name: 'tasks', description: 'Show jobs and subagents, or kill a job', input: { hint: '[kill ID]' },
        handler: tasks,
      },
      {
        name: 'bashes', description: 'Alias of /tasks', input: { hint: '[kill ID]' },
        handler: tasks,
      },
      {
        name: 'subtask', description: 'Start a continuable child', input: { hint: 'TEXT' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const text = invocation.rawInput.trim()
          if (text === '') return { kind: 'error', text: 'usage: /subtask TEXT' }
          const started = await ctx.subagents.startContinuable({
            label: text, provider: 'spawn',
            request: { parent: bound.agent, prompt: [{ type: 'text', text }] },
            signal: invocation.signal,
          })
          return { kind: 'success', text: `subtask ${String(started.childId)} started` }
        },
      },
      {
        name: 'agents', description: 'Choose the native DSH agent preset',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/agents')
          if (invalid !== undefined) return invalid
          const blank = !bound.agent.session.snapshotEvents().some(event => event.type === 'turn/start')
          const selected = ctx.sessionProjections.stateOf(bound.agent.session, 'agentPreset')
            ?? ctx.agentPresets.defaultId
          dispatch({
            type: 'open-overlay',
            overlay: agentPresetOverlay(await ctx.agentPresets.list(), selected, blank),
          })
          return { kind: 'success' }
        },
      },
      {
        name: 'export', description: 'Export the current transcript as Markdown', input: { hint: '[path]' },
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const path = invocation.rawInput.trim() || `dashi-${bound.root.id}.md`
          const fs = ctx.fs
          const [cwd, target, inspection] = await Promise.all([
            fs.resolve('.', { cwd: bound.root.cwd, signal: lifetime.signal }),
            fs.resolve(path, { cwd: bound.root.cwd, signal: lifetime.signal }),
            ctx.sessionController.inspect(bound.agent.id, lifetime.signal),
          ])
          if (!fs.contains(cwd, target)) {
            return { kind: 'error', text: 'export path must be inside the session working directory' }
          }
          const content = markdownTranscript(
            bound.root.id, bound.root.cwd, bound.root.title,
            foldCells(inspection.events, bound.presenter),
          )
          await fs.writeText(target, content, undefined, lifetime.signal,
            ctx.sandboxPolicy.resolve({ session: bound.agent.session }))
          return { kind: 'success', text: `exported ${fs.processPath(target)}` }
        },
      },
      {
        name: 'copy', description: 'Copy an assistant response or code block', input: { hint: '[N|code]' },
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const raw = invocation.rawInput.trim()
          const selection = raw === '' ? 1 : raw === 'code' ? 'code' : Number(raw)
          if (raw !== '' && selection !== 'code' && (!/^[1-9]\d*$/u.test(raw) || !Number.isSafeInteger(selection))) {
            return { kind: 'error', text: 'usage: /copy [N|code]' }
          }
          dispatch({ selection, type: 'copy-assistant' })
          return { kind: 'success' }
        },
      },
      {
        name: 'rename', description: 'Rename the current session', input: { hint: 'TITLE' }, recordInput: false,
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const title = invocation.rawInput.trim()
          if (title === '') return { kind: 'error', text: 'usage: /rename TITLE' }
          const renamed = await ctx.sessionController.rename({ sessionId: bound.agent.id, title })
          await ctx.sessions.flush(bound.agent.session)
          bound.root = { ...bound.root, title: renamed.title }
          dispatch({ type: 'root-title', rootId: bound.root.id, title: renamed.title })
          return { kind: 'success', sourceEventSeq: SessionSeq(renamed.seq) }
        },
      },
      {
        name: 'model', description: 'Select the model and reasoning effort',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/model')
          if (invalid !== undefined) return invalid
          await openModel(bound)
          return { kind: 'success' }
        },
      },
      {
        name: 'init', description: 'Create a starter AGENTS.md',
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/init')
          if (invalid !== undefined) return invalid
          const target = await ctx.fs.resolve('AGENTS.md', { cwd: bound.root.cwd, signal: lifetime.signal })
          await ctx.fs.writeText(target, starterAgents(bound.root.cwd), { kind: 'createIfAbsent' }, lifetime.signal,
            ctx.sandboxPolicy.resolve({ session: bound.agent.session }))
          return { kind: 'success', text: `created ${ctx.fs.processPath(target)}` }
        },
      },
      {
        name: 'effort', description: 'Select the reasoning effort', input: { hint: 'LEVEL' },
        handler: async (invocation) => {
          const invalid = ensureCurrent(invocation)
          const effort = invocation.rawInput.trim()
          if (invalid !== undefined || effort === '') return invalid ?? { kind: 'error', text: 'usage: /effort LEVEL' }
          const selected = currentModel(ctx, bound.agent) ?? (await ctx.sessionController.modelCatalog()).default
          await activate({ kind: 'model', effort, model: selected.model, provider: selected.provider })
          return { kind: 'success' }
        },
      },
      {
        ...nativePermission,
        handler: async (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          if (invocation.rawInput.trim() === '') {
            openPermission(bound)
            return { kind: 'success' }
          }
          return nativePermission.handler(invocation)
        },
      },
      {
        name: 'queue', description: 'Queue one explicit next turn', input: { hint: 'TEXT' },
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const text = invocation.rawInput.trim()
          if (text === '') return { kind: 'error', text: 'usage: /queue TEXT' }
          bound.agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } }))
          return { kind: 'success', text: 'queued next turn' }
        },
      },
      {
        name: 'exit', description: 'Exit dashi',
        handler: (invocation) => {
          const stale = ensureCurrent(invocation)
          if (stale !== undefined) return stale
          const invalid = usage(invocation.rawInput, '/exit')
          if (invalid !== undefined) return invalid
          dispatch({ type: 'exit' })
          return { kind: 'success' }
        },
      },
    ]
    return [...definitions, ...([['quit', 'exit'], ['reset', 'clear'], ['continue', 'resume'], ['branch', 'fork']] as const)
      .map(([name, target]) => ({ ...definitions.find(definition => definition.name === target)!, name }))]
  }

  async function install(bound: Binding): Promise<void> {
    const id = bound.root.id
    const definitions = commandDefinitions(bound)
    const commandScope = bound.agent.ctx.inject(['commands'], (commandCtx) => {
      for (const definition of definitions) commandCtx.commands.register(definition)
    })
    await commandScope
    bound.commandScope = commandScope
    bound.disposers.push(
      ctx.on('agent/status', ({ agent, status }) => {
        if (agent !== bound.agent) return
        bound.root = { ...bound.root, status }
        dispatch({ type: 'root-status', rootId: id, status })
      }, { global: true }),
      ctx.on('agent/error', ({ agent, error }) => {
        if (agent === bound.agent) report(error, id)
      }, { global: true }),
      ctx.on('approval/request', (request, next) => {
        if (request.agent !== bound.agent) return next()
        const decisionId = `approval:${String(++decisionSequence)}`
        return decide<DshApprovalOutcome>({
          cursor: 0, id: decisionId, kind: 'approval',
          owner: { id, ...(bound.root.title === undefined ? {} : { label: bound.root.title }) },
          prompt: request.reason ?? `${request.toolName} requests wider access`, toolName: request.toolName,
        }, request.signal)
      }, { global: true }),
      ctx.on('user-questions/request', (request, next) => {
        if (request.agent !== bound.agent) return next()
        const decisionId = `question:${String(++decisionSequence)}`
        return decide<AskUserQuestionAnswer>({
          answers: [], cursor: 0, custom: '', id: decisionId, index: 0, kind: 'question',
          owner: { id, ...(bound.root.title === undefined ? {} : { label: bound.root.title }) },
          questions: request.questions.map(question => ({
            id: question.id, multiSelect: question.multiSelect ?? false,
            options: (question.options ?? []).map(option => ({ ...option })), question: question.question,
            ...(question.detail === undefined ? {} : { detail: question.detail }),
            ...(question.header === undefined ? {} : { header: question.header }),
            ...(question.intent === undefined ? {} : { intent: question.intent }),
          })),
          selected: [],
        }, request.signal).then(answer => ({ answers: answer.answers.map(item => ({
          id: item.id, selected: [...item.selected],
          ...(item.custom === undefined ? {} : { custom: item.custom }),
        })) }))
      }, { global: true }),
      ctx.on('agent/disposed', ({ agent }) => {
        if (agent === bound.agent) bound.abort.abort()
      }, { global: true }),
    )
  }

  async function stop(bound: Binding): Promise<void> {
    bound.abort.abort()
    if (bound.timer !== undefined) clearTimeout(bound.timer)
    bound.timer = undefined
    if (bound.presentationTimer !== undefined) clearTimeout(bound.presentationTimer)
    bound.presentationTimer = undefined
    for (const dispose of bound.disposers.splice(0).reverse()) dispose()
    await bound.commandScope?.dispose()
    await bound.pump
    await bound.controlPump
  }

  await install(binding)
  if (options.model !== undefined || options.effort !== undefined) {
    const catalog = await ctx.sessionController.modelCatalog()
    const currentSelection = currentModel(ctx, binding.agent) ?? catalog.default
    const model = options.model ?? currentSelection.model
    const candidates = catalog.groups.filter(group => group.models.some(item => item.id === model))
    if (options.provider === undefined && candidates.length > 1) {
      throw new Error(`model "${model}" is available from multiple providers: ${candidates.map(group => group.id).join(', ')}; pass --provider`)
    }
    const result = await ctx.sessionController.selectModel({
      sessionId: binding.agent.id,
      model,
      provider: options.provider ?? candidates[0]?.id ?? currentSelection.provider,
      ...(options.effort === undefined ? {} : { reasoningEffort: options.effort }),
    })
    const { effort: _previousEffort, ...root } = binding.root
    binding.root = {
      ...root, model: result.selected.model, provider: result.selected.provider,
      ...(result.selected.reasoningEffort === undefined ? {} : { effort: result.selected.reasoningEffort }),
    }
  }
  if (options.permission !== undefined) {
    const execution = await ctx.commands.execute(
      binding.agent, `/permission ${options.permission}`, [], lifetime.signal,
    )
    if (execution === undefined) throw new Error('DSH supplied no /permission command')
    if (execution.result.kind === 'error') throw new Error(execution.result.text ?? 'permission change failed')
    binding.root = { ...binding.root, permission: options.permission }
  }
  tuiRoot.bind(binding.agent)

  const activate = async (value: ActivatableOverlayValue): Promise<void> => {
    try {
      const bound = current()
      switch (value.kind) {
        case 'fork':
        case 'new':
        case 'open-resume':
        case 'open-rewind':
        case 'resume':
        case 'rewind':
          await runRootOperation(value)
          break
        case 'rewind-boundary':
          dispatch({ type: 'open-overlay', overlay: rewindActionOverlay(value) })
          break
        case 'search-result': {
          if (bound.root.id !== value.rootId) return
          const window = await ctx.sessionQuery.readEvent({
            seq: SessionSeq(value.seq), sessionId: SessionId(value.sessionId),
          }, lifetime.signal)
          const prompt = humanPrompt(window.target)
          if (prompt === undefined) throw new Error('the selected result is not a direct human prompt')
          if (current() !== bound) return
          dispatch({ type: 'composer-set', text: prompt })
          break
        }
        case 'agent-preset': {
          const blank = !bound.agent.session.snapshotEvents().some(event => event.type === 'turn/start')
          if (blank) {
            await ctx.agentPresets.select(bound.agent, value.preset)
            await ctx.sessions.flush(bound.agent.session)
          } else {
            await runRootOperation({ agentPreset: value.preset, kind: 'new' })
          }
          break
        }
        case 'job-output': {
          const result = ctx.jobs.read(JobId(value.jobId), bound.agent)
          dispatch({ type: 'open-overlay', overlay: {
            cells: [{ key: `job:${value.jobId}`, kind: 'outcome', text: result.text }],
            kind: 'info', lines: [], title: `Job ${value.jobId} · ${result.snapshot.status}`,
          } })
          break
        }
        case 'model': {
          const result = await ctx.sessionController.selectModel({
            sessionId: bound.agent.id, model: value.model, provider: value.provider,
            ...(value.effort === undefined ? {} : { reasoningEffort: value.effort }),
          })
          const { effort: _oldEffort, ...root } = bound.root
          bound.root = {
            ...root, model: result.selected.model, provider: result.selected.provider,
            ...(result.selected.reasoningEffort === undefined ? {} : { effort: result.selected.reasoningEffort }),
          }
          dispatch({
            type: 'root-model', rootId: bound.root.id,
            model: result.selected.model, provider: result.selected.provider,
            ...(result.selected.reasoningEffort === undefined ? {} : { effort: result.selected.reasoningEffort }),
          })
          break
        }
        case 'permission': {
          const accepted = await executeAccepted(bound, `/permission ${value.preset}`, [], execution => {
            if (execution.result.kind === 'error') throw new Error(execution.result.text ?? 'permission change failed')
            bound.root = { ...bound.root, permission: value.preset }
            dispatch({ type: 'root-permission', preset: value.preset, rootId: bound.root.id })
          })
          if (!accepted) throw new Error('DSH supplied no /permission command')
        }
      }
    } catch (error) {
      report(error)
    }
  }

  return {
    initialAttachments,
    get initialCells() { return transcriptCells(current()) },
    get initialHasMore() { return current().hasMore },
    get initialPrompts() { return humanPrompts(current().events) },
    get root() { return current().root },
    get summary() { return `Resume with: dsh --profile dashi --resume ${current().root.id}` },
    activate,
    async attach(path) {
      try {
        return (await readDraftImages(current().root.cwd, [path]))[0]
      } catch (error) {
        report(error)
      }
    },
    async complete(query, caret) {
      try {
        const bound = current()
        return await completionOptions(ctx, bound.agent, query, caret, lifetime.signal)
      } catch (error) {
        report(error)
        return []
      }
    },
    async cyclePermission() {
      try {
        const bound = current()
        const names = ctx.permissionPresets.names
        if (names.length === 0) throw new Error('no permission presets available')
        const index = names.indexOf(ctx.permissionPresets.current(bound.agent.session))
        const preset = names[(index + 1 + names.length) % names.length]
        if (preset === undefined) return
        const spec = ctx.permissionPresets.resolve(preset)
        if (spec.approval === 'never') {
          dispatch({ type: 'open-overlay', overlay: {
            acceptLabel: 'Enable',
            cursor: 1,
            detail: [`Sandbox: ${spec.sandbox}`, `Approval: ${spec.approval}`],
            kind: 'confirm',
            title: `Enable ${ctx.permissionPresets.optionOf(preset).name}?`,
            value: { kind: 'permission', preset },
          } })
        } else {
          await activate({ kind: 'permission', preset })
        }
      } catch (error) {
        report(error)
      }
    },
    interrupt() {
      const agent = current().agent
      if (accepting && agent.status === 'running') agent.cancel({ kind: 'user' }, { keepInbox: true })
    },
    async loadHistory(rootId) {
      const bound = current()
      if (bound.root.id !== rootId || !bound.hasMore) return
      try {
        const first = bound.events[0]
        if (first === undefined) throw new Error('DSH reported earlier history without an opening event')
        const page = await ctx.sessionController.page({
          address: { kind: 'session', sessionId: bound.agent.id },
          beforeSeq: first.seq,
          maxMessages: 50,
          throughSeq: bound.cursor,
        }, lifetime.signal)
        if (current() !== bound) return
        const older = eventsFromRecords(page.records)
        if (older.length === 0 && page.hasMore) throw new Error('DSH returned an empty non-final history page')
        bound.events.unshift(...older)
        bound.hasMore = page.hasMore
        dispatch({
          type: 'history-page', cells: transcriptCells(bound),
          hasMore: bound.hasMore, rootId,
        })
      } catch (error) {
        if (!lifetime.signal.aborted) report(error, rootId)
      }
    },
    async search(query, rootId) {
      try {
        const bound = current()
        if (bound.root.id !== rootId) return
        const page = await ctx.sessionQuery.searchSessions({
          query,
          sessionFilters: [{ kind: 'cwd', values: [bound.root.cwd] }],
          eventFilters: [
            { kind: 'type', values: ['user/message'] },
            { kind: 'surface', values: ['current'] },
          ],
          limit: 20,
        }, { signal: lifetime.signal })
        if (current() !== bound) return
        dispatch({ type: 'open-overlay', overlay: searchOverlay(page.items, rootId) })
      } catch (error) {
        if (!lifetime.signal.aborted) report(error, rootId)
      }
    },
    shutdown() {
      if (shutdown !== undefined) return shutdown
      accepting = false
      lifetime.abort()
      const bound = current()
      shutdown = (async () => {
        if (bound.agent.status === 'running') bound.agent.cancel({ kind: 'user' }, { keepInbox: true })
        await bound.agent.whenIdle()
        if (ctx.sessions.get(bound.agent.id) === bound.agent.session) await ctx.sessions.flush(bound.agent.session)
        tuiRoot.clear(bound.agent)
        await stop(bound)
      })()
      return shutdown
    },
    start() {
      if (started) return
      started = true
      binding.pump = follow(binding)
      binding.controlPump = followControl(binding)
    },
    async submit(text, mode, attachments) {
      if (!accepting) return
      const bound = current()
      try {
        if (text.startsWith('!')) {
          const command = text.slice(1).trim()
          if (command === '') throw new Error('usage: !command')
          if (attachments.length > 0) throw new Error('!command does not accept image attachments')
          await bound.agent.runMaintenance(async signal => {
            const [message] = await runHumanShell(ctx, bound.agent, command, signal)
            bound.agent.inject(message)
            await ctx.sessions.flush(bound.agent.session)
          })
          publish(bound)
          return
        }
        if (await executeAccepted(bound, text, encodeDraftImages(attachments))) return
        const refs = await admitDraftImages(ctx.attachments, attachments)
        const content: ContentBlock[] = [
          ...(text === '' ? [] : [{ type: 'text' as const, text }]),
          ...refs.map(attachment => ({ type: 'image' as const, attachment })),
        ]
        const message = createUserMessage({ content, source: { kind: 'user' } })
        if (mode === 'steer') bound.agent.steer(message)
        else bound.agent.followup(message)
      } catch (error) {
        if (!lifetime.signal.aborted) report(error, bound.root.id)
      }
    },
  }
}
