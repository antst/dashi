import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const temporary = process.env.DSH_HOME === undefined
const home = process.env.DSH_HOME ?? mkdtempSync(join(tmpdir(), 'dashi-dev-'))
const env = { ...process.env, DSH_HOME: home }
const dsh = join(root, 'node_modules', '.bin', 'dsh')
const plugin = join(root, 'packages', 'dashi')
const bundle = join(root, 'packages', 'dashi-app')

let exitCode = 0
function run(args) {
  const result = spawnSync(dsh, args, { cwd: root, env, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  exitCode = result.status ?? 1
  return exitCode === 0
}

function setLocalOverride() {
  const path = join(home, 'profiles', 'dashi-dev', 'pnpm-workspace.yaml')
  const startMarker = '# dashi local workspace override: start'
  const endMarker = '# dashi local workspace override: end'
  const current = readFileSync(path, 'utf8')
  const block = `${startMarker}\noverrides:\n  '@antst/dashi': 'link:${plugin}'\n${endMarker}\n`
  const start = current.indexOf(startMarker)
  const end = current.indexOf(endMarker, start) + endMarker.length + 1
  if (start >= 0 && end <= endMarker.length) throw new Error('dashi dev: malformed local override block')
  writeFileSync(path, start < 0 ? `${current}\n${block}` : `${current.slice(0, start)}${block}${current.slice(end)}`)
}

try {
  if (run(['plugin', '--profile', 'dashi-dev', 'install'])) {
    setLocalOverride()
    if (run(['plugin', '--profile', 'dashi-dev', 'add', bundle])) {
      run(['--profile', 'dashi-dev', ...process.argv.slice(2)])
    }
  }
} finally {
  if (temporary) rmSync(home, { recursive: true, force: true })
}
process.exitCode = exitCode
