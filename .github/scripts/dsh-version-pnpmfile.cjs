const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const cordisPins = JSON.parse(process.env.DSH_CORDIS_PINS ?? '{}')

module.exports = { hooks: { readPackage(pkg) {
  for (const field of fields) for (const name of Object.keys(pkg[field] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) pkg[field][name] = process.env.DSH_TEST_VERSION
    else if (cordisPins[name]) pkg[field][name] = cordisPins[name]
  }
  return pkg
} } }
