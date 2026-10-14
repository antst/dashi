import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { expect, it, vi } from 'vitest'
import { TestPtyShell } from './pty-shell.js'
import { assertActiveRuntime, type RuntimeRecord } from './runtime-record.js'
import { currentRecordedJsonl, recordedSession } from './fixtures/session-format.js'
import { startTestDaemon } from './sessionbus-harness.js'
import { isExpectedInstallOutcome, recordInstallFailure, recordInstallTimeout, runInstallCommand } from './install-failure.js'
import { pruneInstallLayout } from './install-layout-cleanup.js'

// README commands are literal except for three declared prepublication deviations:
// published baseline version substitution; packed-candidate spec substitution;
// native profile initialisation plus sibling-tarball overrides before the documented add;
// only the below-floor byte-snapshot control has a --no-frozen-lockfile consistency install.
// The below-floor CLI version is an adverse control; replay/observer composition is a model fixture.
const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const layout = process.env.DASHI_INSTALL_LAYOUT
const layouts = ['G-npm', 'G-pnpm10', 'G-pnpm11', 'G-pnpm12', 'G-npx', 'P-npm', 'P-pnpm10', 'P-pnpm11', 'P-pnpm12', 'below-floor']
if (!layouts.includes(layout ?? '')) throw new Error('DASHI_INSTALL_LAYOUT must name one hosted install cell')
const pmVersion = process.env.DASHI_INSTALL_PNPM
if (!pmVersion) throw new Error('DASHI_INSTALL_PNPM is owned by the workflow and must be explicit')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const installSection = readme.split('\n## Install\n')[1]?.split('\n## ')[0]
if (installSection === undefined) throw new Error('README Install section is missing')
const fences: Record<string, string[]> = {}
const markerOwners = new Map<string, string>()
const consumedMarkers = new Set<string>()
for (const fence of installSection.matchAll(/```sh\n([\s\S]*?)\n```/gu)) {
  const marker = /<!-- ([\w: -]+) -->\s*$/u.exec(installSection.slice(0, fence.index))
  if (!marker) throw new Error('README Install sh fence has no row marker: ' + fence[1])
  for (const name of marker[1]!.split(' ')) {
    const owner = layouts.find(row => ['install:', 'upgrade:'].some(prefix =>
      name === prefix + row || name.startsWith(prefix + row + '-')))
    if (!owner) throw new Error('README Install marker names no matrix row: ' + name)
    if (fences[name]) throw new Error('README Install marker is duplicated: ' + name)
    fences[name] = fence[1]!.split('\n')
    markerOwners.set(name, owner)
  }
}
const version = /@deepseek-ai\/dsh@(\S+)/u.exec(fences['install:G-npm']?.join('\n') ?? '')?.[1]
if (!version) throw new Error('README global install does not declare an exact DSH version')
const current = JSON.parse(readFileSync(join(root, 'packages/dashi/package.json'), 'utf8')).version as string
const nativeBindingError = 'No usable native binding found for node-addon-require-builtin-' + process.platform + '-' + process.arch
const workspace = mkdtempSync(join(process.env.DASHI_INSTALL_EVIDENCE ?? tmpdir(), 'dashi-' + layout + '-'))
const home = join(workspace, 'user')
let project = join(workspace, 'project')
const tools = join(workspace, 'tools')
const globalPrefix = join(workspace, 'npm-global')
const pnpmHome = join(workspace, 'pnpm-global')
const pnpmBin = join(workspace, 'global-bin')
const artifactDir = join(workspace, 'candidate')
for (const path of [home, project, tools, globalPrefix, pnpmHome, pnpmBin, artifactDir]) mkdirSync(path)
const npmPath = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', 'command -v npm'], { encoding: 'utf8' }).stdout.trim()
const systemPath = [dirname(process.execPath), dirname(npmPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(delimiter)
const env: NodeJS.ProcessEnv = {
  ...process.env, HOME: home, DSH_HOME: join(workspace, 'native-fresh'),
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
async function run(command: string, args: string[], cwd = project, extra: NodeJS.ProcessEnv = {}, success: boolean | number = true): Promise<string> {
  const started = performance.now()
  const commandEnv = { ...env, ...extra }
  const result = await runInstallCommand({ command, args, cwd, env: commandEnv, timeoutMs: 180_000,
    onTimeout: pid => {
      const capture = recordInstallTimeout({ pid, command, args, env: commandEnv, evidence: workspace })
      console.error('install timeout evidence (before termination): ' + capture)
    },
  })
  const durationMs = performance.now() - started
  const commandLine = command + ' ' + args.join(' ')
  const text = (result.stdout ?? '') + (result.stderr ?? '')
  output += '\n$ ' + commandLine + '\n' + text + '\nexit=' + result.status + '; durationMs=' + durationMs.toFixed(2) + '\n'
  writeFileSync(join(workspace, 'commands.log'), output)
  console.log('install cell: ' + commandLine + ' -> ' + result.status + '; durationMs=' + durationMs.toFixed(2))
  const expected = isExpectedInstallOutcome(result, success)
  if (!expected && /(?:^|[\s/])(?:npm|pnpm|npx)(?:\s|$)|\bplugin\s+--profile\s+\S+\s+(?:add|remove|install)\b/u.test(commandLine)) {
    try {
      const capture = recordInstallFailure({ command, args, cwd, env: { ...env, ...extra },
        evidence: workspace, pnpm: join(tools, 'bin', 'pnpm'), output: text, status: result.status })
      console.log('install failure evidence: ' + capture)
    } catch (error) {
      console.error('install failure capture failed: ' + String(error))
    }
  }
  // Expected native refusals require an exit status, never a timeout, spawn failure or signal.
  if (!expected) throw new Error(commandLine + ': ' + (result.error ?? result.status) + '\n' + text)
  return success === true ? result.stdout : text
}
function quote(text: string): string { return "'" + text.replaceAll("'", "'\\''") + "'" }
async function sh(command: string, success: boolean | number = true, extra: NodeJS.ProcessEnv = {}): Promise<string> {
  return await run('/bin/bash', ['--noprofile', '--norc', '-c', command], project, extra, success)
}
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
function packageAt(file: string): string {
  let directory = dirname(realpathSync(file))
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory)
    if (parent === directory) throw new Error('No package owns ' + file)
    directory = parent
  }
  return directory
}

it(layout + ': literal README installs converge from fresh and both published baselines', async ({ onTestFinished }) => {
  const started = performance.now()
  let result: Record<string, unknown> | undefined
  onTestFinished(context => {
    if (context.task.result?.state !== 'pass') return
    pruneInstallLayout(workspace)
    writeFileSync(join(workspace, 'result.json'), JSON.stringify(result))
    if (result?.platform !== undefined && process.env.GITHUB_STEP_SUMMARY !== undefined) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      '\nInstall ' + layout + ' / ' + result.platform + ': PASS, ' + Number(result.wallSeconds).toFixed(2)
      + 's (fresh candidate, alpha.1→candidate, alpha.2→candidate).\n')
    console.log('install cell PASS ' + layout + '; wall ' + Number(result?.wallSeconds).toFixed(2) + 's; evidence ' + workspace)
  })
  const daemon = await startTestDaemon()
  env.SESSIONBUS_SOCKET = daemon.socket
  env.SESSIONBUS_GROUPS = '["install-proof"]'
  try {
    console.log('install cell evidence: ' + workspace + '; Node ' + process.version + '; ' + process.platform + '-' + process.arch)
    env.PATH = systemPath
    await run('npm', ['install', '--global', '--prefix', tools, 'pnpm@' + pmVersion])
    const pm = join(tools, 'bin', 'pnpm')
    env.PATH = [dirname(pm), systemPath].join(delimiter)
    if (layout?.includes('pnpm')) {
      // The fixture owns its bin directory, not pnpm's per-major layout or shell setup.
      env.PATH = [pnpmBin, env.PATH].join(delimiter)
      await run(pm, ['config', 'set', 'global-bin-dir', pnpmBin])
      expect((await run(pm, ['bin', '--global'])).trim()).toBe(pnpmBin)
    }
    env.PATH = [join(globalPrefix, 'bin'), env.PATH].join(delimiter)
    await run('node', ['--version'])
    await run('npm', ['--version'])
    expect((await sh('pnpm --version')).trim()).toBe(pmVersion)

    const artifacts: Record<string, string> = {}
    const packedFiles: Record<string, string[]> = {}
    for (const [name, directory] of Object.entries({
      '@antst/dsh-file-uploads-none': 'file-uploads-none', '@antst/dashi': 'dashi',
      '@antst/dashi-app': 'dashi-app', '@antst/dashi-launcher': 'dashi-launcher',
    })) {
      const before = new Set(readdirSync(artifactDir))
      const packed = await run('pnpm', ['pack', '--pack-destination', artifactDir],
        join(root, 'packages', directory), process.env)
      console.log('candidate provenance ' + name + ': ' + packed)
      const file = readdirSync(artifactDir).find(entry => entry.endsWith('.tgz') && !before.has(entry))
      expect(file).toBeDefined()
      artifacts[name] = join(artifactDir, file as string)
      packedFiles[name] = execFileSync('tar', ['-tzf', artifacts[name]!], { encoding: 'utf8' }).split('\n')
        .filter(file => file.startsWith('package/') && !file.endsWith('/'))
    }
    const commands = (marker: string, target: string, candidate = false): string[] => {
      const source = fences[marker]
      if (!source) throw new Error('README command fence missing: ' + marker)
      consumedMarkers.add(marker)
      return source.map(line => line.replace(/@antst\/(?:dashi-app|dashi-launcher)@[\w.-]+/gu, spec => {
        const name = spec.slice(0, spec.lastIndexOf('@'))
        return candidate ? quote(artifacts[name]!) : name + '@' + target
      }))
    }
    const installMarker = 'install:' + layout
    const upgradeMarker = layout === 'G-npx' ? installMarker : 'upgrade:' + layout
    const cliPrefix = layout === 'G-npx' ? 'npx --yes @deepseek-ai/dsh@' + version
      : layout === 'P-npm' ? 'npm exec -- dsh' : layout?.startsWith('P-pnpm') ? 'pnpm exec dsh' : 'dsh'
    const launcherPrefix = layout === 'P-npm' ? 'npm exec -- ' : layout?.startsWith('P-pnpm') ? 'pnpm exec ' : ''
    const prepareCandidate = async (): Promise<void> => {
      // Third deviation: the unpublished app cannot fetch its exact siblings from the registry.
      await sh(cliPrefix + ' plugin --profile dashi install')
      const profile = join(env.DSH_HOME as string, 'profiles', 'dashi')
      mkdirSync(profile, { recursive: true })
      const file = join(profile, 'pnpm-workspace.yaml')
      writeFileSync(file, (existsSync(file) ? readFileSync(file, 'utf8') : '')
        + "\noverrides:\n  '@antst/dashi-app>@antst/dashi': 'file:" + artifacts['@antst/dashi'] + "'\n"
        + "  '@antst/dashi-app>@antst/dsh-file-uploads-none': 'file:" + artifacts['@antst/dsh-file-uploads-none'] + "'\n")
    }
    if (layout === 'below-floor') {
      const lines = commands('install:G-npm', current, true)
      await sh(lines[0]!.replace('@deepseek-ai/dsh@' + version, '@deepseek-ai/dsh@0.2.0-rc.2'))
      await sh(lines[1]!)
      await prepareCandidate()
      // Only this refusal control needs a consistent pre-add lock for byte-identity assertions.
      await sh(cliPrefix + ' plugin --profile dashi install --no-frozen-lockfile')
      const profile = join(env.DSH_HOME as string, 'profiles', 'dashi')
      const before = ['package.json', 'pnpm-lock.yaml'].map(file => readFileSync(join(profile, file)))
      const manifest = JSON.parse(execFileSync('tar', ['-xOf', artifacts['@antst/dashi']!, 'package/package.json'], { encoding: 'utf8' })) as { name: string; version: string }
      const refused = await sh(lines[2]!, 1)
      expect(refused).toContain('Plugin ' + manifest.name + '@' + manifest.version
        + ' is incompatible with dsh 0.2.0-rc.2: peerDependencies')
      for (const [index, file] of ['package.json', 'pnpm-lock.yaml'].entries()) {
        expect(readFileSync(join(profile, file)), 'refused add preserves ' + file).toEqual(before[index])
      }
      result = {
        layout, candidate: manifest.name + '@' + manifest.version, node: process.version,
        pmVersion, wallSeconds: (performance.now() - started) / 1000, passed: true,
      }
      return
    }
    const nativePackage = async (command: string, packageName: string): Promise<string> => {
      const selected = realpathSync(resolve(project,
        (await sh(command + "/bin/bash --noprofile --norc -c 'command -v dashi'")).trim()))
      let directory: string
      if (layout?.startsWith('G-pnpm') && readFileSync(selected, 'utf8').startsWith('#!/bin/sh')) {
        // pnpm global packages have separate environments; use pnpm's package selection.
        const lists = JSON.parse(await run(pm, ['list', '--global', '--json', '--depth', '0'])) as Array<{
          dependencies?: Record<string, { path: string }>
        }>
        const found = lists.flatMap(list => list.dependencies?.[packageName]?.path ?? [])
        expect(found, 'package selected by ' + selected).toHaveLength(1)
        directory = realpathSync(found[0]!)
      } else {
        directory = packageAt(selected)
        if (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name !== packageName) {
          directory = dirname(realpathSync(createRequire(selected).resolve(packageName + '/package.json')))
        }
      }
      if (layout?.startsWith('P-') && command !== '') {
        expect(directory, 'project invocation selects the project launcher').toBe(
          dirname(realpathSync(createRequire(join(project, 'package.json')).resolve(packageName + '/package.json'))))
      }
      expect(JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name).toBe(packageName)
      console.log('selected dashi: ' + selected + '; package=' + directory)
      return directory
    }
    const verifyPacked = async (record: RuntimeRecord, commandPrefix: string, label: string): Promise<void> => {
      const installed = Object.fromEntries(Object.entries(record.packages).map(([name, pkg]) => [name, pkg.dir]))
      installed['@antst/dsh-file-uploads-none'] = record.fileUploadsProvider!.package.dir
      installed['@antst/dashi-launcher'] = await nativePackage(commandPrefix, '@antst/dashi-launcher')
      const hashes: Record<string, string> = {}
      for (const [name, files] of Object.entries(packedFiles)) for (const file of files) {
        const relative = file.slice('package/'.length)
        const expected = createHash('sha256').update(execFileSync('tar', ['-xOf', artifacts[name]!, file])).digest('hex')
        const actual = createHash('sha256').update(readFileSync(join(installed[name]!, relative))).digest('hex')
        expect(actual, name + '/' + relative + ' matches packed candidate').toBe(expected)
        hashes[name + '/' + relative] = actual
      }
      writeFileSync(join(workspace, 'hashes-' + label + '.json'), JSON.stringify(hashes))
    }
    const snapshot = join(workspace, 'recorded.jsonl')
    writeFileSync(snapshot, currentRecordedJsonl(join(root, 'packages/dashi/tests/fixtures/replay-session.jsonl')))
    const observer = pathToFileURL(join(root, 'packages/dashi/tests/fixtures/runtime-observer.mjs')).href
    const patch = readFileSync(join(root, 'packages/dashi/tests/fixtures/clean-replay.patch.yml'), 'utf8')
      + "\n- insert:\n    - id: runtime-observer\n      name: '" + observer + "'\n"
    const smoke = async (
      command: string, target: string, label: string, candidate = false, selectedPrefix = launcherPrefix,
    ): Promise<RuntimeRecord> => {
      const nativeHome = env.DSH_HOME as string
      const runtimePath = join(workspace, 'runtime-' + label + '.json')
      const shell = new TestPtyShell(project, {
        ...env, DSH_SNAPSHOT_FILE: snapshot, DASHI_RUNTIME_RECORD: runtimePath,
      })
      let sessionLog: string | undefined
      try {
        shell.write(command + "; printf '\\n__W124_EXIT__%s\\n' \"$?\"\n")
        await vi.waitFor(() => { expect(shell.output, shell.output.slice(-4000)).toContain('idle ·') }, { timeout: 20_000 })
        expect(shell.output).not.toContain('The following package was not found and will be installed')
        expect(shell.output).not.toContain('Need to install the following packages')
        const id = /session-[0-9a-f-]{36}/u.exec(shell.output)?.[0]
        expect(id, shell.output.slice(-4000)).toBeDefined()
        await vi.waitFor(() => { expect(existsSync(runtimePath), shell.output.slice(-4000)).toBe(true) }, { timeout: 20_000 })
        const record = JSON.parse(readFileSync(runtimePath, 'utf8')) as RuntimeRecord
        assertActiveRuntime(record, version, target, candidate ? 'candidate' : 'published')
        if (candidate) {
          const dsh = record.resolution.filter(entry => entry.name.startsWith('@deepseek-ai/dsh'))
          process.stdout.write(`resolved DSH ${label}: ${String(dsh.length)} entries; versions=${JSON.stringify([...new Set(dsh.map(entry => entry.version))])}; CLI=${record.packages['@deepseek-ai/dsh']?.version}\n`)
        }
        expect(record.packages['@deepseek-ai/dsh']?.dir.startsWith(workspace)).toBe(true)
        console.log('mounted provider ' + label + ': ' + JSON.stringify(record.fileUploadsProvider)
          + '; app pin=' + record.packages['@antst/dashi-app']?.manifest.dependencies?.['@antst/dsh-file-uploads-none'])
        if (candidate) await verifyPacked(record, selectedPrefix, label)
        shell.write('install smoke\r')
        await vi.waitFor(() => { expect(shell.output, shell.output.slice(-4000)).toContain('Approval · bash') }, { timeout: 20_000 })
        shell.write('\r')
        await vi.waitFor(() => {
          sessionLog = findLog(join(nativeHome, 'replay-sessions'), id as string)
          expect(sessionLog, shell.output.slice(-4000)).toBeDefined()
          const events = recordedSession(sessionLog as string).events
          expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
          const result = events.filter(event => event.type === 'tool/result')
          expect(result).toHaveLength(1)
          expect(result[0]?.data, 'real bash stdout').toMatchObject({
            message: { role: 'tool', isError: false, content: [{ type: 'text', text: 'DASHI_TOOL_ROUND_TRIP' }] },
          })
          expect(events.some(event => event.type === 'assistant/message'
            && JSON.stringify(event.data).includes('Recorded answer: DASHI_TOOL_ROUND_TRIP complete.'))).toBe(true)
          expect(events.some(event => event.type === 'turn/end'
            && (event.data as { reason: { kind: string } }).reason.kind === 'completed')).toBe(true)
        }, { timeout: 30_000 })
        shell.write('/exit\r')
        await shell.waitFor('__W124_EXIT__0')
        return record
      } finally {
        if (sessionLog !== undefined) writeFileSync(join(workspace, 'session-' + label + '.jsonl'), readFileSync(sessionLog))
        writeFileSync(join(workspace, 'pty-' + label + '.log'), shell.output)
        await shell.close()
      }
    }
    const prepareProfile = async (): Promise<void> => {
      // Native replay composition only, not dependency hooks, companion pins or install repair.
      await sh(cliPrefix + ' plugin --profile dashi add @deepseek-ai/dsh-llm-replay@' + version)
      const patchPath = join(env.DSH_HOME as string, 'profiles', 'dashi', 'cordis.patch.yml')
      const original = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
      writeFileSync(patchPath, original.replace(/^\[\]\s*$/mu, '') + '\n' + patch)
    }
    const execute = async (lines: string[], candidate = false): Promise<string> => {
      const launch = lines.at(-1)!
      for (const command of lines.slice(0, -1)) {
        if (candidate && command.includes(' plugin --profile dashi add ')) await prepareCandidate()
        const result = await sh(command)
        if (command.endsWith('dashi --version')) expect(result.trim()).toBe(version)
      }
      return launch
    }
    for (const baseline of ['fresh', '0.2.0-alpha.1', '0.2.0-alpha.2']) {
      // Only published-to-candidate upgrades reuse a project; baselines start empty.
      project = join(workspace, 'project-' + baseline)
      mkdirSync(project)
      writeFileSync(join(project, 'package.json'), '{"private":true}\n')
      env.DSH_HOME = join(workspace, 'native-' + baseline)
      const target = baseline === 'fresh' ? current : baseline
      if (layout?.startsWith('G-pnpm')) {
        for (const command of commands(installMarker + '-packages', target, baseline === 'fresh')) await sh(command)
        if (baseline === 'fresh' && layout === 'G-pnpm11') {
          const broken = await sh('dsh --profile headless --help', false)
          expect(broken).toContain(nativeBindingError)
          for (const command of commands(installMarker + '-remedy', target)) await sh(command)
          expect((await run(pm, ['config', 'get', 'enableGlobalVirtualStore'])).trim()).toBe('false')
          await sh('dsh --profile headless --help')
        }
        if (baseline === 'fresh' && layout === 'G-pnpm12') await sh('dsh --profile headless --help')
      }
      if (baseline === 'fresh' && layout?.startsWith('P-')) {
        // Selection does not depend on the global manager; global pnpm has its own rows.
        for (const command of commands('install:G-npm', current, true).slice(0, 2)) await sh(command)
      }
      const lines = commands(installMarker, target, baseline === 'fresh')
      if (layout?.startsWith('P-pnpm') && layout !== 'P-pnpm10') {
        const broken = await sh(lines[0]!, 1)
        expect(broken).toContain('ERR_PNPM_IGNORED_BUILDS')
        const ignored = /Ignored build scripts:([\s\S]*?)(?=\n\s*(?:help:|Run )|$)/u.exec(broken)?.[1]
        expect(ignored, 'pnpm lists the unreviewed builds').toBeDefined()
        const names = [...ignored!.matchAll(/(?:^|[\s,])((?:@[\w.-]+\/)?[\w.-]+)@[\w.+-]+/gu)]
          .map(match => match[1]!).sort()
        const decline = commands(installMarker + '-decline-builds', target)[0]!
        const declined = [...decline.matchAll(/'!([^']+)'/gu)].map(match => match[1]!).sort()
        expect(names, 'README build decisions match pnpm output; update the single fence if it changes').toEqual(declined)
        expect(names.length).toBeGreaterThan(0)
        await sh(decline)
        const policy = JSON.parse(await run(pm, ['config', 'get', 'allowBuilds', '--json'])) as Record<string, boolean>
        expect(policy, 'none of the dependency builds is approved').toEqual(Object.fromEntries(names.map(name => [name, false])))
        writeFileSync(join(workspace, 'build-control-' + baseline + '.json'), JSON.stringify({ install: lines[0], exit: 1,
          error: 'ERR_PNPM_IGNORED_BUILDS', names, decline, policy }))
      }
      const launch = await execute(lines, baseline === 'fresh')
      expect((await sh(cliPrefix + ' --version')).trim()).toBe(version)
      if (layout === 'G-npm' && baseline === 'fresh') {
        const missing = await sh('dsh plugin --profile missing-pnpm add @antst/dashi-app@' + current, 127,
          { PATH: [join(globalPrefix, 'bin'), dirname(process.execPath)].join(delimiter) })
        expect(missing).toContain('dsh: pnpm was not found; install pnpm and make it available on PATH.')
      }
      await prepareProfile()
      const record = await smoke(launch, target, baseline + '-installed', baseline === 'fresh',
        layout === 'G-npx' ? launch.replace(/dashi$/u, '') : launcherPrefix)
      if (baseline === 'fresh' && layout?.startsWith('P-')) {
        const inspection = commands(installMarker + '-inspect-global', current)
        expect((await sh(inspection[0]!)).trim()).toBe(join(globalPrefix, 'bin', 'dsh'))
        expect((await sh(inspection[1]!)).trim()).toBe(version)
        for (const command of commands(installMarker + '-inspect-project', current)) expect((await sh(command)).trim()).toBe(version)
        const global = await smoke('dashi', current, 'mixed-global', true, '')
        expect(record.packages['@deepseek-ai/dsh']?.dir).not.toBe(global.packages['@deepseek-ai/dsh']?.dir)
        expect(record.packages['@deepseek-ai/dsh']?.dir.startsWith(project)).toBe(true)
      }
      if (layout === 'G-npx' && baseline === 'fresh') {
        for (const command of commands(installMarker + '-direct-warm', current)) expect((await sh(command)).trim()).toBe(version)
        await smoke(commands(installMarker + '-direct', current)[0]!, current, 'npx-direct', true,
          launch.replace(/dashi$/u, ''))
      }
      if (baseline !== 'fresh') {
        const upgraded = await execute(commands(upgradeMarker, current, true), true)
        await smoke(upgraded, current, baseline + '-candidate', true,
          layout === 'G-npx' ? upgraded.replace(/dashi$/u, '') : launcherPrefix)
      }
    }
    expect([...markerOwners].filter(([marker, owner]) => owner === layout && !consumedMarkers.has(marker))
      .map(([marker]) => marker), 'every Install marker assigned to this row is consumed').toEqual([])
    const wallSeconds = (performance.now() - started) / 1000
    result = { layout, platform: process.platform + '-' + process.arch, node: process.version, pmVersion, wallSeconds, passed: true }
  } finally {
    await daemon.close()
    writeFileSync(join(workspace, 'commands.log'), output)
  }
})
