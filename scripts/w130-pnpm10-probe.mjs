import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

// Never-merged W-130 probe: one private warm cell/store, 200 fresh projects.
// Unlike the failed cell this installs no DSH closure and runs no prior PTY smoke.
// A non-zero transition ends the job; there is no retry or recovery.
const repo = process.cwd()
const evidence = mkdtempSync(join(process.env.RUNNER_TEMP ?? tmpdir(), 'w130-pnpm10-'))
const user = join(evidence, 'user')
const tools = join(evidence, 'tools')
const pnpmHome = join(evidence, 'pnpm-global')
const bin = join(evidence, 'global-bin')
const artifacts = join(evidence, 'artifacts')
for (const path of [user, tools, pnpmHome, bin, artifacts]) mkdirSync(path)
const env = {
  ...process.env, HOME: user, PNPM_HOME: pnpmHome,
  XDG_CONFIG_HOME: join(user, 'config'), XDG_CACHE_HOME: join(user, 'cache'),
  XDG_DATA_HOME: join(user, 'data'), XDG_STATE_HOME: join(user, 'state'),
  XDG_RUNTIME_DIR: join(user, 'runtime'), npm_config_cache: join(evidence, 'npm-cache'),
  npm_config_userconfig: join(user, '.npmrc'), npm_config_prefix: join(evidence, 'npm-global'),
}
for (const name of ['NODE_PATH', 'NODE_AUTH_TOKEN', 'NPM_TOKEN', 'SESSIONBUS_LAUNCH_TOKEN',
  'SESSIONBUS_SOCKET', 'SESSIONBUS_GROUPS', 'SESSIONBUS_HUB_SECRET_FILE']) delete env[name]
mkdirSync(env.XDG_RUNTIME_DIR)
writeFileSync(env.npm_config_userconfig, '')
const log = join(evidence, 'commands.log')
function call(command, args, cwd = evidence) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 180_000 })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  appendFileSync(log, `${new Date(started).toISOString()} $ ${command} ${args.join(' ')}\ncwd=${cwd}\n${stdout}${stderr}\nexit=${result.status}; durationMs=${Date.now() - started}\n`)
  return { status: result.status, stdout, stderr, error: result.error?.message }
}
function requireSuccess(command, args, cwd) {
  const result = call(command, args, cwd)
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.error ?? result.stderr}`)
  return result.stdout.trim()
}
function attempt(operation) {
  try { return { ok: true, value: operation() } }
  catch (error) { return { ok: false, code: error.code, syscall: error.syscall, message: error.message, stack: error.stack } }
}
function pathFacts(path) {
  const facts = []
  for (let current = resolve(path);;) {
    facts.push({ path: current,
      lstat: attempt(() => { const s = lstatSync(current); return { mode: s.mode, size: s.size, ino: s.ino, dev: s.dev, symlink: s.isSymbolicLink(), directory: s.isDirectory() } }),
      readlink: attempt(() => readlinkSync(current)), realpath: attempt(() => realpathSync(current)),
      read: attempt(() => { const bytes = readFileSync(current); return { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') } }),
    })
    const parent = dirname(current)
    if (parent === current) return facts
    current = parent
  }
}
console.log(`W-130 evidence: ${evidence}; Node ${process.version}; ${process.platform}-${process.arch}`)
requireSuccess('npm', ['install', '--global', '--prefix', tools, 'pnpm@10.28.1'])
const pm = join(tools, 'bin', 'pnpm')
env.PATH = [bin, dirname(pm), process.env.PATH].join(':')
requireSuccess(pm, ['config', 'set', 'global-bin-dir', bin])
if (requireSuccess(pm, ['bin', '--global']) !== bin) throw new Error('Private global bin mismatch')
if (requireSuccess('pnpm', ['--version']) !== '10.28.1') throw new Error('PATH selected the wrong pnpm')
requireSuccess('npm', ['pack', './packages/dashi-launcher', '--pack-destination', artifacts, '--ignore-scripts'], repo)
const archive = join(artifacts, readdirSync(artifacts).find(file => file.endsWith('.tgz')))
const archiveHash = createHash('sha256').update(readFileSync(archive)).digest('hex')
writeFileSync(join(evidence, 'provenance.json'), JSON.stringify({ repo, candidateSha: process.env.GITHUB_SHA,
  archive, archiveHash, node: process.version, pnpm: '10.28.1', iterations: 200,
  limits: 'launcher-only: no DSH closure; no preceding PTY smoke; shared warm private store',
}, null, 2))
requireSuccess('df', ['-T', evidence])
requireSuccess('mount', [])
const started = Date.now()
for (let iteration = 1; iteration <= 200; iteration++) {
  const project = join(evidence, `project-${iteration}`)
  mkdirSync(project)
  writeFileSync(join(project, 'package.json'), '{"private":true}\n')
  const store = requireSuccess(pm, ['store', 'path'], project)
  const userConfig = requireSuccess(pm, ['config', 'get', 'userconfig'], project)
  const globalConfig = requireSuccess(pm, ['config', 'get', 'globalconfig'], project)
  const configRoots = { userConfig, globalConfig, xdg: env.XDG_CONFIG_HOME, pnpmHome, store }
  writeFileSync(join(project, 'paths.json'), JSON.stringify(configRoots, null, 2))
  const target = join(project, 'node_modules', '@antst', 'dashi-launcher', 'package.json')
  const commands = [
    ['add', '--save-exact', `file:${archive}`],
    ['add', '--save-exact', '@antst/dashi-launcher@0.2.0-alpha.1'],
  ]
  for (const [step, args] of commands.entries()) {
    // Reporter is diagnostic-only; package specs and transition are unchanged.
    const result = call(pm, [...args, '--reporter=ndjson'], project)
    writeFileSync(join(project, `step-${step}.ndjson`), result.stdout + result.stderr)
    if (result.status !== 0) {
      writeFileSync(join(project, 'failure.json'), JSON.stringify({ iteration, step, args, ...result, configRoots, facts: pathFacts(target) }, null, 2))
      const processes = call('ps', ['-ax', '-o', 'pid,ppid,command'])
      writeFileSync(join(project, 'processes.txt'), processes.stdout + processes.stderr)
      call('df', ['-T', project])
      call('mount', [])
      for (const file of [join(project, 'pnpm-debug.log'), join(project, 'pnpm.log')]) {
        if (existsSync(file)) writeFileSync(join(project, `captured-${file.split('/').at(-1)}`), readFileSync(file))
      }
      const summary = `REPRODUCED: iteration ${iteration}, step ${step}, exit ${result.status}; evidence ${evidence}`
      console.error(summary)
      if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
      process.exit(1)
    }
  }
  // Every successful transition really selected the published launcher.
  const selected = JSON.parse(readFileSync(target, 'utf8'))
  if (selected.version !== '0.2.0-alpha.1') throw new Error(`iteration ${iteration} selected ${selected.version}`)
  appendFileSync(join(evidence, 'iterations.jsonl'), `${JSON.stringify({ iteration, published: selected.version, store, elapsedMs: Date.now() - started })}\n`)
  console.log(`W-130 iteration ${iteration}/200 PASS`)
}
const summary = `NOT REPRODUCED in 200 launcher-only transitions (${((Date.now() - started) / 1000).toFixed(2)}s); no DSH closure or preceding PTY smoke; evidence ${evidence}`
console.log(summary)
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`)
