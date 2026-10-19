import { readFileSync } from 'node:fs'
import { createRequire, findPackageJSON } from 'node:module'

// The provider belongs to the selected CLI's adapter, not the gate's nearest pi-ai.
export function resolvedPiAiVersion(cliManifestPath) {
  const adapter = createRequire(cliManifestPath).resolve('@deepseek-ai/dsh-llm-pi-ai/package.json')
  const manifest = findPackageJSON('@earendil-works/pi-ai', adapter)
  if (manifest === undefined) throw new Error('CLI llm-pi-ai has no resolved pi-ai package')
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
  if (pkg.name !== '@earendil-works/pi-ai' || typeof pkg.version !== 'string' || pkg.version === '') {
    throw new Error('CLI llm-pi-ai resolved an invalid pi-ai manifest')
  }
  return pkg.version
}

export function deriveCliPins(dependencies) {
  return Object.fromEntries(Object.entries(dependencies ?? {}).flatMap(([name, declaration]) => {
    if (!name.startsWith('@deepseek-ai/') || name.startsWith('@deepseek-ai/dsh')) return []
    const floor = /^(?:\^|~|>=)?(\d+\.\d+\.\d+(?:-[\da-z.-]+)?)$/i.exec(declaration)
    if (!floor) throw new Error(`cannot derive CLI minimum for ${name}: ${String(declaration)}`)
    return [[name, floor[1]]]
  }))
}

export function assertPinnedGraph(lockfile, pins) {
  const packageSection = lockfile.split('\nsnapshots:\n', 1)[0]
  const resolved = [...packageSection.matchAll(/^  '?(@deepseek-ai\/[^@']+)@([^':]+)'?:$/gm)]
  for (const [name, pin] of Object.entries(pins)) {
    const versions = resolved.filter(([, packageName]) => packageName === name).map(([, , version]) => version)
    if (versions.length !== 1 || versions[0] !== pin) {
      throw new Error(`${name} must resolve once at CLI minimum ${pin}; found ${versions.join(', ') || 'none'}`)
    }
  }
}
