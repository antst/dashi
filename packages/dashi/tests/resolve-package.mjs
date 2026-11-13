import { readFileSync, realpathSync } from 'node:fs'
import { findPackageJSON } from 'node:module'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Physical files only: resolve from the selected importer's real manifest, never a guessed hoist. */
export function resolvePackage(name, anchor) {
  const manifestPath = realpathSync(findPackageJSON(name, pathToFileURL(realpathSync(anchor))))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.name !== name) throw new Error(`Selected package identity mismatch: ${name}`)
  return { name: manifest.name, version: manifest.version, dir: dirname(manifestPath), manifest, manifestPath }
}
