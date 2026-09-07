import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type {} from '@deepseek-ai/dsh-shell'
import type { Overlay, TerminalCell } from './state.js'
import { HUMAN_SHELL_STREAM_BYTES } from './shell-command.js'
import { boundedBody, type ToolPresenter } from './tool-presentation.js'
import { foldCells } from './transcript.js'
import { latestCompletedTurn } from './rewind.js'

export async function diffOverlay(
  ctx: Context, agent: Agent, presenter: ToolPresenter, mode: '' | 'turn', signal: AbortSignal,
): Promise<Overlay> {
  if (mode === 'turn') {
    const events = agent.session.snapshotEvents()
    const boundary = latestCompletedTurn(events)
    const end = boundary.atSeq === undefined ? -1 : events.findIndex(event => event.seq === boundary.atSeq)
    let start = end
    while (start >= 0 && events[start]?.type !== 'turn/start') start--
    const cells = (start < 0 ? [] : foldCells(events.slice(start, end + 1), presenter)).filter(cell =>
      cell.pending !== true && cell.tool?.card === 'diff' && (cell.tool.diffs?.length ?? 0) > 0)
    return { cells, kind: 'info', lines: cells.length === 0 ? ['No write/edit changes in the last completed turn.'] : [],
      title: `Last completed turn diff${boundary.open ? ' · trailing turn open' : ''}` }
  }
  const command = 'git diff --no-ext-diff --no-color HEAD --'
  const result = await ctx.shell.run(ctx.shell.resolve({
    command, sandboxPolicy: ctx.sandboxPolicy.resolve({ session: agent.session }), signal,
    stdoutMaxBytes: HUMAN_SHELL_STREAM_BYTES, timeoutMs: 30_000, workdir: agent.session.header.cwd,
  }))
  const output = [result.stdout.text, result.stderr.text].filter(Boolean).join('\n')
  const cell: TerminalCell = {
    key: 'diff:working', kind: result.exitCode === 0 ? 'tool' : 'error', text: 'git diff',
    tool: { card: 'terminal', title: 'git diff', status: result.exitCode === 0 ? output === '' ? 'clean' : 'changed'
      : result.exitCode === null ? result.signal ?? 'failed' : `exit ${String(result.exitCode)}`,
    ...(output === '' ? {} : { body: boundedBody(output) }) },
  }
  return { cells: [cell], kind: 'info', lines: [], title: 'Working tree diff' }
}
