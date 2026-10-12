import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readReleaseArchives } from './pack-release.mjs'
import { releaseRoot } from './check-release-version.mjs'

export function lockIntegrity(lock, name, version) {
  const key = (name + '@' + version).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const record = new RegExp("^  '?" + key + "'?:\\n((?:    [^\\n]*\\n)+)", 'mu')
    .exec(lock.split('\nsnapshots:\n', 1)[0])?.[1]
  const integrity = /resolution: \{integrity: (sha512-[A-Za-z0-9+/]+=*)[},]/u.exec(record ?? '')?.[1]
  if (!integrity) throw new Error(name + '@' + version + ': no SHA512 integrity in the frozen lock')
  return integrity
}

export async function registryHasEqualArchive(name, version, integrity) {
  const response = await fetch('https://registry.npmjs.org/' + encodeURIComponent(name), { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(name + ': registry HTTP ' + response.status + ' is not version absence')
  const packument = await response.json()
  if (!packument || packument.name !== name || !packument.versions || typeof packument.versions !== 'object' || Array.isArray(packument.versions)) {
    throw new Error(name + ': invalid registry packument')
  }
  if (!Object.hasOwn(packument.versions, version)) return false
  const published = packument.versions[version]
  if (published.name !== name || published.version !== version || published.dist?.integrity !== integrity) {
    throw new Error(name + '@' + version + ': registry identity/integrity differs from expected archive')
  }
  return true
}

export async function preflightRegistry(payloads, lock) {
  const ownNames = new Set(payloads.map(payload => payload.manifest.name))
  const external = new Map()
  for (const payload of payloads) for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(payload.manifest[field] ?? {})) {
      if (!ownNames.has(name) && /^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/u.test(version)) {
        external.set(name + '@' + version, { name, version, integrity: lockIntegrity(lock, name, version) })
      }
    }
  }
  const present = await Promise.all(payloads.map(payload => registryHasEqualArchive(
    payload.manifest.name, payload.manifest.version, payload.integrity)))
  for (const dependency of external.values()) {
    if (!await registryHasEqualArchive(dependency.name, dependency.version, dependency.integrity)) {
      throw new Error(dependency.name + '@' + dependency.version + ': exact dependency is not published')
    }
  }
  return present
}

export async function publishRelease(payloads, lock) {
  // Complete every read before the first upload; never replay an uncertain upload.
  const present = await preflightRegistry(payloads, lock)
  for (const [index, payload] of payloads.entries()) {
    const identity = payload.manifest.name + '@' + payload.manifest.version
    if (present[index]) { console.log(identity + ': already published with equal bytes'); continue }
    const result = spawnSync('pnpm', ['publish', payload.archive, '--access', 'public', '--provenance', '--no-git-checks', '--tag', 'latest'],
      { cwd: releaseRoot, stdio: 'inherit' })
    if (result.error || result.status !== 0) throw new Error(identity + ': publish failed; registry outcome may be uncertain (' + (result.error ?? result.status) + ')')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/publish-release-payloads.mjs ARCHIVE_DIRECTORY')
  await publishRelease(readReleaseArchives(process.argv[2]), readFileSync(resolve(releaseRoot, 'pnpm-lock.yaml'), 'utf8'))
}
