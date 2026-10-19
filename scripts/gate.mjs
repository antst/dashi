import { readFile, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { extname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { assertPinnedGraph, deriveCliPins, resolvedPiAiVersion } from './dsh-cli-pins.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const dshPolicy = JSON.parse(await readFile(
  fileURLToPath(new URL('../packages/dashi/validated-dsh-versions.json', import.meta.url)), 'utf8',
))
const testedVersions = Array.isArray(dshPolicy.tested) ? dshPolicy.tested : []
const testedVersion = process.argv[2] ?? process.env.DSH_TEST_VERSION ?? testedVersions[0]
if (typeof dshPolicy.minimum !== 'string' || !testedVersions.includes(testedVersion)) {
  console.error(`gate: DSH ${String(testedVersion)} is not in the tested matrix`)
  process.exit(1)
}
if (process.env.SESSIONBUS_DAEMON_BIN === undefined) {
  const provision = spawnSync(process.execPath, [join(root, 'scripts/provision-sessionbus.mjs')], {
    cwd: root, stdio: 'inherit',
  })
  if (provision.status !== 0) process.exit(provision.status ?? 1)
  process.env.SESSIONBUS_DAEMON_BIN = join(root, '.cache/sessionbus/bin/sessionbus')
}
const sourceExtensions = new Set(['.js', '.mjs', '.ts', '.tsx'])
const forbiddenPackages = [
  /^@deepseek-ai\/dsh-session-persistence(?:-|$)/,
  /^@deepseek-ai\/dsh-storage(?:-|$)/,
  /^@deepseek-ai\/dsh-client-ui(?:-|$)/,
]
const piPackage = '@earendil-works/pi-tui'
const allowedPiSymbols = new Set([
  'Editor', 'EditorComponent', 'EditorOptions', 'EditorTheme',
  'Key', 'KeyEventType', 'KeyId', 'decodeKittyPrintable', 'isKeyRelease',
  'isKeyRepeat', 'isKittyProtocolActive', 'matchesKey', 'parseKey',
  'setKittyProtocolActive', 'Markdown', 'MarkdownOptions', 'MarkdownTheme',
  'TUI', 'TuiAltScreen', 'TuiAltScreenOptions', 'TuiInputListener',
  'TuiInputListenerResult', 'TuiMainScreen', 'TuiMainScreenRenderState',
  'TuiMode', 'TuiStopOptions', 'ProcessTerminal', 'Terminal',
  'sliceByColumn', 'stripTerminalSequences',
  'truncateToWidth', 'visibleWidth', 'wrapTextWithAnsi',
])
const piFiles = new Set([
  'packages/dashi/lib/input.d.ts', 'packages/dashi/lib/input.js', 'packages/dashi/src/input.ts',
  'packages/dashi/lib/mouse-input.d.ts', 'packages/dashi/lib/mouse-input.js',
  'packages/dashi/src/mouse-input.ts',
  'packages/dashi/lib/renderer.d.ts', 'packages/dashi/lib/renderer.js', 'packages/dashi/src/renderer.ts',
  'packages/dashi/lib/terminal-guard.d.ts', 'packages/dashi/lib/terminal-guard.js',
  'packages/dashi/src/terminal-guard.ts',
])
const imageInputFile = 'packages/dashi/src/image-input.ts'

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? filesBelow(path) : [path]
  }))
  return nested.flat()
}

function packageViolation(specifier) {
  if (specifier.includes('node_modules') || /^(?:@[^/]+\/[^/]+|[^./][^/]*)\/src(?:\/|$)/.test(specifier)) {
    return 'path import into package source'
  }
  if (forbiddenPackages.some(pattern => pattern.test(specifier))) return 'forbidden DSH package'
}

const failures = []
const workspace = await readFile(fileURLToPath(new URL('../pnpm-workspace.yaml', import.meta.url)), 'utf8')
const catalog = workspace.split('\ncatalog:\n', 2)[1] ?? ''
for (const [, packageName, version] of catalog.matchAll(/^  '(@deepseek-ai\/dsh(?:-[^']+)?)': (\S+)$/gm)) {
  if (version !== testedVersion) failures.push(`pnpm-workspace.yaml: ${packageName} must be ${testedVersion}`)
}
const lockfile = await readFile(fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url)), 'utf8')
const packageSection = lockfile.split('\nsnapshots:\n', 1)[0]
const lockedDsh = [...packageSection.matchAll(/^  '?(@deepseek-ai\/dsh[^@']*)@([^':]+)'?:$/gm)]
if (lockedDsh.length === 0) failures.push('pnpm-lock.yaml: no @deepseek-ai/dsh packages found')
for (const [, packageName, version] of lockedDsh) {
  if (version !== testedVersion) failures.push(`pnpm-lock.yaml: ${packageName} must be ${testedVersion}`)
}
// Repository reproducibility only. User layouts are checked by the install matrix's native runtime oracle.
const cliManifestPath = createRequire(import.meta.url).resolve('@deepseek-ai/dsh/package.json')
const cliManifest = JSON.parse(await readFile(cliManifestPath, 'utf8'))
if (cliManifest.version !== testedVersion) failures.push(`installed DSH CLI must be ${testedVersion}`)
const cliPins = deriveCliPins(cliManifest.dependencies)
try { assertPinnedGraph(lockfile, cliPins) } catch (error) { failures.push(`pnpm-lock.yaml: ${String(error)}`) }
console.log(`gate: CLI companion pins ${JSON.stringify(cliPins)}`)
try {
  console.log(`gate: resolved pi-ai ${resolvedPiAiVersion(cliManifestPath)} (CLI ${cliManifest.version})`)
} catch (error) { failures.push(`resolved pi-ai: ${String(error)}`) }
if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
const rendererPath = 'packages/dashi/tests/renderer.spec.ts'
const testExcludes = ['**/.cache/**', '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.omc/**', 'packages/*/lib/**']
  .flatMap(path => ['--exclude', path])
