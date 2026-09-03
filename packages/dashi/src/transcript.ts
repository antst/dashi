import type { ContentBlock, UserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-compaction'
import type {} from '@deepseek-ai/dsh-plan-mode'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-tool-todo'
import type { TerminalCell } from './state.js'
import { createToolPresenter, type ToolPresenter } from './tool-presentation.js'

interface AssistantCells {
  reasoning?: number
  text?: number
}

interface FoldOptions {
  readonly truncatedStart?: boolean
}

function blockText(blocks: readonly ContentBlock[], kind: 'reasoning' | 'text'): string {
  return blocks.filter((block): block is Extract<ContentBlock, { type: typeof kind }> => block.type === kind)
    .map(block => block.text).join('')
}

function messageText(blocks: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    if (block.type === 'text') parts.push(block.text)
    else if (block.type === 'image') parts.push('[image]')
    else if (block.type !== 'reasoning' && block.type !== 'tool-call' && block.type !== 'tool-result') {
      parts.push(`[${String((block as unknown as { type?: unknown }).type ?? 'content')}]`)
    }
  }
  return parts.join('')
}

function isDashiShell(message: UserMessage): boolean {
  const source = message.source as unknown as Record<string, unknown>
  return source.kind === 'plugin' && source.plugin === 'dashi' && source.form === 'notice'
    && messageText(message.content).startsWith('$ ')
}

function shellCell(message: UserMessage, pending: boolean): TerminalCell {
  return {
    key: `shell:${String(message.id)}`, kind: 'shell', pending, text: messageText(message.content),
  }
}

function collapsedContextCell(message: UserMessage, key: string): TerminalCell | undefined {
  const source = message.source as unknown as Record<string, unknown>
  const form = source.form
  if (source.kind !== 'plugin' || !['instructions', 'catalog', 'snapshot', 'notice', 'recall'].includes(String(form))) {
    return undefined
  }
  const text = messageText(message.content)
  const lines = text.split(/\r?\n/u)
  const first = form === 'notice' && typeof source.summary === 'string' ? source.summary : lines[0] ?? ''
  return {
    collapsed: true,
    detail: `${String(form)} · ${first.trim()} · ${String(lines.length)} lines`,
    key,
    kind: 'context',
    text,
  }
}

/** Project DSH-owned pending injections beside the durable transcript. */
export function pendingShellCells(messages: readonly UserMessage[]): readonly TerminalCell[] {
  return messages.filter(isDashiShell).map(message => shellCell(message, true))
}

function outcome(reason: SessionEvent<'turn/end'>['data']['reason']): string {
  switch (reason.kind) {
    case 'completed': return 'completed'
    case 'aborted': return `interrupted (${reason.reason.kind})`
    case 'blocked': return 'blocked'
    case 'error': return `${reason.error.message} [${reason.error.code}]`
    case 'max-tokens': return 'maximum output reached'
    case 'interrupted': return 'interrupted by an earlier crash'
    default: return String((reason as { kind?: unknown }).kind ?? 'unknown outcome')
  }
}

function todoText(event: SessionEvent<'todo/write'>): string {
  const glyph = { completed: '✓', in_progress: '●', pending: '○' } as const
  const lines = event.data.todos.map(todo => `${glyph[todo.status]} ${todo.content}`)
  return `Todos\n${lines.join('\n')}`
}

function compactText(summary: SessionEvent<'compaction/summary'> | undefined): string {
  if (summary === undefined) return 'Conversation compacted'
  const items = summary.data.shadowedSeqs.length
  return `Compacted ${String(items)} item${items === 1 ? '' : 's'} · ${String(summary.data.shadowedTokenCount)} tokens`
}

function compactSource(event: SessionEvent<'user/message'>): {
  readonly compactionId: string
  readonly sourceCommandId?: string
} | undefined {
  if (event.surfaceOp === undefined || event.surfaceOp === 'append' || event.surfaceOp.op !== 'replace') return undefined
  const source = event.data.source as unknown as Record<string, unknown>
  if (source.kind !== 'plugin' || source.plugin !== 'compact' || typeof source.compactionId !== 'string') return undefined
  return {
    compactionId: source.compactionId,
    ...(typeof source.sourceCommandId === 'string' ? { sourceCommandId: source.sourceCommandId } : {}),
  }
}

