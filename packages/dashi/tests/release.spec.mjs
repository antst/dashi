import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkReleaseVersion, releasePackages } from '../../../scripts/check-release-version.mjs'
import { readReleaseArchives } from '../../../scripts/pack-release.mjs'
import { checkReleasePayloads, tagChecksums } from '../../../scripts/check-release-payloads.mjs'
import { lockIntegrity, preflightRegistry, publishRelease, registryHasEqualArchive } from '../../../scripts/publish-release-payloads.mjs'

const uploads = vi.hoisted(() => ({ calls: [], failAt: undefined, annotation: '', pack: undefined }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, spawnSync(command, args, options) {
    // Native tar exercises archive reads. No test can send an actual publication.
    if (command === 'tar') return actual.spawnSync(command, args, options)
    if (command === 'git') return { status: 0, stdout: 'object fixture\ntype commit\n\n' + uploads.annotation }
    if (command === 'sha256sum') return actual.spawnSync(process.platform === 'darwin' ? 'shasum' : command,
      process.platform === 'darwin' ? ['-a', '256', '-c'] : args, options)
    if (command === 'pnpm' && uploads.pack) {
      uploads.pack.calls.push(args)
      if (args[0] === '--version') return { status: 0, stdout: '11.28.5' }
      if (args[0] === 'build') return uploads.pack.build()
      if (args[0] === '--dir' && args[2] === 'pack') return { status: 0, stdout: 'fixture pack' }
    }
    if (command !== 'pnpm' || args[0] !== 'publish') throw new Error('Unexpected release-test command: ' + command)
    uploads.calls.push({ command, args, options })
    return { status: uploads.calls.length === uploads.failAt ? 1 : 0 }
  } }
})

let root, payloads, lock, events, registry
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dashi-release-'))
  uploads.calls.length = 0; uploads.failAt = undefined; uploads.annotation = ''; uploads.pack = undefined
  events = []; registry = new Map()
})
afterEach(() => { vi.unstubAllGlobals(); rmSync(root, { recursive: true, force: true }) })

function fixture() {
  const units = releasePackages()
  const archives = join(root, 'archives')
  mkdirSync(archives)
  for (const unit of units) {
    const directory = join(root, 'packages', unit.directory.split('/').at(-1))
    const packageDirectory = join(root, 'container', unit.manifest.name.replaceAll('/', '-'), 'package')
    mkdirSync(directory, { recursive: true }); mkdirSync(packageDirectory, { recursive: true })
    const manifest = { name: unit.manifest.name, version: '0.2.0', main: 'index.js' }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (!unit.manifest[field]) continue
      manifest[field] = Object.fromEntries(Object.entries(unit.manifest[field]).map(([name, range]) => [name,
        name === '@sessionbus/dsh' ? '0.1.1' : name === '@earendil-works/pi-tui' ? '0.84.4'
          : range.startsWith('workspace:') ? '0.2.0' : range]))
    }
    writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(packageDirectory, 'package.json'), JSON.stringify(manifest))
    writeFileSync(join(packageDirectory, 'index.js'), 'export {}\n')
    const filename = manifest.name.replace(/^@/u, '').replace('/', '-') + '-0.2.0.tgz'
    const result = spawnSync('tar', ['-czf', join(archives, filename), '-C', join(packageDirectory, '..'), 'package'])
    expect(result.status).toBe(0)
  }
  payloads = readReleaseArchives(archives, root)
  lock = '\npackages:\n'
  for (const [name, version] of [['@sessionbus/dsh', '0.1.1'], ['@antst/roller', '0.1.4'], ['@earendil-works/pi-tui', '0.84.4']]) {
    const integrity = 'sha512-' + createHash('sha512').update(name + version).digest('base64')
    lock += `  '${name}@${version}':\n    resolution: {integrity: ${integrity}}\n\n`
    registry.set(name, { name, versions: { [version]: { name, version, dist: { integrity } } } })
  }
  for (const payload of payloads) registry.set(payload.manifest.name, { name: payload.manifest.name, versions: {} })
  vi.stubGlobal('fetch', vi.fn(async url => {
    const name = decodeURIComponent(new URL(url).pathname.slice(1))
    events.push(name)
    return { ok: true, status: 200, json: async () => registry.get(name) }
  }))
  return archives
}

it('accepts plain tags and exactly four matching versions, and rejects every suffix or mismatch', () => {
  for (const version of ['0.2.0', '0.0.0', '12.34.56']) expect(checkReleaseVersion('v' + version, Array(4).fill(version))).toBe(version)
  for (const tag of [undefined, '', '0.2.0', 'v00.2.0', 'v0.2.0-alpha.3', 'v0.2.0+build', 'v0.2.0\n', ' v0.2.0']) {
    expect(() => checkReleaseVersion(tag, Array(4).fill('0.2.0'))).toThrow()
  }
  for (const versions of [[], Array(3).fill('0.2.0'), ['0.2.0', '0.2.0', '0.2.1', '0.2.0']]) {
    expect(() => checkReleaseVersion('v0.2.0', versions)).toThrow()
  }
})

