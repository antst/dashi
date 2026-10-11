import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { TestPtyShell } from './pty-shell.js'
import { assertActiveRuntime, type RuntimeRecord } from './runtime-record.js'
import { currentRecordedJsonl, recordedSession } from './fixtures/session-format.js'
import { startTestDaemon } from './sessionbus-harness.js'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const layout = process.env.DASHI_INSTALL_LAYOUT
const layouts = ['G-npm', 'G-pnpm10', 'G-pnpm11', 'G-npx', 'P-npm', 'P-pnpm']
if (!layouts.includes(layout ?? '')) throw new Error('DASHI_INSTALL_LAYOUT must name one hosted install cell')
const version = '0.2.1-alpha.2'
const previous = '0.2.0-alpha.1'
const current = '0.2.0-alpha.2'
const nativeBindingError = `No usable native binding found for node-addon-require-builtin-${process.platform}-${process.arch}`
const workspace = mkdtempSync(join(process.env.DASHI_INSTALL_EVIDENCE ?? tmpdir(), `dashi-${layout}-`))
const home = join(workspace, 'user')
const project = join(workspace, 'project')
const tools = join(workspace, 'tools')
const globalPrefix = join(workspace, 'npm-global')
const pnpmHome = join(workspace, 'pnpm-global')
const dshHome = join(workspace, 'native-home')
const artifactDir = join(workspace, 'candidate')
for (const path of [home, project, tools, globalPrefix, pnpmHome, artifactDir]) mkdirSync(path)
const npmPath = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim()
const systemPath = [dirname(process.execPath), dirname(npmPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter)
const env: NodeJS.ProcessEnv = {
  ...process.env, HOME: home, DSH_HOME: dshHome,
  XDG_CONFIG_HOME: join(home, 'config'), XDG_CACHE_HOME: join(home, 'cache'),
  XDG_DATA_HOME: join(home, 'data'), XDG_STATE_HOME: join(home, 'state'),
  XDG_RUNTIME_DIR: join(home, 'runtime'), PNPM_HOME: pnpmHome,
  npm_config_cache: join(workspace, 'npm-cache'), npm_config_userconfig: join(home, '.npmrc'),
  npm_config_prefix: globalPrefix,
  DSH_TELEMETRY_DISABLED: '1', NO_COLOR: '1', TERM: 'xterm-256color', PS1: '', PROMPT_COMMAND: '',
  GIT_CONFIG_COUNT: '0', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
}
for (const key of ['NODE_PATH', 'SESSIONBUS_LAUNCH_TOKEN', 'SESSIONBUS_GROUPS', 'SESSIONBUS_SOCKET',
  'SESSIONBUS_HUB', 'SESSIONBUS_HUB_SECRET_FILE', 'DSH_DASHI_ROOT_EVENTS']) delete env[key]
mkdirSync(env.XDG_RUNTIME_DIR as string)
writeFileSync(env.npm_config_userconfig as string, '')
writeFileSync(join(project, 'package.json'), '{"private":true}\n')
let output = ''
function run(command: string, args: string[], cwd = project, extra: NodeJS.ProcessEnv = {}, success: boolean | number = true): string {
  const result = spawnSync(command, args, {
    cwd, env: { ...env, ...extra }, encoding: 'utf8', timeout: 180_000,
  })
  const commandLine = `${command} ${args.join(' ')}`
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`
  output += `\n$ ${commandLine}\n${text}\nexit=${result.status}\n`
  writeFileSync(join(workspace, 'commands.log'), output)
  console.log(`install cell: ${commandLine} -> ${result.status}`)
  if (success === true && result.status !== 0) throw new Error(`${commandLine}: ${result.error ?? result.status}\n${text}`)
  if (success === false) expect(result.status, commandLine).not.toBe(0)
  if (typeof success === 'number') expect(result.status, commandLine).toBe(success)
  return success === true ? result.stdout : text
}
function quote(text: string): string { return `'${text.replaceAll("'", "'\\''")}'` }
function findLog(directory: string, id: string): string | undefined {
  if (!existsSync(directory)) return undefined
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      const found = findLog(path, id)
      if (found !== undefined) return found
    } else if (path.includes(id) && /^session(?:\.v\d+)?\.jsonl$/u.test(entry)) return path
  }
  return undefined
}

it(`${layout}: published install, upgrade, native runtime and packed-candidate continuity`, async () => {
  const started = performance.now()
  const daemon = await startTestDaemon()
  env.SESSIONBUS_SOCKET = daemon.socket
  env.SESSIONBUS_GROUPS = '["install-proof"]'
  try {
    console.log(`install cell evidence: ${workspace}; Node ${process.version}; ${process.platform}-${process.arch}`)
    env.PATH = systemPath
    const pmVersion = layout === 'G-pnpm11' ? '11.18.0' : '10.28.1'
    run('npm', ['install', '--global', '--prefix', tools, `pnpm@${pmVersion}`])
    const pm = join(tools, 'bin', 'pnpm')
    env.PATH = [dirname(pm), systemPath].join(delimiter)
    if (layout?.includes('pnpm')) {
      run(pm, ['setup'], project, { SHELL: '/bin/bash' })
      // Read the PATH from pnpm's own generated shell setup, not an assumed v10/v11 bin layout.
      env.PATH = run('/bin/bash', ['--noprofile', '--norc', '-c', '. "$HOME/.bashrc"; printf "%s" "$PATH"']).trim()
    }
    const globalBin = layout?.includes('pnpm') ? run(pm, ['bin', '--global']).trim() : join(globalPrefix, 'bin')
    env.PATH = [globalBin, dirname(pm), systemPath].join(delimiter)
    run('node', ['--version'])
    run('npm', ['--version'])
    expect(run(pm, ['--version']).trim()).toBe(pmVersion)
    const npx = (args: string[]): string[] => ['--yes', `@deepseek-ai/dsh@${version}`, ...args]
    let launcherPackage = `@antst/dashi-launcher@${current}`
    const cli = (args: string[], success: boolean | number = true, extra: NodeJS.ProcessEnv = {}): string => {
      if (layout === 'G-npx') return run('npx', npx(args), project, extra, success)
      if (layout === 'P-npm') return run('npm', ['exec', '--', 'dsh', ...args], project, extra, success)
      if (layout === 'P-pnpm') return run(pm, ['exec', 'dsh', ...args], project, extra, success)
      return run('dsh', args, project, extra, success)
    }
    const installLauncher = (target: string): void => {
      const packageName = target.endsWith('.tgz') ? target : `@antst/dashi-launcher@${target}`
      launcherPackage = packageName
      if (layout === 'G-npx') {
        // Package acquisition uses the installer budget, not the PTY's native-ready wait.
        expect(run('npx', ['--yes', `--package=@deepseek-ai/dsh@${version}`, `--package=${packageName}`, 'dashi', '--version']).trim()).toBe(version)
        return
      }
      if (layout === 'G-npm') run('npm', ['install', '-g', packageName])
      else if (layout?.startsWith('G-pnpm')) run(pm, ['add', '-g', packageName])
      else if (layout === 'P-npm') run('npm', ['install', '--save-exact', packageName])
      else run(pm, ['add', '--save-exact', packageName])
    }
    const launcher = (args: string[] = [], global = false): string => {
      if (layout === 'G-npx') return `npx --yes --package=@deepseek-ai/dsh@${version} --package=${quote(launcherPackage)} dashi ${args.map(quote).join(' ')}`
      if (global || layout?.startsWith('G-')) return `dashi ${args.map(quote).join(' ')}`
      return `${layout === 'P-npm' ? 'npm exec -- dashi' : `${quote(pm)} exec dashi`} ${args.map(quote).join(' ')}`
    }
    if (layout === 'G-npm' || layout === 'P-npm') {
      run('npm', ['install', '-g', `@deepseek-ai/dsh@${version}`])
      run('npm', ['install', '-g', `@antst/dashi-launcher@${current}`])
    } else if (layout !== 'G-npx') {
      run(pm, ['add', '-g', `@deepseek-ai/dsh@${version}`])
      run(pm, ['add', '-g', `@antst/dashi-launcher@${current}`])
    }
    if (layout === 'G-pnpm11') {
      const broken = cli(['--profile', 'headless', '--help'], false)
      expect(broken).toContain(nativeBindingError)
      run(pm, ['config', 'set', '--global', '--json', 'enableGlobalVirtualStore', 'false'])
      expect(run(pm, ['config', 'get', 'enableGlobalVirtualStore']).trim()).toBe('false')
      run(pm, ['remove', '-g', '@deepseek-ai/dsh'])
      run(pm, ['add', '-g', `@deepseek-ai/dsh@${version}`])
      cli(['--profile', 'headless', '--help'])
    }
    if (layout?.startsWith('P-')) {
      if (layout === 'P-npm') run('npm', ['install', '--save-exact', `@deepseek-ai/dsh@${version}`, `@antst/dashi-launcher@${previous}`])
      else run(pm, ['add', '--save-exact', `@deepseek-ai/dsh@${version}`, `@antst/dashi-launcher@${previous}`])
    }
    if (layout === 'G-npm') {
      const noPnpm = cli(['plugin', '--profile', 'missing-pnpm', 'add', `@antst/dashi-app@${current}`],
        127, { PATH: [globalBin, dirname(process.execPath)].join(delimiter) })
      expect(noPnpm).toContain('dsh: pnpm was not found; install pnpm and make it available on PATH.')
    }
    expect(cli(['--version']).trim()).toBe(version)
    if (!layout?.startsWith('P-')) installLauncher(previous)
    cli(['plugin', '--profile', 'dashi', 'add', `@antst/dashi-app@${previous}`])
    // Recorded-model setup, not dependency repair: no hook, override or companion add.
    cli(['plugin', '--profile', 'dashi', 'add', `@deepseek-ai/dsh-llm-replay@${version}`])
    const snapshot = join(workspace, 'recorded.jsonl')
    writeFileSync(snapshot, currentRecordedJsonl(join(root, 'packages/dashi/tests/fixtures/three-turn-session.jsonl')))
    const observer = pathToFileURL(join(root, 'packages/dashi/tests/fixtures/runtime-observer.mjs')).href
    const patch = join(workspace, 'recorded.patch.yml')
    writeFileSync(patch, readFileSync(join(root, 'packages/dashi/tests/fixtures/clean-replay.patch.yml'), 'utf8')
      + `\n- insert:\n    - id: runtime-observer\n      name: '${observer}'\n`)
    const smoke = async (
      target: string, resume?: string, global = false, phase: 'published' | 'candidate' = 'published', directNpx = false,
    ): Promise<string> => {
      const nativeHome = env.DSH_HOME as string
      const priorLog = resume === undefined ? undefined : findLog(join(nativeHome, 'replay-sessions'), resume)
      const priorEvents = priorLog === undefined ? [] : recordedSession(priorLog).events
      const priorSeq = priorEvents.at(-1)?.seq ?? -1
      const nativeTurn = priorEvents.filter(event => event.type === 'turn/start').length + 1
      const label = `${target}-${resume ?? 'fresh'}-${global}${directNpx ? '-direct-npx' : ''}${nativeHome === dshHome ? '' : '-from-alpha1'}`
      const runtimePath = join(workspace, `runtime-${label}.json`)
      const shell = new TestPtyShell(project, {
        ...env, DSH_SNAPSHOT_FILE: snapshot, DASHI_RUNTIME_RECORD: runtimePath,
      })
      try {
        const args = ['--patch', patch, '--fullscreen', ...(resume === undefined ? ['install smoke'] : ['--resume', resume])]
        const command = directNpx
          ? `npx --yes @deepseek-ai/dsh@${version} --profile dashi ${args.map(quote).join(' ')}`
          : launcher(args, global)
        shell.write(`${command}; printf '\\n__W124_EXIT__%s\\n' "$?"\n`)
        // Acquisition was warmed separately; this is a strict native-ready budget, including CI.
        await vi.waitFor(() => { expect(shell.output, shell.output.slice(-4000)).toContain('idle ·') }, { timeout: 20_000 })
        expect(shell.output).not.toContain('The following package was not found and will be installed')
        expect(shell.output).not.toContain('Need to install the following packages')
        const id = /session-[0-9a-f-]{36}/u.exec(shell.output)?.[0]
        expect(id, shell.output.slice(-4000)).toBeDefined()
        await vi.waitFor(() => { expect(existsSync(runtimePath), shell.output.slice(-4000)).toBe(true) }, { timeout: 20_000 })
        const runtime = JSON.parse(readFileSync(runtimePath, 'utf8')) as RuntimeRecord
        assertActiveRuntime(runtime, version, target, phase)
        expect(runtime.packages['@deepseek-ai/dsh']?.dir.startsWith(workspace)).toBe(true)
        console.log(`active runtime ${target}: ${JSON.stringify(Object.fromEntries(
          Object.entries(runtime.packages).map(([name, pkg]) => [name, { version: pkg.version, dir: pkg.dir }])))}; DSH selections=${runtime.resolution.filter(pkg => pkg.name.startsWith('@deepseek-ai/dsh')).length}`)
        if (resume !== undefined) shell.write('upgrade smoke\r')
        await vi.waitFor(() => {
          const log = findLog(join(nativeHome, 'replay-sessions'), id as string)
          expect(log, shell.output.slice(-4000)).toBeDefined()
          const events = recordedSession(log as string).events.filter(event => event.seq > priorSeq)
          expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
          expect(events.some(event => event.type === 'assistant/message'
            && JSON.stringify(event.data).includes('First turn complete.')
            && (event.data as { turn: number }).turn === nativeTurn)).toBe(true)
          expect(events.some(event => event.type === 'turn/end'
            && (event.data as { turn: number; reason: { kind: string } }).turn === nativeTurn
            && (event.data as { reason: { kind: string } }).reason.kind === 'completed')).toBe(true)
        }, { timeout: 30_000 })
        shell.write('/exit\r')
        await shell.waitFor('__W124_EXIT__0')
        expect(shell.output).not.toContain('versions must match')
        return id as string
      } finally {
        writeFileSync(join(workspace, `pty-${label}.log`), shell.output)
        await shell.close()
      }
    }
    // npx pins the launcher in the command itself, not a durable global installation.
    // Install alpha.1/alpha.2 profile through the same executing DSH and retain its native id.
    const id = await smoke(previous)
    installLauncher(current)
    cli(['plugin', '--profile', 'dashi', 'add', `@antst/dashi-app@${current}`])
    await smoke(current, id)
    if (layout?.startsWith('P-')) {
      // Ordinary bare global and manager-exec project invocation share one native home.
      const globalVersion = run('/bin/bash', ['--noprofile', '--norc', '-c', 'command -v dsh; dashi --version']).trim().split('\n')
      expect(globalVersion[0]).toBe(join(globalBin, 'dsh'))
      expect(globalVersion.at(-1)).toBe(version)
      expect(cli(['--version']).trim()).toBe(version)
      const projectVersion = layout === 'P-npm'
        ? run('npm', ['exec', '--', 'dashi', '--version']) : run(pm, ['exec', 'dashi', '--version'])
      expect(projectVersion.trim()).toBe(version)
      await smoke(current, undefined, true)
      const nativeProject = JSON.parse(readFileSync(join(workspace, `runtime-${current}-${id}-false.json`), 'utf8')) as RuntimeRecord
      const nativeGlobal = JSON.parse(readFileSync(join(workspace, `runtime-${current}-fresh-true.json`), 'utf8')) as RuntimeRecord
      expect(nativeProject.packages['@deepseek-ai/dsh']?.dir).not.toBe(nativeGlobal.packages['@deepseek-ai/dsh']?.dir)
      expect(nativeProject.packages['@deepseek-ai/dsh']?.dir.startsWith(project)).toBe(true)
    }
    if (layout === 'G-npx') await smoke(current, undefined, false, 'published', true)
    // Packed candidate is explicitly not a future registry publication.
    const artifacts: Record<string, string> = {}
    for (const [name, directory] of Object.entries({
      '@antst/dsh-file-uploads-none': 'file-uploads-none', '@antst/dashi': 'dashi',
      '@antst/dashi-app': 'dashi-app', '@antst/dashi-launcher': 'dashi-launcher',
    })) {
      const before = new Set(readdirSync(artifactDir))
      const packed = run('pnpm', ['pack', '--pack-destination', artifactDir],
        join(root, 'packages', directory), process.env)
      console.log(`candidate provenance ${name}: ${packed}`)
      const file = readdirSync(artifactDir).find(entry => entry.endsWith('.tgz') && !before.has(entry))
      expect(file).toBeDefined()
      artifacts[name] = join(artifactDir, file as string)
    }
    // Prepublication sibling wiring ONLY; no DSH/companion declaration is rewritten.
    const candidateVersion = JSON.parse(readFileSync(join(root, 'packages/dashi/package.json'), 'utf8')).version as string
    const installCandidate = async (): Promise<void> => {
      const profileWorkspace = join(env.DSH_HOME as string, 'profiles', 'dashi', 'pnpm-workspace.yaml')
      writeFileSync(profileWorkspace, readFileSync(profileWorkspace, 'utf8')
        + `\noverrides:\n  '@antst/dashi-app>@antst/dashi': 'file:${artifacts['@antst/dashi']}'\n`
        + `  '@antst/dashi-app>@antst/dsh-file-uploads-none': 'file:${artifacts['@antst/dsh-file-uploads-none']}'\n`)
      installLauncher(artifacts['@antst/dashi-launcher'] as string)
      cli(['plugin', '--profile', 'dashi', 'add', artifacts['@antst/dashi-app'] as string])
      await smoke(candidateVersion, undefined, false, 'candidate')
      const suffix = env.DSH_HOME === dshHome ? '' : '-from-alpha1'
      const candidateRuntime = JSON.parse(readFileSync(join(workspace, `runtime-${candidateVersion}-fresh-false${suffix}.json`), 'utf8'))
      expect(candidateRuntime.packages['@antst/dashi'].entryHash).toBe(createHash('sha256')
        .update(readFileSync(join(root, 'packages/dashi/lib/index.js'))).digest('hex'))
    }
    await installCandidate()
    // Direct alpha.1→candidate also converges; alpha.2 cannot first repair its shadow for us.
    env.DSH_HOME = join(workspace, 'native-home-from-alpha1')
    installLauncher(previous)
    cli(['plugin', '--profile', 'dashi', 'add', `@antst/dashi-app@${previous}`])
    cli(['plugin', '--profile', 'dashi', 'add', `@deepseek-ai/dsh-llm-replay@${version}`])
    await smoke(previous)
    await installCandidate()
    const wallSeconds = (performance.now() - started) / 1000
    const result = { layout, platform: `${process.platform}-${process.arch}`, node: process.version, wallSeconds, passed: true }
    writeFileSync(join(workspace, 'result.json'), JSON.stringify(result))
    if (process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\nInstall ${layout} / ${result.platform}: PASS, ${wallSeconds.toFixed(2)}s (published alpha.1→alpha.2; both baselines→identified packed candidate).\n`)
    console.log(`install cell PASS ${layout}; wall ${wallSeconds.toFixed(2)}s; evidence ${workspace}`)
  } finally {
    await daemon.close()
    writeFileSync(join(workspace, 'commands.log'), output)
  }
})