/** Fold one chronological DSH event slice into terminal-owned presentation cells. */
export function foldCells(
  events: readonly SessionEvent[],
  presenter: ToolPresenter | undefined = createToolPresenter(() => undefined),
  options: FoldOptions = {},
): readonly TerminalCell[] {
  const toolPresenter = presenter ?? createToolPresenter(() => undefined)
  const cells: TerminalCell[] = []
  const assistants = new Map<string, AssistantCells>()
  const calls = new Map<string, { args: unknown; name: string; slot: number }>()
  const commands = new Map<string, number>()
  const inheritedPendingCommands = new Set<number>()
  const compactions = new Map<string, SessionEvent<'compaction/summary'>>()
  const openTurns = new Set<number>()
  let planSlot: number | undefined
  let todoSlot: number | undefined
  let truncatedPrefix = options.truncatedStart === true

  const putAssistant = (
    turn: number,
    step: number,
    kind: 'reasoning' | 'text',
    text: string,
    complete: boolean,
  ): void => {
    const key = `${turn}:${step}`
    const pair = assistants.get(key) ?? {}
    const slot = kind === 'text' ? pair.text : pair.reasoning
    const cellKind = kind === 'text' ? 'assistant' : 'reasoning'
    if (slot === undefined) {
      const next = cells.length
      cells.push({
        key: `assistant:${key}:${kind}`,
        kind: cellKind,
        ...(!complete && kind === 'text' ? { pending: true } : {}),
        text,
        ...(complete && kind === 'reasoning' ? { collapsed: true } : {}),
      })
      if (kind === 'text') pair.text = next
      else pair.reasoning = next
      assistants.set(key, pair)
      return
    }
    const previous = cells[slot]
    if (previous === undefined) return
    const { pending: _pending, ...settled } = previous
    cells[slot] = {
      ...(complete ? settled : previous),
      text: complete ? text : previous.text + text,
      ...(complete && kind === 'reasoning' ? { collapsed: true } : {}),
    }
  }

  for (const event of events) {
    switch (event.type) {
      case 'turn/start':
        truncatedPrefix = false
        openTurns.add(event.data.turn)
        if (todoSlot !== undefined) {
          const previous = cells[todoSlot]
          if (previous !== undefined) cells[todoSlot] = { ...previous, collapsed: true, text: 'Todos · previous revision' }
          todoSlot = undefined
        }
        break
      case 'user/message': {
        const compact = compactSource(event)
        if (compact !== undefined) {
          const text = compactText(compactions.get(compact.compactionId))
          const slot = compact.sourceCommandId === undefined ? undefined : commands.get(compact.sourceCommandId)
          const command = slot === undefined ? undefined : cells[slot]
          if (slot !== undefined && command?.kind === 'command') cells[slot] = { ...command, text: `${command.text}\n${text}` }
          else cells.push({ key: `${event.seq}:compaction`, kind: 'compaction', text })
          break
        }
        const text = messageText(event.data.content)
        const context = collapsedContextCell(event.data, `${event.seq}:context`)
        cells.push(context ?? (isDashiShell(event.data)
          ? shellCell(event.data, false)
          : {
              key: `${event.seq}:user`,
              kind: event.data.source.kind === 'user' ? 'user' : 'context',
              text,
            }))
        break
      }
      case 'assistant/chunk': {
        const { chunk, step, turn } = event.data
        if (chunk.type === 'text-delta') putAssistant(turn, step, 'text', chunk.text, false)
        else if (chunk.type === 'reasoning-delta') putAssistant(turn, step, 'reasoning', chunk.text, false)
        else if (chunk.type === 'block-end' && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) {
          putAssistant(turn, step, chunk.block.type, chunk.block.text, true)
        }
        break
      }
      case 'assistant/message': {
        const { message, step, turn } = event.data
        const text = blockText(message.content, 'text')
        const reasoning = blockText(message.content, 'reasoning')
        if (reasoning !== '') putAssistant(turn, step, 'reasoning', reasoning, true)
        if (text !== '') putAssistant(turn, step, 'text', text, true)
        break
      }
      case 'tool/call': {
        const id = String(event.data.callId)
        if (calls.has(id)) {
          cells.push({ key: `${event.seq}:error`, kind: 'error', text: `duplicate tool call ${id}` })
          break
        }
        const presented = toolPresenter.call(event.data.name, event.data.arguments)
        if (event.data.name === 'exit_plan_mode') {
          const previous = planSlot === undefined ? undefined : cells[planSlot]
          if (planSlot !== undefined && previous !== undefined) cells[planSlot] = { ...previous, collapsed: true }
          planSlot = cells.length
        }
        calls.set(id, { args: presented.args, name: event.data.name, slot: cells.length })
        cells.push({
          key: `tool:${id}`,
          kind: 'tool',
          pending: true,
          text: presented.card.title,
          tool: presented.card,
        })
        break
      }
      case 'todo/write': {
        const previous = todoSlot === undefined ? undefined : cells[todoSlot]
        if (todoSlot !== undefined && previous !== undefined) cells[todoSlot] = { ...previous, collapsed: true, text: 'Todos · previous revision' }
        todoSlot = cells.length
        cells.push({ key: `${event.seq}:todos`, kind: 'todo', text: todoText(event) })
        break
      }
      case 'compaction/summary':
        compactions.set(String(event.data.compactionId), event)
        break
      case 'tool/result': {
        const id = String(event.data.message.source.callId)
        const call = calls.get(id)
        if (call === undefined || cells[call.slot] === undefined) {
          if (truncatedPrefix) break
          cells.push({ key: `${event.seq}:error`, kind: 'error', text: `tool result ${id} has no matching call` })
          break
        }
        const block = event.data.message.content[0]
        if (block === undefined) {
          cells.push({ key: `${event.seq}:error`, kind: 'error', text: `tool result ${id} has no content` })
          break
        }
        const result = {
          content: block.content,
          isError: block.isError || event.data.error !== undefined,
          ...(event.data.meta === undefined ? {} : { meta: event.data.meta }),
        }
        const previous = cells[call.slot]
        if (previous === undefined) break
        const card = toolPresenter.result(call.name, call.args, result, previous.tool ?? {
          card: 'generic', title: call.name,
        })
        cells[call.slot] = {
          ...previous,
          text: card.title,
          tool: card,
          pending: false,
          ...(result.isError ? { kind: 'error' } : {}),
        } as TerminalCell
        break
      }
      case 'command/run': {
        const id = String(event.data.commandId)
        if (commands.has(id)) {
          cells.push({ key: `${event.seq}:error`, kind: 'error', text: `duplicate command ${id}` })
          break
        }
        commands.set(id, cells.length)
        cells.push({
          key: `command:${id}`,
          kind: 'command',
          pending: true,
          startedAt: event.time,
          text: `/${event.data.name}${event.data.args ?? ''}`,
        })
        break
      }
      case 'session/end-seed':
        // Fork includes post-turn log events through the next turn/start
        // (api/session-controller/src/commands.ts:229-231). A command/run is
        // appended before its handler (interaction/commands/src/index.ts:345-350),
        // so the child can inherit that run but never its parent-only done event.
        for (const slot of commands.values()) {
          if (cells[slot]?.pending === true) inheritedPendingCommands.add(slot)
        }
        break
      case 'command/done': {
        const id = String(event.data.commandId)
        const slot = commands.get(id)
        if (slot === undefined) {
          if (truncatedPrefix) break
          cells.push({ key: `${event.seq}:error`, kind: 'error', text: `command result ${id} has no matching run` })
          break
        }
        const previous = cells[slot]
        if (previous === undefined || previous.kind !== 'command') {
          cells.push({ key: `${event.seq}:error`, kind: 'error', text: `command result ${id} has no matching run` })
          break
        }
        inheritedPendingCommands.delete(slot)
        cells[slot] = {
          ...previous,
          ...(previous.startedAt === undefined ? {} : { elapsedMs: Math.max(0, event.time - previous.startedAt) }),
          pending: false,
          text: `${previous.text}${event.data.text === undefined ? '' : `\n${event.data.text}`}${event.data.kind === 'error' ? '\nfailed' : ''}`,
        }
        break
      }
      case 'turn/end':
        if (!openTurns.delete(event.data.turn)) {
          if (!truncatedPrefix) {
            cells.push({ key: `${event.seq}:error`, kind: 'error', text: `turn ${event.data.turn} ended without starting` })
          }
        } else {
          cells.push({
            key: `${event.seq}:outcome`,
            kind: event.data.reason.kind === 'error' ? 'error' : 'outcome',
            text: outcome(event.data.reason),
          })
        }
        truncatedPrefix = false
        break
      default:
        break
    }
  }
  return inheritedPendingCommands.size === 0
    ? cells
    : cells.filter((_cell, slot) => !inheritedPendingCommands.has(slot))
}