it('rejects matching prerelease and build-metadata tags even when all four manifests agree', () => {
  fixture()
  for (const version of ['0.2.0-alpha.3', '0.2.0+build']) {
    for (const unit of releasePackages(root)) {
      writeFileSync(join(unit.directory, 'package.json'), JSON.stringify({ ...unit.manifest, version }))
    }
    expect(() => checkReleaseVersion('v' + version, releasePackages(root).map(unit => unit.manifest.version)))
      .toThrow('no prerelease or build suffix')
  }
})

it.each([
  ['check-release-version.mjs', ['v0.2.0-alpha.3'], 'no prerelease or build suffix'],
  ['pack-release.mjs', [], 'Usage:'],
  ['check-release-payloads.mjs', ['v0.2.0-alpha.3', 'unused-directory'], 'no prerelease or build suffix'],
  ['publish-release-payloads.mjs', ['missing-archives'], 'ENOENT'],
])('runs linked %s and still refuses failing inputs', async (script, args, error) => {
  const actual = await vi.importActual('node:child_process')
  const linked = join(root, script)
  symlinkSync(fileURLToPath(new URL('../../../scripts/' + script, import.meta.url)), linked)
  const result = actual.spawnSync(process.execPath, [linked, ...args], { cwd: root, encoding: 'utf8', timeout: 10_000 })
  expect(result.error).toBeUndefined()
  expect(result.status).not.toBe(0)
  expect(result.stderr).toContain(error)
})

it('creates a missing GitHub release using only the step\'s entitled tools, never after another query error', async () => {
  const actual = await vi.importActual('node:child_process')
  const workflow = readFileSync(new URL('../../../.github/workflows/release.yml', import.meta.url), 'utf8')
  const step = workflow.split('      - name: Create GitHub release\n')[1]
  const script = step.match(/^        run: \|\n((?:          [^\n]*\n| *\n)*)/mu)[1].replace(/^          /gmu, '')
  const tools = join(root, 'bin')
  mkdirSync(tools)
  // Bash builtins need no PATH entry. Only bash, grep, awk, cat and fake gh are available.
  for (const tool of ['bash', 'grep', 'awk', 'cat']) {
    const located = actual.spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', 'command -v "$1"', 'locate', tool], { encoding: 'utf8' })
    expect(located.status).toBe(0)
    symlinkSync(located.stdout.trim(), join(tools, tool))
  }
  writeFileSync(join(tools, 'gh'), `#!/bin/bash
printf '%s\\n' "$@" >> "$GH_CALLS"
if [[ "$1" == api ]]; then
  if [[ "$GH_CASE" == exists ]]; then printf '{}\\n'; exit 0; fi
  if [[ "$GH_CASE" == missing ]]; then printf 'gh: Not Found (HTTP 404)\\n' >&2; exit 1; fi
  printf 'gh: Forbidden (HTTP 403)\\n' >&2; exit 1
fi
`, { mode: 0o755 })
  writeFileSync(join(root, 'CHANGELOG.md'), '## 0.2.0\n\nRelease control notes.\n\n## 0.1.0\nOld notes.\n')
  const query = ['api', 'repos/fixture/dashi/releases/tags/v0.2.0']
  const create = ['release', 'create', 'v0.2.0', '--repo', 'fixture/dashi', '--verify-tag', '--title', 'v0.2.0',
    '--notes-file', join(root, 'release-notes.md')]
  for (const mode of ['exists', 'missing', 'forbidden']) {
    const calls = join(root, 'gh-calls-' + mode)
    const result = actual.spawnSync(join(tools, 'bash'), ['--noprofile', '--norc', '-e', '-o', 'pipefail', '-c', script], {
      cwd: root, encoding: 'utf8', timeout: 10_000,
      env: { PATH: tools, RUNNER_TEMP: root, GITHUB_REPOSITORY: 'fixture/dashi', GITHUB_REF_NAME: 'v0.2.0',
        RELEASE_VERSION: '0.2.0', GH_CASE: mode, GH_CALLS: calls },
    })
    expect(result.error).toBeUndefined()
    expect(result.status, mode).toBe(mode === 'forbidden' ? 1 : 0)
    expect(readFileSync(calls, 'utf8').trim().split('\n')).toEqual(mode === 'missing' ? [...query, ...create] : query)
    if (mode === 'missing') expect(readFileSync(join(root, 'release-notes.md'), 'utf8').trim()).toBe('Release control notes.')
  }
})

