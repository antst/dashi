import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function observed<T>(read: () => T): { value: T } | { error: string; code?: string; syscall?: string } {
  try { return { value: read() } }
  catch (error) {
    const failed = error as NodeJS.ErrnoException
    return { error: failed.message, ...(failed.code ? { code: failed.code } : {}),
      ...(failed.syscall ? { syscall: failed.syscall } : {}) }
  }
}

/** Failure-only evidence. No repair, retry, config values or file contents. */
export function recordInstallFailure(input: {
  command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  evidence: string; pnpm: string; output: string; status: number | null;
}): string {
  const directory = mkdtempSync(join(input.evidence, 'install-failure-'))
  const path = /\b(?:open|readlink|lstat|stat|rename)\s+'(\/[^']+)'/u.exec(input.output)?.[1]
  const paths = []
  if (path !== undefined) for (let current = resolve(path);;) {
    paths.push({ path: current,
      lstat: observed(() => { const stat = lstatSync(current); return {
        mode: stat.mode, size: stat.size, ino: stat.ino, dev: stat.dev,
        symlink: stat.isSymbolicLink(), directory: stat.isDirectory(),
      } }),
      readlink: observed(() => readlinkSync(current)), realpath: observed(() => realpathSync(current)),
      read: observed(() => { const bytes = readFileSync(current); return {
        size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
      } }),
    })
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  const store = observed(() => {
    const result = spawnSync(input.pnpm, ['store', 'path'], {
      cwd: input.cwd, env: input.env, encoding: 'utf8', timeout: 10_000,
    })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error(`pnpm store path exited ${result.status}: ${result.stderr}`)
    return result.stdout.trim()
  })
  const advertisedLog = /complete log of this run can be found in:\s*([^\r\n]+)/iu.exec(input.output)?.[1]
  const debug = [...new Set([join(input.cwd, 'pnpm-debug.log'), join(input.cwd, 'pnpm.log'),
    ...(advertisedLog ? [resolve(input.cwd, advertisedLog.trim())] : []),
  ])].map(source => {
    const file = source.split('/').at(-1) as string
    if (!existsSync(source)) return { source, absent: true }
    return { source, capture: observed(() => {
      // Preserve install diagnostics, never token/password/authorization values.
      const text = readFileSync(source, 'utf8').replace(
        /(["']?(?:_authToken|_auth|authorization|password|NPM_TOKEN|NODE_AUTH_TOKEN)["']?\s*[:=]\s*)[^\r\n]+/giu,
        '$1[redacted]',
      )
      writeFileSync(join(directory, file), text)
      return file
    }) }
  })
  writeFileSync(join(directory, 'failure.json'), JSON.stringify({ command: input.command,
    args: input.args, cwd: input.cwd, status: input.status, path: path ?? null, paths, store, debug,
  }, null, 2))
  return directory
}
