import { readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { exitOnStdinEnd, type AppExit, type AppReady, type CmdlineArgs } from '@deepseek-ai/dsh-cmdline'
import { createTerminalShell, type TerminalShell } from './application.js'
import { sessionOverlay } from './catalogs.js'
import { readClipboardImage } from './clipboard-image.js'
import { editDraftExternally } from './external-editor.js'
import {
  formatSessionList, isSessionId, parseSessionListArgs, sessionMatches, sessionNotFound, type SessionListOptions,
} from './session-list.js'
import { createSessionRuntime, type RootLaunchOptions, type SessionRuntime } from './session-runtime.js'
import { TuiRoot } from './tui-root.js'

export const name = 'dashi'
export const inject = [
  'agentPresets', 'agents', 'attachments', 'cmdlineArgs', 'commands', 'fs', 'permissionPresets', 'sessionController',
  'sandboxPolicy', 'sessionProjections', 'sessionQuery', 'sessions', 'shell', 'skills', 'tools',
]
const validatedVersions = JSON.parse(readFileSync(new URL('../validated-dsh-versions.json', import.meta.url), 'utf8')) as string[]

interface ParsedArgs extends Omit<RootLaunchOptions, 'cwd'> {
  readonly accessible: boolean
  readonly inline: boolean
  readonly resumeAll: boolean; readonly resumePicker: boolean
}

function parseArgs(args: readonly string[]): ParsedArgs | undefined {
  let accessible = false
  let inline = true
  let name: string | undefined
  let resume: string | undefined
  let resumeAll = false
  let resumePicker = false
  let useContinue = false
  const images: string[] = []
  const prompt: string[] = []
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    if (argument === '--accessible') accessible = true
    else if (argument === '--inline') inline = true
    else if (argument === '--fullscreen') inline = false
    else if (argument === '--name' || argument === '--image') {
      const value = args[++index]
      if (value === undefined || value === '') return undefined
      if (argument === '--name') name = value
      else images.push(value)
    } else if (argument === '--resume' || argument === '-r') {
      const value = args[index + 1]
      if (value === '') return undefined
      if (value === undefined || value.startsWith('-')) resumePicker = true
      else resume = args[++index]
    } else if (argument === '--all') resumeAll = true
    else if (argument === '--continue' || argument === '-c') useContinue = true
    else if (argument?.startsWith('-') === true) return undefined
    else if (argument !== undefined) prompt.push(argument)
  }
  if (resume !== undefined && (resumePicker || useContinue) || resumePicker && useContinue
    || name !== undefined && (resume !== undefined || resumePicker || useContinue)
    || resumeAll && resume === undefined && !resumePicker || resumeAll && useContinue) return undefined
  return {
    accessible,
    continue: useContinue,
    inline,
    resumeAll,
    resumePicker,
    ...(images.length === 0 ? {} : { images }),
    ...(name === undefined ? {} : { name }),
    ...(prompt.length === 0 ? {} : { prompt: prompt.join(' ') }),
    ...(resume === undefined ? {} : { resume }),
  }
}

function packageVersion(path: string): string {
  const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : 'unknown'
}

function runningDshVersions(): readonly [string, string] {
  try {
    const entry = realpathSync(process.argv[1] ?? '')
    const manifest = resolve(dirname(entry), '../package.json')
    const version = packageVersion(manifest)
    try {
      return [version, packageVersion(createRequire(manifest).resolve('@deepseek-ai/dsh-base/package.json'))]
    } catch {
      return [version, 'unknown']
    }
  } catch {
    return ['unknown', 'unknown']
  }
}

function warnDshVersion(): void {
  const [version, baseVersion] = runningDshVersions()
  if (baseVersion !== version) {
    process.stderr.write(`dashi: warning: DSH ${version} loads @deepseek-ai/dsh-base ${baseVersion}; versions must match\n`)
  }
  if (!validatedVersions.includes(version)) {
    process.stderr.write(`dashi: warning: DSH ${version} is not validated; validated: ${validatedVersions.join(', ')}\n`)
  }
}

function installSessionList(ctx: Context, options: SessionListOptions, ready: AppReady, exit: AppExit): void {
  const abort = new AbortController()
  let listing: Promise<void> | undefined
  const announce = ready.onReady(() => {
    warnDshVersion()
    listing = ctx.sessionController.list({}, abort.signal).then(({ items }) => {
      const cwd = options.all ? undefined : resolve(options.cwd ?? process.cwd())
      process.stdout.write(`${formatSessionList(items, cwd, options.json)}\n`)
      exit(0)
    }).catch((error: unknown) => {
      process.stderr.write(`dashi: sessions list failed: ${error instanceof Error ? error.message : String(error)}\n`)
      exit(1)
    })
  })
  ctx.effect(() => async () => {
    announce()
    abort.abort()
    await listing
  }, 'dashi.sessions-list')
}

