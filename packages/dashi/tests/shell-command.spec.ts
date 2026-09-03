import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { describe, expect, it, vi } from 'vitest'
import {
  HUMAN_SHELL_STREAM_BYTES, HUMAN_SHELL_TIMEOUT_MS, quoteShellWord, runHumanShell, shellResultText,
} from '../src/shell-command.js'

function result(overrides: Partial<ShellRunResult> = {}): ShellRunResult {
  return {
    aborted: false, exitCode: 0, signal: null,
    stderr: { text: '', truncated: false }, stdout: { text: '', truncated: false },
    timedOut: false, timeoutMs: HUMAN_SHELL_TIMEOUT_MS, ...overrides,
  }
}

describe('human shell command', () => {
  it('quotes a profile name containing a space and quote as one shell word', () => {
    expect(quoteShellWord("my profile's")).toBe("'my profile'\\''s'")
  })

  it('caps each stream and reports timeout and sandbox denial', () => {
    const text = shellResultText('sleep 60', result({
      sandbox: { denied: true, mode: 'workspace-write' },
      stderr: { text: `first${'x'.repeat(HUMAN_SHELL_STREAM_BYTES)}last`, truncated: false },
      stdout: { text: 'before timeout', truncated: false },
      timedOut: true,
    }))
    expect(text).not.toContain('first')
    expect(text).toContain('[stderr · earlier output truncated]')
    expect(text).toContain('[sandbox denied file access · workspace-write]')
    expect(text).toContain('timed out after 30000 ms')
    expect(text).toContain('suspend dashi with Ctrl+Z')
  })

  it('runs the resolved DSH shell request and creates one identified notice', async () => {
    const spec = result({ stdout: { text: 'ok', truncated: false } })
    const run = vi.fn(async () => spec)
    const resolve = vi.fn((request: unknown) => request)
    const policy = { mode: 'workspace-write', workspaceRoot: '/work' }
    const ctx = {
      sandboxPolicy: { resolve: vi.fn(() => policy) }, shell: { resolve, run },
    } as unknown as Context
    const agent = { session: { header: { cwd: '/work' } } } as unknown as Agent
    const signal = new AbortController().signal
    const [message, shellResult] = await runHumanShell(ctx, agent, 'echo ok', signal, 'reload next time')
    expect(resolve).toHaveBeenCalledWith({
      command: 'echo ok', env: { DSH_HOME: expect.any(String) }, sandboxPolicy: policy, signal,
      stdoutMaxBytes: HUMAN_SHELL_STREAM_BYTES, timeoutMs: HUMAN_SHELL_TIMEOUT_MS, workdir: '/work',
    })
    expect(message).toMatchObject({
      content: [{ text: expect.stringContaining('[exit 0]\nreload next time') }],
      role: 'user', source: { form: 'notice', kind: 'plugin', plugin: 'dashi', summary: 'Shell: echo ok' },
    })
    expect(message.id).toBeTruthy()
    expect(shellResult).toBe(spec)
  })
})
