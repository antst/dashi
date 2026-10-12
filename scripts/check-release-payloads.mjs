import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkReleaseVersion, releasePackages, releaseRoot } from './check-release-version.mjs'
import { readReleaseArchives } from './pack-release.mjs'
import { preflightRegistry } from './publish-release-payloads.mjs'

export function tagChecksums(message, filenames) {
  const lines = message.split('\n').filter(line => /^[a-fA-F0-9]{64}\b/u.test(line))
  if (lines.length !== 4) throw new Error('Annotated tag must contain exactly four archive hash lines')
  const hashes = new Map()
  for (const line of lines) {
    const match = /^([a-f0-9]{64})  (\S+)$/u.exec(line)
    if (!match || !filenames.includes(match[2]) || hashes.has(match[2])) throw new Error('Invalid or duplicate tag archive hash line: ' + line)
    hashes.set(match[2], match[1])
  }
  return filenames.map(filename => hashes.get(filename) + '  ' + filename).join('\n') + '\n'
}

export async function checkReleasePayloads(tag, directory) {
  checkReleaseVersion(tag, releasePackages().map(pkg => pkg.manifest.version))
  const annotation = spawnSync('git', ['cat-file', 'tag', 'refs/tags/' + tag], { cwd: releaseRoot, encoding: 'utf8' })
  if (annotation.error || annotation.status !== 0) throw new Error('Release requires an annotated tag: ' + (annotation.error ?? annotation.stderr))
  const payloads = readReleaseArchives(directory)
  const checksums = tagChecksums(annotation.stdout.slice(annotation.stdout.indexOf('\n\n') + 2), payloads.map(payload => payload.filename))
  const checked = spawnSync('sha256sum', ['--check', '--strict'], { cwd: resolve(directory), encoding: 'utf8', input: checksums })
  if (checked.error || checked.status !== 0) throw new Error('Release payload hash mismatch: ' + (checked.error ?? checked.stdout + checked.stderr))
  console.log(checked.stdout.trim())
  await preflightRegistry(payloads, readFileSync(resolve(releaseRoot, 'pnpm-lock.yaml'), 'utf8'))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node scripts/check-release-payloads.mjs TAG ARCHIVE_DIRECTORY')
  await checkReleasePayloads(process.argv[2], process.argv[3])
}
