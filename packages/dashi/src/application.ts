import { createRenderer, type Renderer } from './renderer.js'
import { runEditor } from './external-editor.js'
import {
  initialViewState,
  type ActivatableOverlayValue,
  reduce,
  type DecisionAnswer,
  type DraftAttachment,
  type PendingDecision,
  type OverlayOption,
  type UiAction,
  type UiEffect,
  type ViewState,
} from './state.js'
import { createTerminalGuard, type TerminalGuard } from './terminal-guard.js'

export interface ShellBindings {
  readonly dispatch: (action: UiAction) => void
  readonly readState: () => ViewState
}

export interface TerminalShellOptions {
  readonly accessible?: boolean
  readonly beforeExit?: () => Promise<void>
  readonly activateOverlay?: (value: ActivatableOverlayValue) => Promise<void>
  readonly attach?: (path: string) => Promise<DraftAttachment | undefined>
  readonly complete?: (query: string, caret: number) => Promise<readonly OverlayOption[]>
  readonly createView?: (bindings: ShellBindings) => Renderer
  readonly cyclePermission?: () => Promise<void>
  readonly cwd: string
  readonly exit: (code: number) => void
  readonly externalEdit?: (text: string, cwd: string) => Promise<string>
  readonly initialAttachments?: readonly DraftAttachment[]
  readonly initialCells?: ViewState['cells']
  readonly initialHasMore?: boolean
  readonly initialPrompts?: ViewState['prompts']
  readonly initialRoot?: ViewState['root']
  readonly interrupt?: () => void
  readonly inline: boolean
  readonly loadHistory?: (rootId: string) => Promise<void>
  readonly onReleased?: () => void
  readonly pasteImage?: () => Promise<DraftAttachment>
  readonly search?: (query: string, rootId: string) => Promise<void>
  readonly submit?: (text: string, mode: 'next-turn' | 'steer', attachments: readonly DraftAttachment[]) => Promise<void> | void
  readonly suspend?: () => Promise<void>
  readonly writeError?: (message: string) => void
}

export interface TerminalShell {
  cancelDecision(id: string): void
  dispatch(action: UiAction): void
  dispose(): Promise<void>
  fail(error: unknown): Promise<void>
  readState(): ViewState
  requestDecision(decision: PendingDecision): Promise<DecisionAnswer>
  start(): void
  whenIdle(): Promise<void>
}

function suspendProcess(): Promise<void> {
  return new Promise((resolve, reject) => {
    const resumed = (): void => { resolve() }
    process.once('SIGCONT', resumed)
    try {
      process.kill(process.pid, 'SIGTSTP')
    } catch (error) {
      process.off('SIGCONT', resumed)
      reject(error)
    }
  })
}

