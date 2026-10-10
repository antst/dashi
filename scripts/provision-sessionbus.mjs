import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const version = '0.5.12'
const checksums = {
  'darwin-arm64': 'b9908a19f542ff07907fdef423e352cc229ddb725904bfe5ed84971cd58c72bc',
  'darwin-x64': '4ae2548f9b2f0f68c7284430032421c24d8683414aaddab4539d019c966e1bd5',
  'linux-arm64': '8c8ca010f064dcfaf251260d727527c81b4dc2a003c287f67d68bd9ec2ec237d',
  'linux-x64': 'ec4361b001a49c45087ea63453560a3cd16463697d959b8c8edcee2c8681f785',
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
const archive = join(directory, `${version}-${asset}`)
const binary = join(directory, 'bin', 'sessionbus')
const base = `https://github.com/sessionbus/sessionbus/releases/download/v${version}`
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
