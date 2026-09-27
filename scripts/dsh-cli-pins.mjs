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