async function packFixture(build) {
  const directory = fixture()
  mkdirSync(join(root, 'scripts'))
  for (const script of ['pack-release.mjs', 'check-release-version.mjs']) {
    copyFileSync(new URL('../../../scripts/' + script, import.meta.url), join(root, 'scripts', script))
  }
  writeFileSync(join(root, 'package.json'), JSON.stringify({ packageManager: 'pnpm@11.28.5' }))
  for (const name of ['file-uploads-none', 'dashi']) {
    mkdirSync(join(root, 'packages', name, 'lib'))
    writeFileSync(join(root, 'packages', name, 'lib', 'obsolete.js'), 'obsolete output')
    writeFileSync(join(root, 'packages', name, 'lib', 'index.js'), 'corrupt output')
  }
  const { packRelease } = await import(pathToFileURL(join(root, 'scripts', 'pack-release.mjs')).href)
  uploads.pack = { calls: [], build }
  const nativeProcess = process
  // Toolchain admission is not under test here; native packing is measured separately.
  vi.stubGlobal('process', { ...nativeProcess, platform: 'linux', arch: 'x64', versions: { ...nativeProcess.versions, node: '22.23.3' } })
  try { return packRelease(directory) } finally { vi.stubGlobal('process', nativeProcess) }
}

it('cleans exactly the two generated outputs and builds before any pack', async () => {
  const sourceMarker = join(root, 'keep-source.txt')
  writeFileSync(sourceMarker, 'keep')
  const packed = await packFixture(() => {
    for (const name of ['file-uploads-none', 'dashi']) {
      expect(existsSync(join(root, 'packages', name, 'lib'))).toBe(false)
    }
    return { status: 0, stdout: 'fixture build' }
  })
  expect(packed).toHaveLength(4)
  expect(readFileSync(sourceMarker, 'utf8')).toBe('keep')
  expect(uploads.pack.calls.slice(0, 2)).toEqual([['--version'], ['build']])
  expect(uploads.pack.calls.slice(2).map(args => args[2])).toEqual(Array(4).fill('pack'))
})

it('stops before any pack when the workspace build fails', async () => {
  await expect(packFixture(() => ({ status: 17, stderr: 'build failure control' }))).rejects.toThrow('build failure control')
  expect(uploads.pack.calls).toEqual([['--version'], ['build']])
})

it('reads all four real archive manifests in publication order and hashes their exact bytes', () => {
  fixture()
  expect(payloads.map(payload => payload.manifest.name)).toEqual([
    '@antst/dsh-file-uploads-none', '@antst/dashi', '@antst/dashi-app', '@antst/dashi-launcher',
  ])
  for (const payload of payloads) {
    expect(payload.sha256).toBe(createHash('sha256').update(readFileSync(payload.archive)).digest('hex'))
    expect(payload.integrity).toBe('sha512-' + createHash('sha512').update(readFileSync(payload.archive)).digest('base64'))
  }
})

it('rejects a changed packed identity, inexact sibling or missing entry', () => {
  const archives = fixture()
  const payload = payloads[2]
  const directory = join(root, 'container', payload.manifest.name.replaceAll('/', '-'))
  for (const change of [{ version: '0.2.1' }, { dependencies: { '@antst/dashi': '^0.2.0' } },
    { main: 'absent.js' }, { types: 'absent.d.ts' }, { bin: { dashi: 'absent.js' } }, { dsh: { bundle: { patch: 'absent.yml' } } }]) {
    writeFileSync(join(directory, 'package', 'package.json'), JSON.stringify({ ...payload.manifest, ...change }))
    expect(spawnSync('tar', ['-czf', payload.archive, '-C', directory, 'package']).status).toBe(0)
    expect(() => readReleaseArchives(archives, root)).toThrow()
  }
})

it('rejects changed dependency key order even when every dependency value is unchanged', () => {
  const archives = fixture()
  const payload = payloads[2]
  const directory = join(root, 'container', payload.manifest.name.replaceAll('/', '-'))
  const reordered = { ...payload.manifest,
    dependencies: Object.fromEntries(Object.entries(payload.manifest.dependencies).reverse()) }
  writeFileSync(join(directory, 'package', 'package.json'), JSON.stringify(reordered))
  expect(spawnSync('tar', ['-czf', payload.archive, '-C', directory, 'package']).status).toBe(0)
  expect(() => readReleaseArchives(archives, root)).toThrow('dependencies key order differs from source')
})

it('requires four canonical, unique, expected filenames in the annotation', () => {
  fixture()
  const lines = payloads.map(payload => payload.sha256 + '  ' + payload.filename)
  const filenames = payloads.map(payload => payload.filename)
  expect(tagChecksums('Proven release\n\n' + lines.slice().reverse().join('\n'), filenames)).toBe(lines.join('\n') + '\n')
  for (const bad of ['', lines.slice(1).join('\n'), [...lines, lines[0]].join('\n'),
    [lines[0], lines[0], ...lines.slice(2)].join('\n'), lines.join('\n').replace(filenames[0], '../outside.tgz'),
    lines.join('\n').replace(payloads[0].sha256, payloads[0].sha256.toUpperCase()), lines.join('\n').replace('  ', ' '),
    lines.join('\n') + '\n' + 'a'.repeat(65)]) {
    expect(() => tagChecksums(bad, filenames)).toThrow()
  }
})

