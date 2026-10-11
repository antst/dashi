import { execFileSync } from 'node:child_process'
import * as pty from 'node-pty'
import { testCeiling } from './test-budget.js'
import { countAudibleBells } from './terminal-output.js'

/** Shared PTY transport; callers own the profile/installation and fixture environment. */
export class TestPtyShell {
  readonly process: pty.IPty
  readonly frameTimes: number[] = []
  output = ''
  private readonly exited: Promise<number>

  constructor(cwd: string, env: NodeJS.ProcessEnv) {
    this.process = pty.spawn('/bin/bash', ['--noprofile', '--norc', '-i'], {
      cols: 80, rows: 24, cwd, env,
    })
    this.process.onData(data => {
      this.output += data
      const frames = data.split('\u001B[?2026h').length - 1
      for (let index = 0; index < frames; index++) this.frameTimes.push(performance.now())
    })
    this.exited = new Promise(resolveExit => {
      this.process.onExit(event => { resolveExit(event.exitCode) })
    })
  }

  write(data: string): void { this.process.write(data) }
  resize(columns: number, rows: number): void { this.process.resize(columns, rows) }

  async waitFor(text: string, start = 0, timeoutMs = 20_000): Promise<number> {
    const deadline = Date.now() + testCeiling(timeoutMs)
    while (Date.now() < deadline) {
      const found = this.output.indexOf(text, start)
      if (found !== -1) return found
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
    }
    throw new Error(`Timed out waiting for ${JSON.stringify(text)}\n${this.output.slice(-4000)}`)
  }

  async waitForAudibleBell(start = 0, timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + testCeiling(timeoutMs)
    while (Date.now() < deadline) {
      if (countAudibleBells(this.output.slice(start)) > 0) return
      await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
    }
    throw new Error('Timed out waiting for an audible terminal bell')
  }

  childPid(): number {
    const output = execFileSync('ps', ['-ax', '-o', 'pid=', '-o', 'ppid='], { encoding: 'utf8' })
    const child = output.split('\n').map(row => row.trim().split(/\s+/))
      .find(([, parent]) => Number(parent) === this.process.pid)
    const pid = Number(child?.[0])
    if (!Number.isInteger(pid)) throw new Error(`No child process below PTY shell ${this.process.pid}`)
    return pid
  }

  async close(): Promise<void> {
    this.write('exit\n')
    const result = await Promise.race([
      this.exited,
      new Promise<number>(resolveTimeout => { setTimeout(() => { resolveTimeout(-1) }, 2_000) }),
    ])
    if (result === -1) this.process.kill('SIGKILL')
  }
}

