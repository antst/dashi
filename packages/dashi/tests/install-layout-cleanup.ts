import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

/** Only large children owned by this row; top-level evidence and failure captures stay. */
export async function pruneInstallLayout(workspace: string): Promise<void> {
  const owned = new Set(['user', 'project', 'tools', 'npm-global', 'pnpm-global', 'global-bin', 'candidate', 'npm-cache'])
  for (const entry of await readdir(workspace, { withFileTypes: true })) {
    if (entry.isDirectory() && (owned.has(entry.name) || /^(?:native|project)-(?:fresh|0\.2\.0(?:-alpha\.[12])?|0\.2\.1)$/u.test(entry.name))) {
      await rm(join(workspace, entry.name), { recursive: true })
    }
  }
}
