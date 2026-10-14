import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished, vi } from 'vitest'
import { pruneInstallLayout } from './install-layout-cleanup.js'

const source = readFileSync(new URL('./install-layouts.acceptance.ts', import.meta.url), 'utf8')
const hook = source.slice(source.indexOf('  onTestFinished(context => {'), source.indexOf('  const daemon = await startTestDaemon()'))

function fixture(result, prune = pruneInstallLayout) {
  const workspace = mkdtempSync(join(tmpdir(), 'dashi-layout-finalize-'))
  onTestFinished(() => { rmSync(workspace, { recursive: true, force: true }) })
  for (const directory of ['tools', 'user', 'native-fresh', 'native-0.2.0', 'project-0.2.0', 'unowned-evidence']) {
    mkdirSync(join(workspace, directory)); writeFileSync(join(workspace, directory, 'marker'), '')
  }
  writeFileSync(join(workspace, 'commands.log'), 'retained commands')
  const hooks = []
  const log = vi.fn()
  // Execute the acceptance file's actual hook, not a second finalization implementation.
  new Function('onTestFinished', 'workspace', 'result', 'pruneInstallLayout', 'writeFileSync', 'join',
    'process', 'appendFileSync', 'layout', 'console', hook)(
    callback => hooks.push(callback), workspace, result, prune, writeFileSync, join,
    { env: {} }, vi.fn(), 'control', { log },
  )
  expect(hooks).toHaveLength(1)
  return { workspace, finish: state => hooks[0]({ task: { result: state === undefined ? undefined : { state } } }), log }
}

it.each(['fail', 'skip', undefined])('native task state %s retains the whole workspace and writes no PASS', state => {
  const control = fixture({ passed: true, wallSeconds: 1 })
  control.finish(state)
  for (const directory of ['tools', 'user', 'native-fresh', 'native-0.2.0', 'project-0.2.0']) expect(existsSync(join(control.workspace, directory, 'marker'))).toBe(true)
  expect(existsSync(join(control.workspace, 'result.json'))).toBe(false)
  expect(control.log).not.toHaveBeenCalled()
})

it.each([
  { layout: 'normal', platform: 'linux-x64', node: 'fixture', pmVersion: 'fixture', wallSeconds: 1, passed: true },
  { layout: 'below-floor', candidate: 'package@version', node: 'fixture', pmVersion: 'fixture', wallSeconds: 1, passed: true },
])('success preserves the result fields after pruning: $layout', result => {
  const control = fixture(result, workspace => {
    expect(existsSync(join(workspace, 'result.json'))).toBe(false)
    pruneInstallLayout(workspace)
  })
  control.finish('pass')
  expect(existsSync(join(control.workspace, 'tools'))).toBe(false)
  expect(existsSync(join(control.workspace, 'native-0.2.0'))).toBe(false)
  expect(existsSync(join(control.workspace, 'project-0.2.0'))).toBe(false)
  expect(existsSync(join(control.workspace, 'unowned-evidence', 'marker'))).toBe(true)
  expect(readFileSync(join(control.workspace, 'commands.log'), 'utf8')).toBe('retained commands')
  expect(JSON.parse(readFileSync(join(control.workspace, 'result.json'), 'utf8'))).toEqual(result)
  expect(control.log).toHaveBeenCalledTimes(1)
})

it('cleanup failure cannot write result.json or print PASS', () => {
  const control = fixture({ passed: true, wallSeconds: 1 }, () => { throw new Error('owned cleanup refused') })
  expect(() => control.finish('pass')).toThrow('owned cleanup refused')
  expect(existsSync(join(control.workspace, 'tools', 'marker'))).toBe(true)
  expect(existsSync(join(control.workspace, 'result.json'))).toBe(false)
  expect(control.log).not.toHaveBeenCalled()
})
