#!/usr/bin/env node
import { spawn } from 'node:child_process'

const child = spawn('dsh', ['--profile', 'dashi', ...process.argv.slice(2)], { stdio: 'inherit' })
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
