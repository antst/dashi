const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']
const cliPins = JSON.parse(process.env.DSH_CLI_PINS ?? '{}')

module.exports = { hooks: { readPackage(pkg) {
  for (const field of fields) for (const name of Object.keys(pkg[field] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) pkg[field][name] = process.env.DSH_TEST_VERSION
    else if (cliPins[name]) pkg[field][name] = cliPins[name]
  }
  return pkg
} } }
