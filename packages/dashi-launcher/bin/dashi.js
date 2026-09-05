#!/usr/bin/env node
import { spawn } from 'node:child_process'

const args = []
const groups = []
for (let index = 2; index < process.argv.length; index++) {
  const arg = process.argv[index]
  let value
  if (arg === '-g' || arg === '--group') value = process.argv[++index] ?? ''
  else if (arg.startsWith('-g=')) value = arg.slice(3)
  else { args.push(arg); continue }
  const names = value.split(',').map(name => name.trim())
  if (names.some(name => name === '')) {
    process.stderr.write('dashi: -g/--group requires nonempty comma-separated names\n')
    process.exit(2)
  }
  groups.push(...names)
}
const profile = process.env.AGENTBUS_LAUNCH_TOKEN === undefined ? 'dashi' : 'agentbus'
const env = groups.length === 0 ? process.env : { ...process.env, AGENTBUS_GROUPS: JSON.stringify(groups) }
const child = spawn('dsh', ['--profile', profile, ...args], { env, stdio: 'inherit' })
const signals = ['SIGINT', 'SIGTERM']
const forwards = signals.map(signal => [signal, () => { child.kill(signal) }])
for (const [signal, forward] of forwards) process.on(signal, forward)

let failed = false
child.on('error', error => {
  failed = true
  const missing = error.code === 'ENOENT'
  process.stderr.write(missing
    ? "dashi: dsh not found; install it with 'npm install --global @deepseek-ai/dsh'\n"
    : `dashi: could not start dsh: ${error.message}\n`)
  process.exitCode = missing ? 127 : 1
})
child.on('close', (code, signal) => {
  for (const [name, forward] of forwards) process.off(name, forward)
  if (failed) return
  if (code !== null) process.exitCode = code
  else if (signal !== null) process.kill(process.pid, signal)
})
