import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { checkReleaseVersion, releasePackages } from '../../../scripts/check-release-version.mjs'
import { readReleaseArchives } from '../../../scripts/pack-release.mjs'
import { checkReleasePayloads, tagChecksums } from '../../../scripts/check-release-payloads.mjs'
import { lockIntegrity, preflightRegistry, publishRelease, registryHasEqualArchive } from '../../../scripts/publish-release-payloads.mjs'

const uploads = vi.hoisted(() => ({ calls: [], failAt: undefined, annotation: '' }))
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, spawnSync(command, args, options) {
    // Native tar exercises archive reads. No test can send an actual publication.
    if (command === 'tar') return actual.spawnSync(command, args, options)
    if (command === 'git') return { status: 0, stdout: 'object fixture\ntype commit\n\n' + uploads.annotation }
    if (command === 'sha256sum') return actual.spawnSync(process.platform === 'darwin' ? 'shasum' : command,
      process.platform === 'darwin' ? ['-a', '256', '-c'] : args, options)
    if (command !== 'pnpm' || args[0] !== 'publish') throw new Error('Unexpected release-test command: ' + command)
    uploads.calls.push({ command, args, options })
    return { status: uploads.calls.length === uploads.failAt ? 1 : 0 }
  } }
})

let root, payloads, lock, events, registry
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'dashi-release-'))
  uploads.calls.length = 0; uploads.failAt = undefined; uploads.annotation = ''
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
    const manifest = { name: unit.manifest.name, version: '0.2.0', main: 'index.js', dependencies: {} }
    if (manifest.name === '@antst/dashi-app') manifest.dependencies = {
      '@antst/dashi': '0.2.0', '@antst/dsh-file-uploads-none': '0.2.0',
      '@sessionbus/dsh': '0.1.1', '@antst/roller': '0.1.4', '@deepseek-ai/dsh-agent': '>=0.2.1-alpha.2',
    }
    if (manifest.name === '@antst/dashi') manifest.dependencies = { '@earendil-works/pi-tui': '0.84.4' }
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

it('requires four canonical, unique, expected filenames in the annotation', () => {
  fixture()
  const lines = payloads.map(payload => payload.sha256 + '  ' + payload.filename)
  const filenames = payloads.map(payload => payload.filename)
  expect(tagChecksums('Proven release\n\n' + lines.slice().reverse().join('\n'), filenames)).toBe(lines.join('\n') + '\n')
  for (const bad of ['', lines.slice(1).join('\n'), [...lines, lines[0]].join('\n'),
    [lines[0], lines[0], ...lines.slice(2)].join('\n'), lines.join('\n').replace(filenames[0], '../outside.tgz'),
    lines.join('\n').replace(payloads[0].sha256, payloads[0].sha256.toUpperCase()), lines.join('\n').replace('  ', ' ')]) {
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
  fixture()
  const first = payloads[0]
  registry.get(first.manifest.name).versions['0.2.0'] = { name: first.manifest.name, version: '0.2.0', dist: { integrity: first.integrity } }
  uploads.failAt = 2
  await expect(publishRelease(payloads, lock)).rejects.toThrow('registry outcome may be uncertain')
  expect(uploads.calls.map(call => call.args[1])).toEqual(payloads.slice(1, 3).map(payload => payload.archive))
  expect(uploads.calls[0].args).toEqual(['publish', payloads[1].archive, '--access', 'public', '--provenance', '--no-git-checks', '--tag', 'latest'])
  uploads.calls.length = 0; uploads.failAt = undefined
  for (const payload of payloads) registry.get(payload.manifest.name).versions['0.2.0'] = {
    name: payload.manifest.name, version: '0.2.0', dist: { integrity: payload.integrity },
  }
  await publishRelease(payloads, lock)
  expect(uploads.calls).toEqual([])
})