export function createTerminalShell(options: TerminalShellOptions): TerminalShell {
  let state = initialViewState(
    options.cwd, options.inline, options.initialRoot, options.initialCells, options.initialPrompts,
    options.initialHasMore,
    options.initialAttachments,
  )
  let accepting = true
  let failed = false
  let queue = Promise.resolve()
  const pending = new Map<string, {
    readonly kind: PendingDecision['kind']
    readonly reject: (reason: unknown) => void
    readonly resolve: (answer: DecisionAnswer) => void
  }>()
  const bindings: ShellBindings = {
    dispatch: action => { dispatch(action) },
    readState: () => state,
  }
  const renderer = options.createView?.(bindings) ?? createRenderer({
    ...bindings, ...(options.accessible === undefined ? {} : { accessible: options.accessible }), inline: options.inline,
  })
  const guard: TerminalGuard = createTerminalGuard(renderer)
  const writeError = options.writeError ?? (message => { process.stderr.write(message) })
  let exitTimer: ReturnType<typeof setTimeout> | undefined
  let released = false

  const release = async (): Promise<void> => {
    if (exitTimer !== undefined) clearTimeout(exitTimer)
    exitTimer = undefined
    await guard.dispose()
    if (released) return
    released = true
    options.onReleased?.()
  }

  async function run(effect: UiEffect): Promise<void> {
    switch (effect.type) {
      case 'activate-overlay':
        if (effect.value.kind === 'open-file') {
          const path = effect.value.path
          await guard.withCookedTerminal(() => runEditor(process.env.EDITOR?.trim() || 'vi', path, options.cwd)).catch(error => {
            dispatch({ type: 'runtime-error', message: error instanceof Error ? error.message : String(error) })
          })
        } else await options.activateOverlay?.(effect.value)
        return
      case 'attach': {
        try {
          const attachment = await options.attach?.(effect.path)
          if (attachment !== undefined) dispatch({
            type: 'attachment-added', attachment, source: effect.source, text: effect.text,
          })
        } catch (error) {
          dispatch({ type: 'runtime-error', message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'bell':
        if (options.accessible !== true) renderer.bell()
        return
      case 'clipboard-image': {
        try {
          const attachment = await options.pasteImage?.()
          if (attachment !== undefined) dispatch({ type: 'attachment-added', attachment })
        } catch (error) {
          dispatch({ type: 'runtime-error', message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'complete': {
        const items = await options.complete?.(effect.query, effect.caret) ?? []
        dispatch({ type: 'completion-ready', options: items, query: effect.query })
        return
      }
      case 'copy': {
        const result = renderer.copy(effect.text)
        if (result === 'too-large') dispatch({ type: 'runtime-error', message: 'Copy is limited to 64 KiB.' })
        else if (result === 'unsupported') dispatch({ type: 'runtime-error', message: 'This terminal does not support OSC 52 copy.' })
        return
      }
      case 'cycle-permission':
        await options.cyclePermission?.()
        return
      case 'exit':
        accepting = false
        await options.beforeExit?.()
        await release()
        options.exit(0)
        return
      case 'exit-timer':
        if (exitTimer !== undefined) clearTimeout(exitTimer)
        exitTimer = effect.armed ? setTimeout(() => { dispatch({ type: 'disarm-exit' }) }, 1_500) : undefined
        return
      case 'external-edit': {
        try {
          let edited: string | undefined
          await guard.withCookedTerminal(async () => {
            edited = await options.externalEdit?.(effect.text, effect.cwd)
          })
          if (edited !== undefined) dispatch({ type: 'composer-set', text: edited })
        } catch (error) {
          dispatch({ type: 'runtime-error', message: error instanceof Error ? error.message : String(error) })
        }
        return
      }
      case 'interrupt':
        options.interrupt?.()
        return
      case 'load-history':
        await options.loadHistory?.(effect.rootId)
        return
      case 'redraw':
        renderer.render(effect.force)
        return
      case 'reject-decision': {
        const settlement = pending.get(effect.id)
        if (settlement === undefined) return
        pending.delete(effect.id)
        if (settlement.kind === 'approval') {
          settlement.resolve(effect.reason === 'terminal' ? 'rejected' : 'cancelled')
        } else {
          const error = new Error(effect.reason === 'terminal'
            ? 'the terminal closed before the user answered'
            : 'the question was withdrawn before the user answered') as Error & { code: string }
          error.name = 'UserQuestionError'
          error.code = effect.reason === 'terminal' ? 'ASK_CANCELLED' : 'ASK_ABORTED'
          settlement.reject(error)
        }
        return
      }
      case 'set-composer':
        renderer.setComposer(effect.text, effect.cursor)
        return
      case 'search':
        await options.search?.(effect.query, effect.rootId)
        return
      case 'settle-decision': {
        const settlement = pending.get(effect.id)
        if (settlement === undefined) return
        pending.delete(effect.id)
        settlement.resolve(effect.answer)
        return
      }
      case 'submit':
        await options.submit?.(effect.text, effect.mode, effect.attachments)
        return
      case 'suspend':
        await guard.withCookedTerminal(options.suspend ?? suspendProcess)
    }
  }

  async function fail(error: unknown): Promise<void> {
    if (failed) return
    failed = true
    accepting = false
    renderer.discardSecretComposer()
    const detail = error instanceof Error ? error.stack ?? error.message : String(error)
    writeError(`dashi: terminal failure\n${detail}\n`)
    try {
      const [next, effects] = reduce(state, { type: 'terminal-lost' })
      state = next
      for (const effect of effects) await run(effect)
      try {
        await options.beforeExit?.()
      } catch (cleanupError) {
        const cleanupDetail = cleanupError instanceof Error
          ? cleanupError.stack ?? cleanupError.message
          : String(cleanupError)
        writeError(`dashi: cleanup failure\n${cleanupDetail}\n`)
      }
      await release()
    } finally {
      options.exit(1)
    }
  }

  function dispatch(action: UiAction): void {
    if (!accepting) return
    const question = state.decisions[0]?.kind === 'question' ? state.decisions[0].questions[state.decisions[0].index] : undefined
    if (question?.secret === true && ['decision-submit', 'decision-cancel', 'decision-withdrawn', 'escape', 'terminal-lost'].includes(action.type)) renderer.discardSecretComposer()
    const [next, effects] = reduce(state, action)
    state = next
    if (effects.length === 0) return
    queue = queue.then(async () => {
      for (const effect of effects) await run(effect)
    }).catch(fail)
  }

  async function whenIdle(): Promise<void> {
    for (;;) {
      const observed = queue
      await observed
      if (queue === observed) return
    }
  }

  return {
    cancelDecision(id) {
      dispatch({ type: 'decision-withdrawn', id })
    },
    dispatch,
    async dispose() {
      renderer.discardSecretComposer()
      const [next, effects] = reduce(state, { type: 'terminal-lost' })
      state = next
      for (const effect of effects) await run(effect)
      accepting = false
      await queue
      try {
        await options.beforeExit?.()
      } finally {
        await release()
      }
    },
    fail,
    readState: () => state,
    requestDecision(decision) {
      if (!accepting) return Promise.reject(new Error('dashi terminal is closing'))
      if (pending.has(decision.id)) return Promise.reject(new Error(`duplicate decision ${decision.id}`))
      let resolve!: (answer: DecisionAnswer) => void
      let reject!: (reason: unknown) => void
      const promise = new Promise<DecisionAnswer>((accept, decline) => {
        resolve = accept
        reject = decline
      })
      pending.set(decision.id, { kind: decision.kind, reject, resolve })
      dispatch({ type: 'decision-enqueued', decision })
      return promise
    },
    start() {
      try {
        guard.start()
        renderer.render(true)
      } catch (error) {
        void fail(error)
      }
    },
    whenIdle,
  }
}