it('reads lock integrity only from the exact package record, not a snapshot or adjacent version', () => {
  fixture()
  expect(lockIntegrity(lock, '@antst/roller', '0.1.4')).toBe(registry.get('@antst/roller').versions['0.1.4'].dist.integrity)
  expect(() => lockIntegrity(lock, '@antst/roller', '0.1.3')).toThrow()
  expect(() => lockIntegrity('\nsnapshots:\n' + lock, '@antst/roller', '0.1.4')).toThrow()
})

it('stops a validly named but mismatched tag hash before any registry read or upload', async () => {
  const directory = fixture()
  uploads.annotation = payloads.map(payload => payload.sha256 + '  ' + payload.filename).join('\n')
    .replace(payloads[0].sha256, '0'.repeat(64))
  await expect(checkReleasePayloads('v0.2.0', directory)).rejects.toThrow('hash mismatch')
  expect(events).toEqual([])
  expect(uploads.calls).toEqual([])
})

it('checks every own version and exact external dependency before uploading anything', async () => {
  fixture()
  expect(await preflightRegistry(payloads, lock)).toEqual([false, false, false, false])
  expect(events).toEqual([...payloads.map(payload => payload.manifest.name), '@earendil-works/pi-tui', '@sessionbus/dsh', '@antst/roller'])
  expect(uploads.calls).toEqual([])
  registry.get('@antst/roller').versions = {}
  await expect(publishRelease(payloads, lock)).rejects.toThrow('exact dependency is not published')
  expect(uploads.calls).toEqual([])
})

it('rejects a missing frozen-lock integrity or unequal exact dependency before any upload', async () => {
  fixture()
  await expect(publishRelease(payloads, '')).rejects.toThrow('no SHA512 integrity')
  expect(events).toEqual([])
  registry.get('@sessionbus/dsh').versions['0.1.1'].dist.integrity = 'unequal control'
  await expect(publishRelease(payloads, lock)).rejects.toThrow('integrity differs')
  expect(uploads.calls).toEqual([])
})

it('never reads HTTP, authentication, network or malformed metadata errors as absence', async () => {
  for (const status of [401, 403, 404, 429, 500]) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status })))
    await expect(registryHasEqualArchive('@antst/dashi', '0.2.0', 'expected')).rejects.toThrow('not version absence')
  }
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network control') }))
  await expect(registryHasEqualArchive('@antst/dashi', '0.2.0', 'expected')).rejects.toThrow('network control')
  for (const data of [undefined, {}, { name: '@antst/dashi', versions: [] }]) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => data })))
    await expect(registryHasEqualArchive('@antst/dashi', '0.2.0', 'expected')).rejects.toThrow()
  }
})

it('rejects an existing unequal payload before the first upload', async () => {
  fixture()
  const payload = payloads[3]
  registry.get(payload.manifest.name).versions['0.2.0'] = { name: payload.manifest.name, version: '0.2.0', dist: { integrity: 'different' } }
  await expect(publishRelease(payloads, lock)).rejects.toThrow('integrity differs')
  expect(uploads.calls).toEqual([])
})

it('skips only equal published bytes, continues in dependency order, and stops on an uncertain upload', async () => {
  const parentRetrySetting = process.env.pnpm_config_fetch_retries
  fixture()
  const first = payloads[0]
  registry.get(first.manifest.name).versions['0.2.0'] = { name: first.manifest.name, version: '0.2.0', dist: { integrity: first.integrity } }
  uploads.failAt = 2
  await expect(publishRelease(payloads, lock)).rejects.toThrow('registry outcome may be uncertain')
  expect(uploads.calls.map(call => call.args[1])).toEqual(payloads.slice(1, 3).map(payload => payload.archive))
  expect(uploads.calls[0].args).toEqual(['publish', payloads[1].archive, '--access', 'public', '--provenance', '--no-git-checks', '--tag', 'latest'])
  for (const call of uploads.calls) expect(call.options.env?.pnpm_config_fetch_retries).toBe('0')
  expect(process.env.pnpm_config_fetch_retries).toBe(parentRetrySetting)
  uploads.calls.length = 0; uploads.failAt = undefined
  for (const payload of payloads) registry.get(payload.manifest.name).versions['0.2.0'] = {
    name: payload.manifest.name, version: '0.2.0', dist: { integrity: payload.integrity },
  }
  await publishRelease(payloads, lock)
  expect(uploads.calls).toEqual([])
})
