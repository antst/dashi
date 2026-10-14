import { readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Only large children owned by this row; top-level evidence and failure captures stay. */
export function pruneInstallLayout(workspace: string): void {
  const owned = new Set(['user', 'project', 'tools', 'npm-global', 'pnpm-global', 'global-bin', 'candidate', 'npm-cache'])
  for (const entry of readdirSync(workspace, { withFileTypes: true })) {
    if (entry.isDirectory() && (owned.has(entry.name) || /^(?:native|project)-(?:fresh|0\.2\.0-alpha\.[12])$/u.test(entry.name))) {
      rmSync(join(workspace, entry.name), { recursive: true })
    }
  }
}
