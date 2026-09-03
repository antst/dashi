import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const checks = [
  ['typecheck', ['run', 'typecheck']],
  ['build', ['run', 'build']],
  ['lint', ['run', 'lint']],
  ['tests', ['run', 'test']],
]

for (const [label, args] of checks) {
  const result = spawnSync('pnpm', args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
  console.log(`gate: ${label} passed`)
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
const validatedVersions = JSON.parse(await readFile(
  fileURLToPath(new URL('../packages/dashi/validated-dsh-versions.json', import.meta.url)), 'utf8',
))
if (validatedVersions.length !== 1) failures.push('validated-dsh-versions.json: expected one version')
const validatedVersion = validatedVersions[0]
const workspace = await readFile(fileURLToPath(new URL('../pnpm-workspace.yaml', import.meta.url)), 'utf8')
const catalog = workspace.split('\ncatalog:\n', 2)[1] ?? ''
for (const [, packageName, version] of catalog.matchAll(/^  '(@deepseek-ai\/dsh(?:-[^']+)?)': (\S+)$/gm)) {
  if (version !== validatedVersion) failures.push(`pnpm-workspace.yaml: ${packageName} must be ${validatedVersion}`)
}
const lockfile = await readFile(fileURLToPath(new URL('../pnpm-lock.yaml', import.meta.url)), 'utf8')
const packageSection = lockfile.split('\nsnapshots:\n', 1)[0]
const lockedDsh = [...packageSection.matchAll(/^  '?(@deepseek-ai\/dsh[^@']*)@([^':]+)'?:$/gm)]
if (lockedDsh.length === 0) failures.push('pnpm-lock.yaml: no @deepseek-ai/dsh packages found')
for (const [, packageName, version] of lockedDsh) {
  if (!validatedVersions.includes(version)) failures.push(`pnpm-lock.yaml: unvalidated ${packageName}@${version}`)
}
const packageFiles = (await filesBelow(fileURLToPath(new URL('../packages', import.meta.url))))
  .filter(path => path.endsWith('package.json'))
const pinnedManifests = new Set(['packages/dashi/package.json', 'packages/dashi-app/package.json'])
for (const path of packageFiles) {
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [dependency, version] of Object.entries(manifest[field] ?? {})) {
      const reason = packageViolation(dependency)
      if (reason !== undefined) failures.push(`${relative(root, path)}: ${reason}: ${dependency}`)
      if (pinnedManifests.has(relative(root, path)) && dependency.startsWith('@deepseek-ai/')) {
        if (!/^\d+\.\d+\.\d+(?:-[\dA-Za-z.-]+)?(?:\+[\dA-Za-z.-]+)?$/.test(version)) {
          failures.push(`${relative(root, path)}: ${dependency} must be pinned exactly`)
        }
        if (/^@deepseek-ai\/dsh(?:-|$)/.test(dependency) && version !== validatedVersion) {
          failures.push(`${relative(root, path)}: ${dependency} must match validated ${validatedVersion}`)
        }
      }
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
console.log(`gate: DSH versions passed (${lockedDsh.length} packages at ${validatedVersions.join(', ')})`)
console.log(`gate: import lint passed (${sourceFiles.length} source files)`)
console.log('gate: PASS — typecheck, build, lint, tests, DSH versions, import lint')
