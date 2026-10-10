import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createSessionFormatCatalogWithChildren, historicalSessionFormatCatalog, sessionFormatCatalog,
} from '@deepseek-ai/dsh-session-format-catalog'
import { historicalChildCatalogSource } from '@deepseek-ai/dsh-session-format-v3-to-v4'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Restore recorded fixtures through DSH's released codec and migration inventory. */
export function recordedSession(file: string | URL) {
  const path = typeof file === 'string' ? file : fileURLToPath(file)
  const rows = readFileSync(path, 'utf8').trim().split('\n').map(line => JSON.parse(line))
  const header = rows[0]
  const children = []
  if (sessionFormatCatalog.readHeader(header).status === 'migration-required') {
    // Restore historical children only to collect native prerequisites, not their catalogs.
    for (const entry of readdirSync(dirname(path)).filter(name => name.endsWith('.jsonl'))) {
      const lines = readFileSync(join(dirname(path), entry), 'utf8').split('\n').filter(Boolean)
      const childHeader = lines[0] === undefined ? undefined : JSON.parse(lines[0])
      if (childHeader?.parentSession !== header.id || childHeader.origin !== 'subagent') continue
      const childRows = lines.map(line => JSON.parse(line))
      const restore = historicalSessionFormatCatalog.createRestore(childHeader, { recovery: 'strict', validation: 'current' })
      for (const row of childRows.slice(1)) restore.decodeRow(row)
      children.push(historicalChildCatalogSource(restore.finish()))
    }
  }
  const catalog = createSessionFormatCatalogWithChildren(children)
  const restore = catalog.createRestore(header, { recovery: 'strict', validation: 'current' })
  for (const row of rows.slice(1)) restore.decodeRow(row)
  return restore.finish()
}

export function recordedEvents(file: string | URL): SessionEvent[] {
  return recordedSession(file).events as SessionEvent[]
}

export function currentRecordedJsonl(
  file: string | URL,
  headerOverrides: Partial<Pick<Parameters<typeof sessionFormatCatalog.encodeCurrentHeader>[0], 'id' | 'cwd' | 'createdAt'>> = {},
): string {
  const session = recordedSession(file)
  return `${[
    sessionFormatCatalog.encodeCurrentHeader({ ...session.header, ...headerOverrides }, session.inheritedEventCount),
    ...session.events.map(event => sessionFormatCatalog.encodeCurrentEvent(event)),
  ].map(row => JSON.stringify(row)).join('\n')}\n`
}
