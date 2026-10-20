import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'

const source = readFileSync(new URL('../../../scripts/gate.mjs', import.meta.url), 'utf8')
const selection = source.slice(source.indexOf('const rendererPath ='), source.indexOf('const packageFiles ='))
const renderer = 'packages/dashi/tests/renderer.spec.ts'
const excludes = ['**/.cache/**', '**/node_modules/**', '**/dist/**', '**/coverage/**', '**/.omc/**', 'packages/*/lib/**']

it('prints earlier graph failures even when the pi-ai diagnostic throws', () => {
  const preflight = source.slice(source.indexOf('const failures = []'), source.indexOf('const rendererPath ='))
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    const testedVersion = 'fixture';
    const readFile = async path => path.pathname.endsWith('pnpm-workspace.yaml')
      ? "\\ncatalog:\\n  '@deepseek-ai/dsh': wrong\\n"
      : path.pathname.endsWith('pnpm-lock.yaml')
        ? "\\npackages:\\n  '@deepseek-ai/dsh@fixture':\\n"
        : JSON.stringify({ version: testedVersion, dependencies: {} });
    const fileURLToPath = value => value;
    const createRequire = () => ({ resolve: () => new URL('file:///fixture/package.json') });
    const deriveCliPins = () => ({});
    const assertPinnedGraph = () => {};
    const resolvedPiAiVersion = () => { throw new Error('provider missing'); };
    ${preflight}`], { encoding: 'utf8' })
  expect(result.status).toBe(1)
  expect(result.stderr).toContain('pnpm-workspace.yaml: @deepseek-ai/dsh must be fixture')
  expect(result.stderr).toContain('resolved pi-ai: Error: provider missing')
})

function fixture(git = true) {
  const root = mkdtempSync(join(tmpdir(), 'dashi-gate-selection-'))
  onTestFinished(() => { rmSync(root, { recursive: true, force: true }) })
  if (git) {
    expect(spawnSync('git', ['init', '--quiet', root]).status).toBe(0)
    for (const file of ['renderer.spec.ts', 'other [one].spec.ts']) writeFileSync(join(root, file), '')
    expect(spawnSync('git', ['add', '.'], { cwd: root }).status).toBe(0)
  }
  const log = join(root, 'calls.jsonl')
  const run = (env = {}) => spawnSync(process.execPath, ['--input-type=module', '-e',
    `import { spawnSync as nativeSpawn } from 'node:child_process';
    import { appendFileSync } from 'node:fs';
    const spawnSync = (command, args, options) => {
      if (command !== 'pnpm') return nativeSpawn(command, args, options);
      appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
      const silent = args[0] === '--silent'; if (silent) args = args.slice(1);
      if (args[2] === 'list') return { status: 0, stdout: (!silent && process.env.PNPM_SUMMARY ? process.env.PNPM_SUMMARY + '\\n' : '') + (args[4] === ${JSON.stringify(renderer)} ? process.env.RENDERER_LIST : process.env.REST_LIST) + '\\n' };
      return { status: args[2] === 'run' && process.env.FAIL_PHASE === (args[3] === ${JSON.stringify(renderer)} ? 'first' : 'second') ? 7 : 0 };
    };
    const root = ${JSON.stringify(root)}; const testedVersion = 'fixture';\n${selection}`], {
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
  const vitest = calls().filter(args => args.includes('vitest'))
  expect(vitest).toHaveLength(4)
  for (let index = 0; index < 4; index += 2) {
    expect(vitest[index].slice(0, 5)).toEqual(['--silent', 'exec', 'vitest', 'list', '--filesOnly'])
    expect(vitest[index].slice(5)).toEqual(vitest[index + 1].slice(3))
    for (const path of excludes) expect(vitest[index]).toContain(path)
  }
})

it.each([true, false])('pnpm refresh summaries cannot become selected paths or counts (Git present: %s)', git => {
  const { run, calls } = fixture(git)
  const result = run({ PNPM_SUMMARY: 'Scope: all 5 workspace projects\nLockfile is up to date\nDone in 1.1s using pnpm v11.28.5' })
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toContain('renderer tests: 1 files')
  expect(result.stdout).toContain('tests: 1 files')
  expect(result.stdout).not.toContain('Scope:')
  expect(calls().filter(args => args.includes('list')).every(args => args[0] === '--silent')).toBe(true)
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