export function apply(ctx: Context): void {
  const exit = ctx.get('appExit') as AppExit | undefined
  const ready = ctx.get('appReady') as AppReady | undefined
  const cmdline = ctx.get('cmdlineArgs') as CmdlineArgs | undefined
  if (exit === undefined || ready === undefined || cmdline === undefined) {
    throw new Error('dashi: the launcher must provide ctx.appExit, ctx.appReady, and ctx.cmdlineArgs')
  }
  const args = cmdline.get()
  if (args[0] === 'sessions') {
    const options = parseSessionListArgs(args)
    if (options === undefined) {
      process.stderr.write(`dashi: unsupported arguments: ${args.join(' ')}\n`)
      exit(2)
      return
    }
    installSessionList(ctx, options, ready, exit)
    return
  }
  const parsed = parseArgs(args)
  if (parsed === undefined) {
    process.stderr.write(`dashi: unsupported arguments: ${args.join(' ')}\n`)
    exit(2)
    return
  }

  const tuiRoot = new TuiRoot(ctx)
  let shell: TerminalShell | undefined
  let runtime: SessionRuntime | undefined
  let boot: Promise<void> | undefined
  const stdoutError = (error: Error): void => { void shell?.fail(error) }
  process.stdout.on('error', stdoutError)
  const changed = ctx.on('tui/root-changed', (_previous, current) => {
    if (current === undefined) shell?.dispatch({ type: 'root-cleared' })
  })
  const announce = ready.onReady(() => {
    warnDshVersion()
    boot = (async () => {
      const cwd = process.cwd()
      const makeRuntime = (options: RootLaunchOptions): Promise<SessionRuntime> => createSessionRuntime(
        ctx, options, tuiRoot, action => { shell?.dispatch(action) }, {
          cancel: id => { shell?.cancelDecision(id) },
          request: decision => shell?.requestDecision(decision)
            ?? Promise.reject(new Error('dashi terminal is not ready')),
        },
      )
      const sendPrompt = (): void => {
        if (parsed.prompt !== undefined) shell?.dispatch({ type: 'composer-changed', text: parsed.prompt })
        if (parsed.prompt !== undefined) shell?.dispatch({ type: 'submit' })
      }
      let pickerItems = parsed.resumePicker
        ? (await ctx.sessionController.list({}, new AbortController().signal)).items : undefined
      if (parsed.resume !== undefined && !isSessionId(parsed.resume)) {
        const matches = sessionMatches(
          (await ctx.sessionController.list({}, new AbortController().signal)).items,
          parsed.resume, parsed.resumeAll ? undefined : cwd,
        )
        const [match] = matches
        if (match === undefined) throw sessionNotFound(parsed.resume)
        if (matches.length > 1) pickerItems = matches
        else runtime = await makeRuntime({ ...parsed, cwd, resume: String(match.sessionId) })
      } else if (!parsed.resumePicker) runtime = await makeRuntime({ ...parsed, cwd })
      const initial = runtime
      shell = createTerminalShell({
        accessible: parsed.accessible,
        activateOverlay: async value => {
          if (runtime !== undefined) return runtime.activate(value)
          if (value.kind !== 'resume') return
          runtime = await makeRuntime({ ...parsed, continue: false, cwd, resume: value.sessionId })
          shell?.dispatch({ type: 'root-bound', cells: runtime.initialCells, hasMore: runtime.initialHasMore,
            prompts: runtime.initialPrompts, root: runtime.root })
          for (const attachment of runtime.initialAttachments) shell?.dispatch({ type: 'attachment-added', attachment })
          runtime.start()
          sendPrompt()
        },
        attach: path => runtime?.attach(path) ?? Promise.resolve(undefined),
        beforeExit: () => runtime?.shutdown() ?? Promise.resolve(),
        complete: (query, caret) => runtime?.complete(query, caret) ?? Promise.resolve([]),
        cwd,
        cyclePermission: () => runtime?.cyclePermission() ?? Promise.resolve(),
        exit,
        externalEdit: editDraftExternally,
        ...(initial === undefined ? {} : {
          initialAttachments: initial.initialAttachments, initialCells: initial.initialCells, initialHasMore: initial.initialHasMore,
          initialPrompts: initial.initialPrompts, initialRoot: initial.root,
        }),
        inline: parsed.inline || parsed.accessible,
        interrupt: () => { runtime?.interrupt() },
        loadHistory: rootId => runtime?.loadHistory(rootId) ?? Promise.resolve(),
        onReleased: () => { process.stdout.write(`${runtime?.summary ?? ''}\n`) },
        pasteImage: readClipboardImage,
        search: (query, rootId) => runtime?.search(query, rootId) ?? Promise.resolve(),
        submit: (text, mode, attachments) => runtime?.submit(text, mode, attachments),
      })
      shell.start()
      if (pickerItems !== undefined) {
        shell.dispatch({ type: 'open-overlay', overlay: sessionOverlay(pickerItems, '', parsed.resumeAll ? undefined : cwd) })
      } else {
        runtime?.start()
        sendPrompt()
      }
    })().catch(async (error: unknown) => {
      process.stderr.write(`dashi: startup failed: ${error instanceof Error ? error.message : String(error)}\n`)
      await runtime?.shutdown()
      await shell?.dispose()
      exit(1)
    })
  })
  ctx.effect(() => async () => {
    announce()
    changed()
    await boot
    await runtime?.shutdown()
    await shell?.dispose()
    process.stdout.off('error', stdoutError)
  }, 'dashi.profile-boot')
  exitOnStdinEnd(ctx, 'dashi.stdin')
}