const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
const trackedFiles = tracked.status === 0 ? new Set(tracked.stdout.split('\0')) : undefined
if (trackedFiles === undefined) console.log('gate: tracked-test check unavailable (Git-less workspace); native selection will run')
const checks = [
  ['typecheck', ['run', 'typecheck']],
  ['build', ['run', 'build']],
  ['lint', ['run', 'lint']],
  ['renderer tests', ['exec', 'vitest', 'run', rendererPath, ...testExcludes]],
  ['tests', ['exec', 'vitest', 'run', '--exclude', rendererPath, ...testExcludes]],
]
for (const [label, args] of checks) {
  if (args[1] === 'vitest') {
    const listed = spawnSync('pnpm', ['--silent', ...args.slice(0, 2), 'list', '--filesOnly', ...args.slice(3)], {
      cwd: root, env: { ...process.env, DSH_TEST_VERSION: testedVersion }, encoding: 'utf8',
    })
    if (listed.status !== 0) { console.error(listed.stderr || listed.stdout || String(listed.error)); process.exit(1) }
    const files = listed.stdout.trim().split('\n').filter(Boolean)
    const untracked = trackedFiles === undefined ? [] : files.filter(path => !trackedFiles.has(path))
    if (untracked.length > 0) { console.error(`gate: untracked test files:\n${untracked.join('\n')}`); process.exit(1) }
    console.log(`gate: ${label}: ${files.length} files${trackedFiles === undefined ? '' : ' (tracked)'}`)
  }
  const result = spawnSync('pnpm', args, {
    cwd: root, env: { ...process.env, DSH_TEST_VERSION: testedVersion }, stdio: 'inherit',
  })
  if (result.status !== 0) {
    if (label === 'renderer tests') console.error('gate: renderer tests failed — remaining suite NOT RUN')
    process.exit(result.status ?? 1)
  }
  console.log(`gate: ${label} passed`)
}
const packageFiles = (await filesBelow(fileURLToPath(new URL('../packages', import.meta.url))))
  .filter(path => path.endsWith('package.json'))
for (const path of packageFiles) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  if (relative(root, path) === 'packages/dashi-app/package.json'
    && manifest.dependencies?.['@antst/roller'] !== '0.1.4') {
    failures.push('packages/dashi-app/package.json: @antst/roller must be pinned to 0.1.4')
  }
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(manifest[field] ?? {})) {
      const reason = packageViolation(dependency)
      if (reason !== undefined) failures.push(`${relative(root, path)}: ${reason}: ${dependency}`)
    }
  }
}

const sourceFiles = (await Promise.all([
  filesBelow(fileURLToPath(new URL('../packages', import.meta.url))),
  filesBelow(fileURLToPath(new URL('../scripts', import.meta.url))),
])).flat().filter(path => sourceExtensions.has(extname(path)))
for (const path of sourceFiles) {
  const source = await readFile(path, 'utf8')
  const specifiers = [...source.matchAll(/(?:from\s*|(?:import|require)\s*\(\s*|import\s*)['"]([^'"]+)['"]/g)]
    .map(match => match[1])
  for (const specifier of specifiers) {
    const reason = packageViolation(specifier)
    if (reason !== undefined) failures.push(`${relative(root, path)}: ${reason}: ${specifier}`)
  }
  if (specifiers.includes('node:fs/promises')
    && specifiers.includes('@deepseek-ai/dsh-attachment')
    && relative(root, path) !== imageInputFile) {
    failures.push(`${relative(root, path)}: image path reads belong only in ${imageInputFile}`)
  }
  if (!specifiers.includes(piPackage)) continue
  const fileName = path.split('/').at(-1) ?? ''
  if (!piFiles.has(relative(root, path))) {
    failures.push(`${relative(root, path)}: pi-tui import is confined to input, renderer, and terminal-guard`)
  }
  if (/^(?:state|reducer|transcript|fold)(?:[.-]|$)/.test(fileName)) {
    failures.push(`${relative(root, path)}: pi-tui is forbidden in state and folds`)
  }
  const imports = [...source.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+['"]@earendil-works\/pi-tui['"]/gs)]
  if (imports.length === 0) failures.push(`${relative(root, path)}: pi-tui must use named imports`)
  for (const match of imports) {
    const symbols = match[1].split(',').map(value => value.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0])
    for (const symbol of symbols) {
      if (symbol !== '' && !allowedPiSymbols.has(symbol)) {
        failures.push(`${relative(root, path)}: pi-tui symbol outside renderer/input/editor/markdown/width boundary: ${symbol}`)
      }
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`gate: repository DSH lock passed (${lockedDsh.length} packages at ${testedVersion}; not a user-layout rule)`)
console.log(`gate: import lint passed (${sourceFiles.length} source files)`)
console.log('gate: PASS — typecheck, build, lint, tests, DSH versions, import lint')
