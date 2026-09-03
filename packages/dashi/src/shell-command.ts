import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { boundContextSummary, createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { CollectedOutput, ShellRunResult } from '@deepseek-ai/dsh-shell'

export const HUMAN_SHELL_TIMEOUT_MS = 30_000
export const HUMAN_SHELL_STREAM_BYTES = 32 * 1024

function tail(output: CollectedOutput): { readonly text: string; readonly truncated: boolean } {
  const bytes = Buffer.from(output.text)
  if (bytes.length <= HUMAN_SHELL_STREAM_BYTES) return output
  let start = bytes.length - HUMAN_SHELL_STREAM_BYTES
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++
  return { text: bytes.subarray(start).toString(), truncated: true }
}

function section(label: string, output: CollectedOutput): string | undefined {
  const bounded = tail(output)
  if (bounded.text === '' && !bounded.truncated) return undefined
  return `[${label}${bounded.truncated ? ' · earlier output truncated' : ''}]\n${bounded.text}`
}

export function shellResultText(command: string, result: ShellRunResult): string {
  const parts = [`$ ${command}`]
  const stdout = section('stdout', result.stdout)
  const stderr = section('stderr', result.stderr)
  if (stdout !== undefined) parts.push(stdout)
  if (stderr !== undefined) parts.push(stderr)
  if (stdout === undefined && stderr === undefined) parts.push('(no output)')
  if (result.sandbox?.denied === true) parts.push(`[sandbox denied file access · ${result.sandbox.mode}]`)
  if (result.timedOut) {
    parts.push(`[timed out after ${String(result.timeoutMs)} ms · suspend dashi with Ctrl+Z before running interactive programs]`)
  } else if (result.aborted) {
    parts.push('[cancelled]')
  } else if (result.signal !== null) {
    parts.push(`[signal ${result.signal}]`)
  } else {
    parts.push(result.exitCode === null ? '[exit unavailable]' : `[exit ${String(result.exitCode)}]`)
  }
  return parts.join('\n')
}

export function quoteShellWord(value: string): string { return `'${value.replaceAll("'", "'\\''")}'` }
/** Run an explicit human command through DSH and identify its next-step context. */
export async function runHumanShell(
  ctx: Context,
  agent: Agent,
  command: string,
  signal: AbortSignal, success?: string,
): Promise<readonly [UserMessage, ShellRunResult]> {
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    env: { DSH_HOME: resolveDshHome() },
    sandboxPolicy: ctx.sandboxPolicy.resolve({ session: agent.session }),
    signal,
    stdoutMaxBytes: HUMAN_SHELL_STREAM_BYTES,
    timeoutMs: HUMAN_SHELL_TIMEOUT_MS,
    workdir: agent.session.header.cwd,
  }))
  return [createUserMessage({
    content: [{ type: 'text', text: shellResultText(command, result) + (result.exitCode === 0 && success ? `\n${success}` : '') }],
    source: {
      form: 'notice', kind: 'plugin', plugin: 'dashi',
      summary: boundContextSummary(`Shell: ${command.replace(/\s+/gu, ' ').trim()}`),
    },
  }), result]
}
