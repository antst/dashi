import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

function observed<T>(read: () => T): { value: T } | { error: string; code?: string; syscall?: string } {
  try { return { value: read() } }
  catch (error) {
    const failed = error as NodeJS.ErrnoException
    return { error: failed.message, ...(failed.code ? { code: failed.code } : {}),
      ...(failed.syscall ? { syscall: failed.syscall } : {}) }
  }
}

function redact(text: string): string {
  return text.replace(/(["']?(?:_authToken|_auth|authorization|password|NPM_TOKEN|NODE_AUTH_TOKEN)["']?\s*[:=]\s*)[^\r\n]+/giu, '$1[redacted]')
}

/** Captured at the deadline, while the owned command group is still alive. */
export function recordInstallTimeout(input: {
  pid: number; command: string; args: string[]; env: NodeJS.ProcessEnv; evidence: string;
}): string {
  const directory = mkdtempSync(join(input.evidence, 'install-failure-'))
  const tree = observed(() => {
    const result = spawnSync('ps', ['-ax', '-o', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8', timeout: 5_000 })
    if (result.error) throw result.error
    if (result.status !== 0) throw new Error('ps exited ' + result.status + ': ' + result.stderr)
    return result.stdout.split('\n').filter(row => Number(row.trim().split(/\s+/u)[2]) === input.pid).join('\n')
  })
  const profile = /\bplugin\s+--profile\s+([^\s'"]+)/u.exec(input.args.join(' '))?.[1]
  const source = profile && input.env.DSH_HOME ? join(input.env.DSH_HOME, 'profiles', profile, '.plugin-manager', 'logs') : undefined
  const logs = observed(() => {
    if (!source || !existsSync(source)) return { source, absent: true }
    const copy = (from: string, to: string): void => {
      mkdirSync(to)
      for (const name of readdirSync(from)) {
        const file = join(from, name)
        const stat = lstatSync(file)
        if (stat.isDirectory()) copy(file, join(to, name))
        else if (stat.isFile()) writeFileSync(join(to, name), redact(readFileSync(file, 'utf8')))
        else throw new Error('Unexpected non-file in plugin operation logs: ' + file)
      }
    }
    copy(source, join(directory, 'plugin-manager-logs'))
    return { source, copied: true }
  })
  writeFileSync(join(directory, 'timeout.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
    command: input.command, args: input.args, pid: input.pid, processGroup: tree, logs,
  }, null, 2))
  return directory
}

/** One awaited command, one deadline; diagnostic time never changes a timeout into success. */
export async function runInstallCommand(input: {
  command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv;
  timeoutMs: number; onTimeout: (pid: number) => void;
}): Promise<{ status: number | null; stdout: string; stderr: string; error?: Error; timedOut: boolean }> {
  const child = spawn(input.command, input.args, { cwd: input.cwd, env: input.env,
    detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', error: Error | undefined, timedOut = false
  const signal = (name: NodeJS.Signals): void => {
    if (child.pid === undefined) return
    try { process.kill(-child.pid, name) }
    catch (failed) {
      if ((failed as NodeJS.ErrnoException).code !== 'ESRCH') console.error('install command cleanup: ' + String(failed))
    }
  }
  // Match spawnSync's aggregate buffer ceiling rather than silently allowing unbounded output.
  const collect = (chunk: string, stream: 'stdout' | 'stderr'): void => {
    if (error) return
    if (stream === 'stdout') stdout += chunk
    else stderr += chunk
    if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > 1024 * 1024) {
      error = Object.assign(new Error('Command output exceeded 1 MiB'), { code: 'ENOBUFS' })
      signal('SIGTERM')
    }
  }
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => { collect(chunk, 'stdout') })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { collect(chunk, 'stderr') })
  child.on('error', failed => { error = failed })
  return await new Promise(resolveResult => {
    const closed = new Promise<void>(resolveClosed => { child.once('close', () => { resolveClosed() }) })
    const deadline = setTimeout(() => {
      timedOut = true
      error = Object.assign(new Error('Command exceeded ' + input.timeoutMs + ' ms'), { code: 'ETIMEDOUT' })
      try { if (child.pid !== undefined) input.onTimeout(child.pid) }
      catch (failed) { console.error('install timeout capture failed: ' + String(failed)) }
      signal('SIGTERM')
      const cleanup = setTimeout(() => {
        signal('SIGKILL')
        child.stdout.destroy(); child.stderr.destroy()
        resolveResult({ status: null, stdout, stderr, ...(error ? { error } : {}), timedOut })
      }, 2_000)
      void closed.then(() => {
        clearTimeout(cleanup)
        signal('SIGKILL')
        resolveResult({ status: null, stdout, stderr, ...(error ? { error } : {}), timedOut })
      })
    }, input.timeoutMs)
    child.once('close', status => {
      if (timedOut) return
      clearTimeout(deadline)
      resolveResult({ status: error ? null : status, stdout, stderr, ...(error ? { error } : {}), timedOut })
    })
  })
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
      const text = redact(readFileSync(source, 'utf8'))
      writeFileSync(join(directory, file), text)
      return file
    }) }
  })
  writeFileSync(join(directory, 'failure.json'), JSON.stringify({ command: input.command,
    args: input.args, cwd: input.cwd, status: input.status, path: path ?? null, paths, store, debug,
  }, null, 2))
  return directory
}
