import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const version = '0.5.16'
// Official release asset: https://github.com/sessionbus/sessionbus/releases/download/v0.5.16/SHA256SUMS
const checksums = {
  'darwin-arm64': '1ae2659c038f32c63b06eec6f798d3e9eaaf630743d7d5e39985cb82ec0a8b62',
  'darwin-x64': '8796b443495bcfae57a6518f88fa9566dce73288fdc619a94e88939d20eb292f',
  'linux-arm64': '82f81f351e4705d123d1fcb137966d9835cd401c8405a26f0a9c8905a2c74f3d',
  'linux-x64': 'e183d3f2ad8b999c612238e921fcdb093a6b52342c2ba7509c47e6551c7f0a03',
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
