const fields = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']

module.exports = { hooks: { readPackage(pkg) {
  for (const field of fields) for (const name of Object.keys(pkg[field] ?? {})) {
    if (name.startsWith('@deepseek-ai/dsh')) pkg[field][name] = process.env.DSH_TEST_VERSION
  }
  return pkg
} } }
