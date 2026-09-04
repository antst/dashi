import { execFileSync, spawnSync } from 'node:child_process'
import { accessSync, chmodSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { testCeiling } from './test-budget.js'

export type MultiplexerKind = 'screen' | 'tmux'
const terminalFlags = ['icanon', 'echo', 'isig', 'opost'] as const

function relevantTerminalMode(mode: string): string {
  const fields = new Set(mode.replaceAll(';', ' ').split(/\s+/u))
  return terminalFlags.map(flag => {
    if (fields.has(`-${flag}`)) return `-${flag}`
    if (fields.has(flag)) return flag
    throw new Error(`stty output omitted ${flag}: ${mode}`)
  }).join(' ')
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', env, ...(cwd === undefined ? {} : { cwd }), timeout: 10_000 })
  } catch (error) {
    const detail = error as { code?: string; signal?: string; status?: number; stderr?: string; stdout?: string }
    throw new Error(`${command} failed (${String(detail.status ?? detail.code ?? detail.signal)}): ${detail.stderr || detail.stdout || String(error)}`)
  }
}

function executable(name: string): string {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, name)
    try {
      accessSync(candidate, constants.X_OK)
      return candidate
    } catch {}
  }
  return name
}

export function requireMultiplexer(kind: MultiplexerKind): string {
  const binary = executable(kind)
  const probe = spawnSync(binary, ['--version'], { encoding: 'utf8' })
  const version = `${probe.stdout ?? ''}${probe.stderr ?? ''}`.trim()
  if (probe.error !== undefined) throw new Error(`${kind} is required; looked for ${binary}: ${String(probe.error)}`)
  if (kind === 'screen') {
    const match = /Screen version (\d+)\.(\d+)/u.exec(version)
    if (match === null || Number(match[1]) < 4 || (Number(match[1]) === 4 && Number(match[2]) < 1)) {
      throw new Error(`GNU screen >= 4.1 is required; found ${binary}: ${version || 'unknown version'}`)
    }
    process.stdout.write(`dashi test harness: using ${binary}: ${version}\n`)
  }
  return binary
}

function waitForScreen(binary: string, name: string, env: NodeJS.ProcessEnv): void {
  const deadline = Date.now() + testCeiling(10_000)
  let detail = ''
  while (Date.now() < deadline) {
    const probe = spawnSync(binary, ['-U', '-S', name, '-Q', 'select', '.'], { encoding: 'utf8', env })
    if (probe.status === 0) return
    detail = probe.stderr || probe.stdout || String(probe.error ?? probe.status)
  }
  throw new Error(`screen session ${name} did not become ready: ${detail}`)
}

export class MultiplexerPane {
  readonly kind: MultiplexerKind
  readonly modeAfter: string
  readonly modeBefore: string
  private readonly captureFile: string
  private readonly binary: string
  private readonly env: NodeJS.ProcessEnv
  private readonly name: string
  private readonly screenDirectory?: string
  private readonly socket: string

  constructor(kind: MultiplexerKind, directory: string, cwd: string, env: NodeJS.ProcessEnv) {
    this.binary = requireMultiplexer(kind)
    this.kind = kind
    // Keep SCREENDIR + screen's socket filename below the Unix socket path limit.
    this.name = `d-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
    this.socket = this.name.slice(0, 80)
    this.captureFile = join(directory, `${this.name}.screen`)
    this.modeBefore = join(directory, `${this.name}.before`)
    this.modeAfter = join(directory, `${this.name}.after`)
    if (kind === 'screen') {
      const sockets = mkdtempSync(join('/tmp', `dsh-s-${process.pid.toString(36)}-`))
      chmodSync(sockets, 0o700)
      this.screenDirectory = sockets
      this.env = { ...env, SCREENDIR: sockets }
      run(this.binary, [
        '-U', '-c', '/dev/null', '-dmS', this.name, '-L', '-Logfile', join(directory, `${this.name}.log`),
        '/bin/bash', '--noprofile', '--norc', '-i',
      ], this.env, cwd)
      waitForScreen(this.binary, this.name, this.env)
    } else {
      this.env = env
      run(this.binary, [
        '-L', this.socket, '-f', '/dev/null', 'new-session', '-d', '-x', '80', '-y', '24',
        '-s', this.name, '-c', cwd, '/bin/bash', '--noprofile', '--norc', '-i',
      ], this.env)
    }
  }

  capture(): string {
    if (this.kind === 'tmux') {
      return run(this.binary, ['-L', this.socket, 'capture-pane', '-p', '-e', '-S', '-200', '-t', `${this.name}:0.0`], this.env)
    }
    run(this.binary, ['-U', '-S', this.name, '-p', '0', '-X', 'hardcopy', '-h', this.captureFile], this.env)
    const bytes = readFileSync(this.captureFile)
    const utf8 = bytes.toString('utf8')
    // Screen 5 writes UTF-8 hardcopies; Screen 4 can retain its single-byte display encoding.
    return utf8.includes('\uFFFD') ? bytes.toString('latin1') : utf8
  }

  send(data: string): void {
    if (this.kind === 'tmux') {
      run(this.binary, ['-L', this.socket, 'send-keys', '-t', `${this.name}:0.0`, '-l', '--', data], this.env)
    } else {
      // screen expands $ variables in command arguments before stuffing them.
      run(this.binary, ['-U', '-S', this.name, '-p', '0', '-X', 'stuff', data.replaceAll('$', '\\$')], this.env)
    }
  }

  async waitFor(text: string, timeoutMs = 20_000): Promise<string> {
    const deadline = Date.now() + testCeiling(timeoutMs)
    let output = ''
    while (Date.now() < deadline) {
      try { output = this.capture() } catch {}
      if (output.includes(text)) return output
      await new Promise(resolve => { setTimeout(resolve, 50) })
    }
    throw new Error(`Timed out waiting for ${JSON.stringify(text)} in ${this.kind}\n${output.slice(-4000)}`)
  }

  restored(): boolean {
    return relevantTerminalMode(readFileSync(this.modeBefore, 'utf8')) ===
      relevantTerminalMode(readFileSync(this.modeAfter, 'utf8'))
  }

  close(): void {
    if (this.kind === 'tmux') {
      spawnSync(this.binary, ['-L', this.socket, 'kill-server'], { env: this.env })
    } else {
      spawnSync(this.binary, ['-S', this.name, '-X', 'quit'], { env: this.env })
      if (this.screenDirectory !== undefined) rmSync(this.screenDirectory, { recursive: true, force: true })
    }
  }
}
