import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DeliveryReceipt, DeliveryRequest, MessageSendRequest, MessageSendResult, SessionListResult } from '@sessionbus/kit/protocol'
import { testCeiling } from './test-budget.js'

interface SessionbusPeer {
  readonly ready: Promise<unknown>
  readonly closed: Promise<unknown>
  readonly caller: {
    list(request?: Record<string, unknown>): Promise<SessionListResult>
    send(request: MessageSendRequest): Promise<MessageSendResult>
  }
  shutdown(): void
}

const { connectPeer } = createRequire(import.meta.url)('@sessionbus/kit') as {
  connectPeer(
    identity: Record<string, unknown>,
    deliver: (signal: AbortSignal, request: DeliveryRequest) => DeliveryReceipt,
    env: NodeJS.ProcessEnv,
  ): SessionbusPeer
}

async function waitFor(check: () => boolean, failure: () => string, timeout = 20_000): Promise<void> {
  const deadline = Date.now() + testCeiling(timeout)
  while (Date.now() < deadline) {
    if (check()) return
    await new Promise(resolveDelay => { setTimeout(resolveDelay, 20) })
  }
  throw new Error(failure())
}

export interface TestDaemon {
  readonly socket: string
  readonly output: () => string
  close(): Promise<void>
}

export async function startTestDaemon(): Promise<TestDaemon> {
  const configured = process.env.SESSIONBUS_DAEMON_BIN
  if (configured === undefined) throw new Error('SESSIONBUS_DAEMON_BIN is required for Sessionbus PTY tests')
  const binary = resolve(configured)
  if (!existsSync(binary)) throw new Error(`Sessionbus test daemon is missing: ${binary}`)
  const directory = mkdtempSync('/tmp/dashi-sb-')
  const socket = join(directory, 'presence.sock')
  const table = join(directory, 'presence.db')
  const env: NodeJS.ProcessEnv = { ...process.env, SESSIONBUS_PRODUCTS: 'dashi' }
  delete env.SESSIONBUS_HUB
  delete env.SESSIONBUS_HUB_SECRET_FILE
  const child: ChildProcessWithoutNullStreams = spawn(binary, [
    '-host', 'w101', '-products', 'dashi', '-socket', socket, '-table', table,
  ], { env, stdio: 'pipe' })
  let output = ''
  let exited: { code: number | null; signal: NodeJS.Signals | null } | undefined
  child.stdout.on('data', data => { output += String(data) })
  child.stderr.on('data', data => { output += String(data) })
  child.on('exit', (code, signal) => { exited = { code, signal } })
  await waitFor(() => existsSync(socket) || exited !== undefined,
    () => `Sessionbus daemon did not create ${socket}\n${output}`)
  if (exited !== undefined) {
    rmSync(directory, { recursive: true, force: true })
    throw new Error(`Sessionbus daemon exited before ready: ${JSON.stringify(exited)}\n${output}`)
  }
  return {
    socket,
    output: () => output,
    close: async () => {
      if (exited === undefined) {
        child.kill('SIGTERM')
        await waitFor(() => exited !== undefined, () => `Sessionbus daemon did not stop\n${output}`)
      }
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

export interface TestObserver {
  readonly deliveries: DeliveryRequest[]
  list(): Promise<SessionListResult>
  send(request: MessageSendRequest): Promise<MessageSendResult>
  waitForMessage(text: string): Promise<DeliveryRequest>
  close(): Promise<void>
}

export async function connectTestObserver(socket: string, group: string, name: string): Promise<TestObserver> {
  const deliveries: DeliveryRequest[] = []
  const peer = connectPeer({
    protocol: 1,
    product: 'dashi-pty-observer',
    session_id: `session-${randomUUID()}`,
    name,
    groups: [group],
    info: {},
  }, (_signal, request) => {
    deliveries.push(request)
    return { disposition: 'written' }
  }, { SESSIONBUS_SOCKET: socket })
  await peer.ready
  return {
    deliveries,
    list: () => peer.caller.list(),
    send: request => peer.caller.send(request),
    waitForMessage: async text => {
      await waitFor(() => deliveries.some(delivery => delivery.body.includes(text)),
        () => `Observer did not receive ${JSON.stringify(text)}: ${JSON.stringify(deliveries)}`)
      return deliveries.find(delivery => delivery.body.includes(text)) as DeliveryRequest
    },
    close: async () => {
      peer.shutdown()
      await peer.closed
    },
  }
}
