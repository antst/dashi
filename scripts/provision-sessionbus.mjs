import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const version = '0.5.7'
const checksums = {
  'darwin-arm64': 'e70e5b9f2121782b5e661eb38e6b2aa3b400a9f98addc9fe8da9dde0e3f54d4d',
  'darwin-x64': 'c50de99fa0ca10ff8314d29803ae9c53f9f69fcc9e3a6053e3c4c0a74d9594b5',
  'linux-arm64': '44532d0244e9be24d0ebf54bc64a75bbbcfa0ffff50b1a9a944b670c04085086',
  'linux-x64': '328db4f500613ae3f431d23e5f44023fd2bef6f128936d25ac25931d1ff0bba4',
}
const platform = `${process.platform}-${process.arch}`
const expected = checksums[platform]
if (expected === undefined) throw new Error(`Sessionbus ${version} has no test daemon for ${platform}`)
if (process.argv.includes('--docker') && platform !== 'linux-x64') {
  throw new Error(`Sessionbus Docker gate requires linux-x64, not ${platform}`)
}

const root = resolve(import.meta.dirname, '..')
const directory = join(root, '.cache', 'sessionbus')
const asset = `sessionbus-host-${platform.replace('-x64', '-amd64')}.tar.gz`
const archive = join(directory, asset)
const binary = join(directory, 'bin', 'sessionbus')
const base = `https://github.com/antst/sessionbus/releases/download/v${version}`
mkdirSync(directory, { recursive: true })

if (!existsSync(archive)) {
  const published = await fetch(`${base}/SHA256SUMS`).then(async response => {
    if (!response.ok) throw new Error(`Sessionbus checksum download failed: ${response.status}`)
    return response.text()
  })
  const line = published.split('\n').find(row => row.endsWith(`  ${asset}`))
  if (line?.split(/\s+/u)[0] !== expected) {
    throw new Error(`Published checksum does not match the pinned ${asset} checksum`)
  }
  const response = await fetch(`${base}/${asset}`)
  if (!response.ok) throw new Error(`Sessionbus daemon download failed: ${response.status}`)
  writeFileSync(archive, Buffer.from(await response.arrayBuffer()))
}
const actual = createHash('sha256').update(readFileSync(archive)).digest('hex')
if (actual !== expected) throw new Error(`${asset} checksum mismatch: ${actual}`)
execFileSync('tar', ['-xzf', archive, '-C', directory])
if (!existsSync(binary)) throw new Error(`${asset} did not contain bin/sessionbus`)
chmodSync(binary, 0o755)
console.log(`Sessionbus test daemon ${version}: ${binary}`)
