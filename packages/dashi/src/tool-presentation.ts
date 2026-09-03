import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolResult, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { ToolCard, ToolDiff } from './state.js'

const HEAD_LINES = 12
const TAIL_LINES = 8
const MAX_LINE_CHARS = 2_000

export interface PresentedCall {
  readonly args: unknown
  readonly card: ToolCard
}

export interface ToolPresenter {
  call(name: string, rawArguments: string): PresentedCall
  result(name: string, args: unknown, result: ToolResult, prior: ToolCard): ToolCard
}

function short(value: string): string {
  const chars = [...value]
  return chars.length <= MAX_LINE_CHARS ? value : `${chars.slice(0, MAX_LINE_CHARS).join('')}…`
}

/** Bound a card body without hiding how much was omitted. */
export function boundedBody(text: string): string {
  const lines = text.replaceAll('\r\n', '\n').split('\n').map(short)
  if (lines.length <= HEAD_LINES + TAIL_LINES) return lines.join('\n')
  const omitted = lines.length - HEAD_LINES - TAIL_LINES
  return [...lines.slice(0, HEAD_LINES), `… ${omitted} lines omitted …`, ...lines.slice(-TAIL_LINES)].join('\n')
}

function blockText(blocks: readonly ContentBlock[]): string {
  return blocks.map((block) => {
    if (block.type === 'text' || block.type === 'reasoning') return block.text
    if (block.type === 'image') return '[image]'
    return `[${String((block as { type?: unknown }).type ?? 'content')}]`
  }).join('\n')
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, undefined, 2) ?? ''
  } catch {
    return '[unrenderable input]'
  }
}

function decode(raw: string): unknown {
  try {
    return raw === '' ? {} : JSON.parse(raw)
  } catch {
    return raw
  }
}

function generic(title: string, body = ''): ToolCard {
  return { card: 'generic', title: short(title), ...(body === '' ? {} : { body: boundedBody(body) }) }
}

function lines(text: string): string[] {
  const normalized = text.replaceAll('\r\n', '\n')
  const values = normalized.split('\n')
  if (values.at(-1) === '') values.pop()
  return values
}

function compactDiff(path: string, oldText: string | null, newText: string): ToolDiff {
  const before = oldText === null ? [] : lines(oldText)
  const after = lines(newText)
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < before.length - prefix && suffix < after.length - prefix
    && before[before.length - suffix - 1] === after[after.length - suffix - 1]) suffix++
  const removed = before.length - prefix - suffix
  const added = after.length - prefix - suffix
  const contextBefore = before.slice(Math.max(0, prefix - 3), prefix).map(value => `  ${value}`)
  const removedLines = before.slice(prefix, before.length - suffix).map(value => `- ${value}`)
  const addedLines = after.slice(prefix, after.length - suffix).map(value => `+ ${value}`)
  const contextAfter = before.slice(before.length - suffix, before.length - suffix + 3).map(value => `  ${value}`)
  return {
    added,
    lines: boundedBody([...contextBefore, ...removedLines, ...addedLines, ...contextAfter].join('\n')).split('\n'),
    path: short(path),
    removed,
  }
}

function diffs(view: Extract<ToolCallView | ToolResultView, { card: 'diff' }>): readonly ToolDiff[] {
  return view.diffs.slice(0, 50).map(diff => compactDiff(diff.path, diff.oldText, diff.newText))
}

function callCard(view: ToolCallView): ToolCard {
  switch (view.card) {
    case 'generic': {
      const body = [view.content === undefined ? '' : blockText(view.content),
        view.rawInput === undefined ? '' : displayValue(view.rawInput)].filter(Boolean).join('\n')
      return { ...generic(view.title, body), card: 'generic' }
    }
    case 'terminal':
      return {
        card: 'terminal', title: short(view.title),
        ...(view.description === undefined ? {} : { body: boundedBody(view.description) }),
        ...(view.cwd === undefined ? {} : { status: `cwd ${short(view.cwd)}` }),
      }
    case 'diff': return { card: 'diff', title: short(view.title), diffs: diffs(view) }
  }
}

function searchBody(view: Extract<ToolResultView, { card: 'search' }>): string {
  if (view.shape === 'paths') return view.paths.join('\n')
  return view.files.flatMap(file => [file.path, ...file.matches.map(match => `${match.lineNumber}: ${match.line}`)]).join('\n')
}

function resultCard(view: ToolResultView, prior: ToolCard, raw: string): ToolCard {
  const title = short(view.title ?? prior.title)
  switch (view.card) {
    case 'generic': return generic(title, view.content === undefined ? raw : blockText(view.content))
    case 'terminal':
      return {
        card: 'terminal', title,
        ...((view.output ?? raw) === '' ? {} : { body: boundedBody(view.output ?? raw) }),
        ...(view.exitCode === undefined && view.signal === undefined ? {} : {
          status: view.exitCode === undefined ? `signal ${short(view.signal ?? '')}` : `exit ${String(view.exitCode)}`,
        }),
      }
    case 'diff': return { card: 'diff', title, diffs: diffs(view) }
    case 'search': return {
      card: 'search', title, body: boundedBody(searchBody(view)),
      status: `${String(view.total)} ${view.shape === 'paths' ? 'paths' : 'matches'}${view.truncated ? ' · truncated' : ''}`,
    }
    case 'read': return {
      card: 'read', title, body: boundedBody(view.lines.map(line => `${line.number}  ${line.text}`).join('\n')),
      status: `${short(view.path)} · ${String(view.lines.length)}/${String(view.totalLines)} lines`,
    }
    case 'web': {
      const body = view.kind === 'search'
        ? [view.answer ?? '', ...view.sources.map(source => `${source.title ?? source.url} · ${source.url}`)].filter(Boolean).join('\n')
        : raw
      const status = view.kind === 'search'
        ? `${String(view.sources.length)} sources${view.truncated ? ' · truncated' : ''}`
        : `${String(view.statusCode)} · ${short(view.url)}${view.truncated ? ' · truncated' : ''}`
      return { card: 'web', title, ...(body === '' ? {} : { body: boundedBody(body) }), status }
    }
  }
}

/** Bind DSH's live tool definitions to a pure, bounded terminal card projection. */
export function createToolPresenter(get: (name: string) => ToolDefinition | undefined): ToolPresenter {
  return {
    call(name, rawArguments) {
      const args = decode(rawArguments)
      try {
        const view = get(name)?.presentCall?.(args)
        return { args, card: view === undefined ? generic(name, displayValue(args)) : callCard(view) }
      } catch {
        return { args, card: generic(name, displayValue(args)) }
      }
    },
    result(name, args, result, prior) {
      const raw = blockText(result.content)
      try {
        const view = get(name)?.presentResult?.(args, result)
        return view === undefined ? generic(prior.title, raw) : resultCard(view, prior, raw)
      } catch {
        return generic(prior.title, raw)
      }
    },
  }
}
