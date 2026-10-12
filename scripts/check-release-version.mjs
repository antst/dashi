import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const releaseRoot = fileURLToPath(new URL('../', import.meta.url))

export function releasePackages(root = releaseRoot) {
  return ['file-uploads-none', 'dashi', 'dashi-app', 'dashi-launcher'].map(directory => {
    const path = resolve(root, 'packages', directory)
    return { directory: path, manifest: JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8')) }
  })
}

export function checkReleaseVersion(tag, versions) {
  if (typeof tag !== 'string' || tag !== tag.trim() || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(tag)) {
    throw new Error('Release tag must be vMAJOR.MINOR.PATCH, with no prerelease or build suffix')
  }
  const version = tag.slice(1)
  if (versions.length !== 4 || versions.some(actual => actual !== version)) {
    throw new Error('Release tag ' + tag + ' must match all four package versions')
  }
  return version
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(checkReleaseVersion(process.argv[2], releasePackages().map(pkg => pkg.manifest.version)))
}
