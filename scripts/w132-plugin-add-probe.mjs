import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// Never merged. One warm private store; fresh profiles; first failure is terminal.
// Unlike the failed row: published app, no sibling overrides and no PTY work.
const evidence = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'w132-plugin-add-'))
const home = join(evidence, 'user'), tools = join(evidence, 'tools')
const pnpmHome = join(evidence, 'pnpm-global'), bin = join(evidence, 'global-bin')
for (const directory of [home, tools, pnpmHome, bin]) mkdirSync(directory)
const env = { ...process.env, HOME: home, PNPM_HOME: pnpmHome,
  XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
  XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
  XDG_RUNTIME_DIR: join(home, 'runtime'), npm_config_cache: join(evidence, 'npm-cache'),
  npm_config_userconfig: join(home, '.npmrc'), npm_config_prefix: join(evidence, 'npm-global'),
  DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1',
}
for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'NODE_AUTH_TOKEN', 'NPM_TOKEN', 'SESSIONBUS_LAUNCH_TOKEN',
  'SESSIONBUS_SOCKET', 'SESSIONBUS_GROUPS', 'SESSIONBUS_HUB_SECRET_FILE']) delete env[name]
mkdirSync(env.XDG_RUNTIME_DIR)
writeFileSync(env.npm_config_userconfig, '')
const commandLog = join(evidence, 'commands.log')
const redact = text => text.replace(/(["']?(?:_authToken|_auth|authorization|password|NPM_TOKEN|NODE_AUTH_TOKEN)["']?\s*[:=]\s*)[^\r\n]+/giu, '$1[redacted]')
function copyLogs(from, to) {
  if (!existsSync(from)) return { absent: true, source: from }
  mkdirSync(to)
  for (const name of readdirSync(from)) {
    const file = join(from, name), stat = lstatSync(file)
    if (stat.isDirectory()) copyLogs(file, join(to, name))
    else if (stat.isFile()) writeFileSync(join(to, name), redact(readFileSync(file, 'utf8')))
    else throw new Error('Unexpected operation-log entry: ' + file)
  }
  return { copied: true, source: from }
}
async function capture(child, directory, lifecycle, report) {
  mkdirSync(join(directory, 'failure'), { recursive: true })
  const facts = { capturedAt: new Date().toISOString(), pid: child.pid, lifecycle }
  try {
    const ps = spawnSync('ps', ['-ax', '-o', 'pid=,ppid=,pgid=,stat=,command='], { encoding: 'utf8', timeout: 5_000 })
    if (ps.error || ps.status !== 0) throw ps.error ?? new Error('ps exited ' + ps.status + ': ' + ps.stderr)
    const group = ps.stdout.split('\n').filter(line => Number(line.trim().split(/\s+/u)[2]) === child.pid)
    writeFileSync(join(directory, 'failure', 'process-group.txt'), group.join('\n'))
    facts.logs = copyLogs(join(env.DSH_HOME, 'profiles', 'dashi', '.plugin-manager', 'logs'),
      join(directory, 'failure', 'plugin-manager-logs'))
    if (report) {
      const dsh = group.filter(line => /\/dsh\/lib\/bin\.js(?:\s|$)/u.test(line))
      if (dsh.length !== 1) throw new Error('Expected one tracked dsh process in group, observed ' + dsh.length)
      const pid = Number(dsh[0].trim().split(/\s+/u)[0])
      facts.reportPid = pid
      process.kill(pid, 'SIGUSR2')
      const until = Date.now() + 5_000
      while (Date.now() < until) {
        const files = readdirSync(join(directory, 'reports')).filter(file => file.endsWith('.json'))
        let parsed
        for (const file of files) {
          try { parsed = JSON.parse(readFileSync(join(directory, 'reports', file), 'utf8')) }
          catch (error) { if (!(error instanceof SyntaxError)) throw error }
          if (parsed?.header?.processId === pid) {
            if ('environmentVariables' in parsed) throw new Error('Report leaked environment variables')
            facts.report = file
            facts.libuv = parsed.libuv
            break
          }
        }
        if (facts.report) break
        await new Promise(resolve => { setTimeout(resolve, 50) })
      }
      if (!facts.report) throw new Error('Tracked dsh produced no complete report within 5 seconds')
    }
  } catch (error) {
    facts.captureError = String(error)
    console.error('W-132 capture error: ' + error)
  }
  writeFileSync(join(directory, 'failure', 'capture.json'), JSON.stringify(facts, null, 2))
}
async function call(command, args, directory = evidence, measured = false) {
  const started = Date.now(), lifecycle = []
  const reports = join(directory, 'reports')
  if (measured) mkdirSync(reports)
  const child = spawn(command, args, { cwd: evidence, env: { ...env,
    ...(measured ? { NODE_OPTIONS: '--report-on-signal --report-exclude-env --report-exclude-network --report-directory=' + reports } : {}),
  }, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = '', stderr = '', expired = false, error
  const log = (event, fields = {}) => { lifecycle.push({ at: new Date().toISOString(), event, ...fields }) }
  log('spawn', { pid: child.pid })
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk })
  child.on('error', failed => { error = String(failed); log('error', { error }) })
  child.on('exit', (status, signal) => { log('exit', { status, signal }) })
  const result = await new Promise(resolve => {
    const closed = new Promise(done => { child.once('close', () => { done() }) })
    const deadline = setTimeout(async () => {
      expired = true
      log('deadline', { boundMs: 180_000 })
      await capture(child, directory, lifecycle, measured)
      const signal = name => {
        try { if (child.pid !== undefined) process.kill(-child.pid, name) }
        catch (failed) { if (failed.code !== 'ESRCH') console.error('W-132 cleanup: ' + failed) }
      }
      log('terminate', { signal: 'SIGTERM' })
      signal('SIGTERM')
      const cleanup = setTimeout(() => {
        signal('SIGKILL'); child.stdout.destroy(); child.stderr.destroy()
        resolve({ status: null, timedOut: true })
      }, 2_000)
      void closed.then(() => { clearTimeout(cleanup); resolve({ status: null, timedOut: true }) })
    }, 180_000)
    child.on('close', status => {
      log('close', { status })
      if (expired) return
      clearTimeout(deadline)
      resolve({ status, timedOut: false })
    })
  })
  appendFileSync(commandLog, `${new Date(started).toISOString()} $ ${command} ${args.join(' ')}\n${stdout}${stderr}\nexit=${result.status}; timeout=${result.timedOut}; durationMs=${Date.now() - started}\n`)
  if (measured) writeFileSync(join(directory, 'measured.json'), JSON.stringify({ command, args, ...result,
    error, durationMs: Date.now() - started, lifecycle, stdout, stderr }, null, 2))
  if (result.status !== 0) {
    if (!result.timedOut) await capture(child, directory, lifecycle, false)
    const outcome = { ...result, command, args, error, directory, measured }
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(outcome, null, 2))
    throw new Error(`First failure: ${command} ${args.join(' ')}; status=${result.status}; timeout=${result.timedOut}; ${directory}`)
  }
  return stdout.trim()
}

console.log('W-132 evidence: ' + evidence)
await call('npm', ['install', '--global', '--prefix', tools, 'pnpm@11.18.0'])
const pm = join(tools, 'bin', 'pnpm')
env.PATH = [bin, dirname(pm), process.env.PATH].join(':')
await call(pm, ['config', 'set', 'global-bin-dir', bin])
if (await call(pm, ['bin', '--global']) !== bin) throw new Error('Private global bin mismatch')
if (await call('pnpm', ['--version']) !== '11.18.0') throw new Error('Wrong PATH-selected pnpm')
// Same effective bootable pnpm 11 global layout as the failing cell after its remedy.
await call(pm, ['config', 'set', '--global', '--json', 'enableGlobalVirtualStore', 'false'])
await call(pm, ['add', '--global', '--save-exact', '@deepseek-ai/dsh@0.2.1-alpha.2'])
env.DSH_HOME = join(evidence, 'setup-native')
if (await call('dsh', ['--version']) !== '0.2.1-alpha.2') throw new Error('Wrong DSH')
await call('dsh', ['--profile', 'headless', '--help'])
const provenance = { sha: process.env.GITHUB_SHA, node: process.version, pnpm: '11.18.0',
  platform: process.platform, arch: process.arch, boundMs: 180_000, evidence,
  differences: 'published dashi-app alpha.2 instead of candidate archive; no sibling overrides; no PTY work',
  globalVirtualStore: await call(pm, ['config', 'get', 'enableGlobalVirtualStore']),
}
writeFileSync(join(evidence, 'provenance.json'), JSON.stringify(provenance, null, 2))
const started = Date.now()
let limit = 200
for (let iteration = 1; iteration <= limit; iteration++) {
  const directory = join(evidence, 'iteration-' + iteration)
  mkdirSync(directory)
  env.DSH_HOME = join(directory, 'native')
  const paths = { store: await call(pm, ['store', 'path']),
    userconfig: await call(pm, ['config', 'get', 'userconfig']),
    globalconfig: await call(pm, ['config', 'get', 'globalconfig']), pnpmHome,
  }
  writeFileSync(join(directory, 'paths.json'), JSON.stringify(paths, null, 2))
  await call('dsh', ['plugin', '--profile', 'dashi', 'install'], directory)
  await call('dsh', ['plugin', '--profile', 'dashi', 'add', '@antst/dashi-app@0.2.0-alpha.2'], directory)
  await call('dsh', ['plugin', '--profile', 'dashi', 'add', '@deepseek-ai/dsh-llm-replay@0.2.1-alpha.2'], directory, true)
  appendFileSync(join(evidence, 'iterations.jsonl'), JSON.stringify({ iteration, elapsedMs: Date.now() - started, store: paths.store }) + '\n')
  console.log(`W-132 iteration ${iteration}/${limit} PASS`)
  if (iteration === 5 && (Date.now() - started) / 5 * 200 > 3_600_000) {
    limit = 100
    console.log('Measured per-iteration cost projects beyond one hour for 200; approved limit is now 100')
  }
}
const summary = `NOT REPRODUCED in ${limit} fresh published-app profiles; ${(Date.now() - started) / 1000}s; ${provenance.differences}`
console.log(summary)
writeFileSync(join(evidence, 'result.json'), JSON.stringify({ reproduced: false, iterations: limit, summary }, null, 2))
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n')
