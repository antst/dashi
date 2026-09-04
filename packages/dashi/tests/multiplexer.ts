import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { testCeiling } from './test-budget.js'

export type MultiplexerKind = 'screen' | 'tmux'

function run(command: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string): string {
  try {
    return execFileSync(command, args, { encoding: 'utf8', env, ...(cwd === undefined ? {} : { cwd }), timeout: 10_000 })
  } catch (error) {
    const detail = error as { code?: string; signal?: string; status?: number; stderr?: string; stdout?: string }
    throw new Error(`${command} failed (${String(detail.status ?? detail.code ?? detail.signal)}): ${detail.stderr || detail.stdout || String(error)}`)
  }
}

export function requireMultiplexer(kind: MultiplexerKind): void {
  const probe = spawnSync(kind, ['--version'], { encoding: 'utf8' })
  if (probe.error === undefined) return
  if (kind === 'screen') throw new Error('GNU screen is required; install the Ubuntu package: screen')
  throw new Error('tmux is required; install the Ubuntu package: tmux')
}

function waitForScreen(name: string, env: NodeJS.ProcessEnv): void {
  const deadline = Date.now() + testCeiling(10_000)
  let detail = ''
  while (Date.now() < deadline) {
    const probe = spawnSync('screen', ['-U', '-S', name, '-Q', 'select', '.'], { encoding: 'utf8', env })
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
  private readonly env: NodeJS.ProcessEnv
  private readonly name: string
  private readonly screenDirectory?: string
  private readonly socket: string

  constructor(kind: MultiplexerKind, directory: string, cwd: string, env: NodeJS.ProcessEnv) {
    requireMultiplexer(kind)
    this.kind = kind
    // Keep SCREENDIR + screen's socket filename below the Unix socket path limit.
    this.name = `d-${process.pid.toString(36)}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`
    this.socket = this.name.slice(0, 80)
    this.captureFile = join(directory, `${this.name}.screen`)
    this.modeBefore = join(directory, `${this.name}.before`)
    this.modeAfter = join(directory, `${this.name}.after`)
    if (kind === 'screen') {
      const sockets = mkdtempSync(join(tmpdir(), 'dsh-s-'))
      chmodSync(sockets, 0o700)
      this.screenDirectory = sockets
      this.env = { ...env, SCREENDIR: sockets }
      run('screen', [
        '-U', '-c', '/dev/null', '-dmS', this.name, '-L', '-Logfile', join(directory, `${this.name}.log`),
        '/bin/bash', '--noprofile', '--norc', '-i',
      ], this.env, cwd)
      waitForScreen(this.name, this.env)
    } else {
      this.env = env
      run('tmux', [
        '-L', this.socket, '-f', '/dev/null', 'new-session', '-d', '-x', '80', '-y', '24',
        '-s', this.name, '-c', cwd, '/bin/bash', '--noprofile', '--norc', '-i',
      ], this.env)
    }
  }

  capture(): string {
    if (this.kind === 'tmux') {
      return run('tmux', ['-L', this.socket, 'capture-pane', '-p', '-e', '-S', '-200', '-t', `${this.name}:0.0`], this.env)
    }
    run('screen', ['-U', '-S', this.name, '-p', '0', '-X', 'hardcopy', '-h', this.captureFile], this.env)
    // GNU screen hardcopy writes its active single-byte display encoding.
    return readFileSync(this.captureFile, 'latin1')
  }

  send(data: string): void {
    if (this.kind === 'tmux') {
      run('tmux', ['-L', this.socket, 'send-keys', '-t', `${this.name}:0.0`, '-l', '--', data], this.env)
    } else {
      // screen expands $ variables in command arguments before stuffing them.
      run('screen', ['-U', '-S', this.name, '-p', '0', '-X', 'stuff', data.replaceAll('$', '\\$')], this.env)
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
    return readFileSync(this.modeBefore, 'utf8').trim() === readFileSync(this.modeAfter, 'utf8').trim()
  }

  close(): void {
    if (this.kind === 'tmux') {
      spawnSync('tmux', ['-L', this.socket, 'kill-server'], { env: this.env })
    } else {
      spawnSync('screen', ['-S', this.name, '-X', 'quit'], { env: this.env })
      if (this.screenDirectory !== undefined) rmSync(this.screenDirectory, { recursive: true, force: true })
    }
  }
}
