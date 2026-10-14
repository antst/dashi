import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it, onTestFinished, vi } from 'vitest'
import { pruneInstallLayout } from './install-layout-cleanup.js'
import { testCeiling } from './test-budget.js'

const source = readFileSync(new URL('./install-layouts.acceptance.ts', import.meta.url), 'utf8')
const hook = source.slice(source.indexOf('  onTestFailed(({ task }) => {'), source.indexOf('  const daemon = await startTestDaemon()'))

function fixture(result, prune = pruneInstallLayout) {
  const workspace = mkdtempSync(join(tmpdir(), 'dashi-layout-finalize-'))
  onTestFinished(() => { rmSync(workspace, { recursive: true, force: true }) })
  for (const directory of ['tools', 'user', 'native-fresh', 'native-0.2.0', 'project-0.2.0', 'unowned-evidence']) {
    mkdirSync(join(workspace, directory)); writeFileSync(join(workspace, directory, 'marker'), '')
  }
  writeFileSync(join(workspace, 'commands.log'), 'retained commands')
  const hooks = []
  const failures = []
  const log = vi.fn()
  // Execute the acceptance file's actual hook, not a second finalization implementation.
  new Function('onTestFinished', 'onTestFailed', 'testCeiling', 'workspace', 'result', 'pruneInstallLayout', 'writeFileSync', 'join',
    'process', 'appendFileSync', 'layout', 'console', hook)(
    (callback, timeout) => { expect(timeout).toBe(testCeiling(60_000)); hooks.push(callback) },
    callback => failures.push(callback), testCeiling, workspace, result, prune, writeFileSync, join,
    { env: {} }, vi.fn(), 'control', { log },
  )
  expect(hooks).toHaveLength(1)
  expect(failures).toHaveLength(1)
  return { workspace, finish: task => hooks[0]({ task }), failed: task => failures[0]({ task }), log }
}

it.each(['fail', 'skip', undefined])('native task state %s retains the whole workspace and writes no PASS', async state => {
  const control = fixture({ passed: true, wallSeconds: 1 })
  await control.finish({ result: state === undefined ? undefined : { state } })
  for (const directory of ['tools', 'user', 'native-fresh', 'native-0.2.0', 'project-0.2.0']) expect(existsSync(join(control.workspace, directory, 'marker'))).toBe(true)
  expect(existsSync(join(control.workspace, 'result.json'))).toBe(false)
  expect(control.log).not.toHaveBeenCalled()
})

it.each([
  { layout: 'normal', platform: 'linux-x64', node: 'fixture', pmVersion: 'fixture', wallSeconds: 1, passed: true },
  { layout: 'below-floor', candidate: 'package@version', node: 'fixture', pmVersion: 'fixture', wallSeconds: 1, passed: true },
])('success preserves the result fields after pruning: $layout', async result => {
  const control = fixture(result, async workspace => {
    expect(existsSync(join(workspace, 'result.json'))).toBe(false)
    await pruneInstallLayout(workspace)
  })
  await control.finish({ result: { state: 'pass' } })
  expect(existsSync(join(control.workspace, 'tools'))).toBe(false)
  expect(existsSync(join(control.workspace, 'native-0.2.0'))).toBe(false)
  expect(existsSync(join(control.workspace, 'project-0.2.0'))).toBe(false)
  expect(existsSync(join(control.workspace, 'unowned-evidence', 'marker'))).toBe(true)
  expect(readFileSync(join(control.workspace, 'commands.log'), 'utf8')).toBe('retained commands')
  expect(JSON.parse(readFileSync(join(control.workspace, 'result.json'), 'utf8'))).toEqual(result)
  expect(control.log).toHaveBeenCalledTimes(2)
})

it('cleanup failure records the native reason and cannot print PASS', async () => {
  const control = fixture({ passed: true, wallSeconds: 1 }, () => { throw new Error('owned cleanup refused') })
  const task = { result: { state: 'pass' } }
  await expect(control.finish(task)).rejects.toThrow('owned cleanup refused')
  task.result = { state: 'fail', errors: [{ message: 'owned cleanup refused' }] }
  control.failed(task)
  expect(existsSync(join(control.workspace, 'tools', 'marker'))).toBe(true)
  expect(JSON.parse(readFileSync(join(control.workspace, 'result.json'), 'utf8')))
    .toMatchObject({ passed: false, reason: 'owned cleanup refused' })
  expect(control.log).not.toHaveBeenCalled()
})

it('a pending prune cannot publish PASS, and a late completion cannot overwrite native timeout', async () => {
  let complete
  const control = fixture({ wallSeconds: 1 }, () => new Promise(resolve => { complete = resolve }))
  const task = { result: { state: 'pass' } }
  const pending = control.finish(task)
  expect(existsSync(join(control.workspace, 'result.json'))).toBe(false)
  expect(control.log).not.toHaveBeenCalled()
  task.result = { state: 'fail', errors: [{ message: 'Hook timed out in 180000ms.' }] }
  control.failed(task)
  complete()
  await pending
  expect(JSON.parse(readFileSync(join(control.workspace, 'result.json'), 'utf8')))
    .toEqual({ wallSeconds: 1, passed: false, reason: 'Hook timed out in 180000ms.' })
  expect(control.log).not.toHaveBeenCalled()
})

it('real Vitest prune rejection and timeout record failure and never publish a late PASS', () => {
  const directory = mkdtempSync(join(tmpdir(), 'dashi-layout-hook-native-'))
  onTestFinished(() => { rmSync(directory, { recursive: true, force: true }) })
  const vitest = new URL('../../../node_modules/vitest/dist/index.js', import.meta.url).href
  writeFileSync(join(directory, 'native.spec.mjs'), `
import { it, afterAll } from ${JSON.stringify(vitest)}
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
afterAll(() => new Promise(resolve => setTimeout(resolve, 120)))
for (const mode of ['rejected', 'timeout', 'blocked']) it(mode, ({ onTestFinished, onTestFailed }) => {
  const workspace = join(${JSON.stringify(directory)}, mode)
  mkdirSync(workspace)
  const result = { wallSeconds: 1 }
  const layout = mode
  const testCeiling = () => 30 // Accelerate only this control's native hook deadline.
  const pruneInstallLayout = mode === 'rejected'
    ? async () => { throw new Error('owned prune refused') }
    : mode === 'blocked'
      ? async () => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 80) }
      : () => new Promise(resolve => setTimeout(resolve, 80))
${hook}
})
`)
  writeFileSync(join(directory, 'config.mjs'), `export default { root: ${JSON.stringify(directory)}, test: { include: ['native.spec.mjs'] } }`)
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url)),
    'run', '--config', join(directory, 'config.mjs')], { encoding: 'utf8', timeout: 20_000 })
  expect(child.status, child.stdout + child.stderr).toBe(1)
  expect(child.stdout + child.stderr).not.toContain('install cell PASS')
  for (const [mode, reason] of [['rejected', 'owned prune refused'], ['timeout', 'Hook timed out in 30ms'], ['blocked', 'Owned prune exceeded its hook ceiling']]) {
    const result = JSON.parse(readFileSync(join(directory, mode, 'result.json'), 'utf8'))
    expect(result.passed).toBe(false)
    expect(result.reason).toContain(reason)
  }
})
