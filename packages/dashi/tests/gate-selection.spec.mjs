import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

const source = readFileSync(new URL('../../../scripts/gate.mjs', import.meta.url), 'utf8')
const selection = source.slice(source.indexOf('const rendererPath ='), source.indexOf('const packageFiles ='))
const renderer = 'packages/dashi/tests/renderer.spec.ts'
const excludes = ['**/.cache/**', '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.omc/**', 'packages/*/lib/**']

function fixture(git = true) {
  const root = mkdtempSync(join(tmpdir(), 'dashi-gate-selection-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  if (git) {
    expect(spawnSync('git', ['init', '--quiet', root]).status).toBe(0)
    for (const file of ['renderer.spec.ts', 'other [one].spec.ts']) writeFileSync(join(root, file), '')
    expect(spawnSync('git', ['add', '.'], { cwd: root }).status).toBe(0)
  }
  const log = join(root, 'calls.jsonl')
  const pnpm = join(root, 'pnpm')
  writeFileSync(pnpm, `#!${process.execPath}
    const fs = require('node:fs'); const args = process.argv.slice(2);
    fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
    if (args[2] === 'list') console.log(args[4] === ${JSON.stringify(renderer)} ? process.env.RENDERER_LIST : process.env.REST_LIST);
    if (args[2] === 'run' && process.env.FAIL_PHASE === (args[3] === ${JSON.stringify(renderer)} ? 'first' : 'second')) process.exit(7);
  `)
  chmodSync(pnpm, 0o755)
  const run = (env = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { spawnSync } from 'node:child_process'; const root = ${JSON.stringify(root)}; const testedVersion = 'fixture';\n${selection}`], {
    cwd: root, encoding: 'utf8', env: { ...process.env, PATH: root + ':/usr/bin:/bin',
      RENDERER_LIST: 'renderer.spec.ts', REST_LIST: 'other [one].spec.ts', ...env },
  })
  return { run, calls: () => readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line)) }
}

it('counts native files-only lists, checks tracked paths, and uses the same filters in both invocations', () => {
  const { run, calls } = fixture()
  const result = run()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('renderer tests: 1 files (tracked)')
  expect(result.stdout).toContain('tests: 1 files (tracked)')
  const vitest = calls().filter(args => args[1] === 'vitest')
  expect(vitest).toHaveLength(4)
  for (let index = 0; index < 4; index += 2) {
    expect(vitest[index].slice(0, 4)).toEqual(['exec', 'vitest', 'list', '--filesOnly'])
    expect(vitest[index].slice(4)).toEqual(vitest[index + 1].slice(3))
    for (const path of excludes) expect(vitest[index]).toContain(path)
  }
})

it('refuses and names an untracked native selection before that phase executes', () => {
  const { run, calls } = fixture()
  const result = run({ REST_LIST: 'probe.spec.ts' })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('untracked test files:\nprobe.spec.ts')
  expect(calls().filter(args => args[2] === 'run')).toHaveLength(1)
})

it('a git-less workspace explicitly names the missing tracked check and retains native selection', () => {
  const { run } = fixture(false)
  const result = run()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('tracked-test check unavailable (Git-less workspace)')
  expect(result.stdout).not.toContain('(tracked)')
})

it.each(['first', 'second'])('a failing %s invocation cannot produce a successful gate', phase => {
  const { run, calls } = fixture()
  const result = run({ FAIL_PHASE: phase })
  expect(result.status).toBe(7)
  if (phase === 'first') {
    expect(result.stderr).toContain('remaining suite NOT RUN')
    expect(calls().filter(args => args[2] === 'run')).toHaveLength(1)
  } else expect(calls().filter(args => args[2] === 'run')).toHaveLength(2)
})
