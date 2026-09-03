import type { TerminalCell } from './state.js'

function heading(kind: TerminalCell['kind']): string {
  return kind === 'user' ? 'User'
    : kind === 'assistant' ? 'Assistant'
      : kind === 'reasoning' ? 'Reasoning'
        : kind[0]?.toUpperCase() + kind.slice(1)
}

function body(cell: TerminalCell): string {
  const parts = [cell.text]
  if (cell.detail !== undefined && cell.detail !== cell.text) parts.push(cell.detail)
  if (cell.tool?.body !== undefined) parts.push(cell.tool.body)
  for (const diff of cell.tool?.diffs ?? []) {
    parts.push(`${diff.path} (+${String(diff.added)} -${String(diff.removed)})`, ...diff.lines)
  }
  return parts.filter(Boolean).join('\n\n')
}

/** Format the existing terminal projection as a portable Markdown transcript. */
export function markdownTranscript(
  sessionId: string,
  cwd: string,
  title: string | undefined,
  cells: readonly TerminalCell[],
): string {
  const sections = cells.filter(cell => cell.pending !== true).map(cell =>
    `## ${heading(cell.kind)}\n\n${body(cell)}`)
  return [
    `# ${title ?? 'Untitled DSH session'}`,
    `Session: \`${sessionId}\`  `,
    `Working directory: \`${cwd}\``,
    ...sections,
  ].join('\n\n').trimEnd() + '\n'
}
