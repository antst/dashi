import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkReleaseVersion, releasePackages, releaseRoot } from './check-release-version.mjs'

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) {
    throw new Error(command + ' failed:\n' + [result.stdout, result.stderr, result.error?.message].filter(Boolean).join('\n'))
  }
  return result.stdout
}

export function readReleaseArchives(directory, root = releaseRoot) {
  const packages = releasePackages(root)
  const version = checkReleaseVersion('v' + packages[0].manifest.version, packages.map(pkg => pkg.manifest.version))
  const names = new Set(packages.map(pkg => pkg.manifest.name))
  return packages.map(pkg => {
    const filename = pkg.manifest.name.replace(/^@/u, '').replace('/', '-') + '-' + version + '.tgz'
    const archive = resolve(directory, filename)
    const bytes = readFileSync(archive)
    const manifest = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json'], { maxBuffer: 1024 * 1024 }))
    if (manifest.name !== pkg.manifest.name || manifest.version !== version) throw new Error(filename + ': packed identity mismatch')
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (names.has(name) && range !== version) throw new Error(filename + ': sibling ' + name + ' must be exact ' + version)
      }
    }
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
      if (JSON.stringify(Object.keys(manifest[field] ?? {})) !== JSON.stringify(Object.keys(pkg.manifest[field] ?? {}))) {
        throw new Error(filename + ': ' + field + ' key order differs from source')
      }
    }
    const entries = new Set(run('tar', ['-tzf', archive]).trim().split('\n'))
    for (const entry of [manifest.main, manifest.types, ...Object.values(manifest.bin ?? {}), manifest.dsh?.bundle?.patch].filter(Boolean)) {
      if (!entries.has('package/' + entry.replace(/^\.\//u, ''))) throw new Error(filename + ': missing packed entry ' + entry)
    }
    return { archive, filename, manifest, sha256: createHash('sha256').update(bytes).digest('hex'),
      integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
  })
}

export function packRelease(directory) {
  if (process.platform !== 'linux' || process.arch !== 'x64' || process.versions.node !== '22.23.3') {
    throw new Error('Release archives require Linux x64 and Node 22.23.3')
  }
  const manager = JSON.parse(readFileSync(resolve(releaseRoot, 'package.json'), 'utf8')).packageManager
  const actual = run('pnpm', ['--version'], { cwd: releaseRoot }).trim()
  if (manager !== 'pnpm@' + actual) throw new Error('Release pack requires workspace ' + manager + ', got pnpm@' + actual)
  const packages = releasePackages()
  checkReleaseVersion('v' + packages[0].manifest.version, packages.map(pkg => pkg.manifest.version))
  rmSync(resolve(releaseRoot, 'packages/file-uploads-none/lib'), { recursive: true, force: true })
  rmSync(resolve(releaseRoot, 'packages/dashi/lib'), { recursive: true, force: true })
  console.error(run('pnpm', ['build'], { cwd: releaseRoot }).trim())
  mkdirSync(directory, { recursive: true })
  for (const pkg of packages) {
    console.error(run('pnpm', ['--dir', pkg.directory, 'pack', '--pack-destination', resolve(directory)], { cwd: releaseRoot }).trim())
  }
  return readReleaseArchives(directory)
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/pack-release.mjs ARCHIVE_DIRECTORY')
  for (const payload of packRelease(process.argv[2])) console.log(payload.sha256 + '  ' + payload.filename)
}
