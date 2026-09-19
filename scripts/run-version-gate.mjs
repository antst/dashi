import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const policy = JSON.parse(readFileSync(join(source, 'packages/dashi/validated-dsh-versions.json'), 'utf8'))
const tested = Array.isArray(policy.tested) ? policy.tested : []
const version = process.env.DSH_TEST_VERSION ?? tested[0]
if (!tested.includes(version)) throw new Error(`DSH ${String(version)} is not in the tested matrix`)
const temporary = version === tested[0] ? undefined : mkdtempSync(join(tmpdir(), 'dashi-version-gate-'))
const workspace = temporary === undefined ? source : join(temporary, 'workspace')

function run(args) {
  const result = spawnSync('pnpm', args, {
    cwd: workspace, env: { ...process.env, DSH_TEST_VERSION: version }, stdio: 'inherit',
  })
  if (result.status !== 0) throw new Error(`pnpm ${args.join(' ')} exited ${String(result.status)}`)
}

try {
  if (temporary === undefined) {
    run(['install', '--frozen-lockfile'])
    run(['gate', version])
  } else {
    cpSync(source, workspace, { recursive: true, filter(path) {
      const parts = relative(source, path).split(sep)
      return !parts.some(part => ['.git', '.pnpm-store', 'node_modules'].includes(part))
    } })
    const workspaceFile = join(workspace, 'pnpm-workspace.yaml')
    const workspaceText = readFileSync(workspaceFile, 'utf8')
    const catalogStart = workspaceText.indexOf('\ncatalog:\n')
    if (catalogStart < 0) throw new Error('pnpm workspace has no catalog')
    // Catalog specifiers bypass readPackage, so rewrite them as well as installing the hook.
    const catalog = workspaceText.slice(catalogStart).replace(
      /^(  '@deepseek-ai\/dsh(?:-[^']+)?': )\S+$/gmu, `$1${version}`,
    )
    writeFileSync(workspaceFile, workspaceText.slice(0, catalogStart) + catalog)
    copyFileSync(join(workspace, '.github/scripts/dsh-version-pnpmfile.cjs'), join(workspace, '.pnpmfile.cjs'))
    rmSync(join(workspace, 'pnpm-lock.yaml'))
    run(['install', '--no-frozen-lockfile'])
    const packageSection = readFileSync(join(workspace, 'pnpm-lock.yaml'), 'utf8').split('\nsnapshots:\n', 1)[0]
    const resolved = [...packageSection.matchAll(/^  '?(@deepseek-ai\/dsh[^@']*)@([^':]+)'?:$/gmu)]
    const mismatches = resolved.filter(([, , installed]) => installed !== version)
    if (resolved.length === 0 || mismatches.length > 0) {
      throw new Error(`DSH graph is not uniform at ${version}: ${mismatches.map(match => match[0]).join(', ')}`)
    }
    console.log(`gate: prepared ${resolved.length} uniform DSH packages at ${version}`)
    run(['gate', version])
  }
} finally {
  if (temporary !== undefined) rmSync(temporary, { recursive: true, force: true })
}
