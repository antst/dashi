import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, expectTypeOf, it } from 'vitest'
import type { RuntimePtyShell } from './pty-shell.js'
import { assertActiveRuntime, type RuntimePackage, type RuntimeRecord } from './runtime-record.js'

// Oracle controls: metadata shaped like the native observer, not a replacement DSH runtime.
function record(): RuntimeRecord {
  const versions = {
    '@deepseek-ai/dsh': '0.2.1-alpha.2', '@deepseek-ai/dsh-base': '0.2.1-alpha.2',
    '@antst/dashi-app': '0.2.0-alpha.2', '@antst/dashi': '0.2.0-alpha.2',
    '@antst/dsh-file-uploads-none': '0.2.0-alpha.2', '@antst/roller': '0.1.4',
    '@sessionbus/dsh': '0.1.0-pre.20',
  }
  const packages = Object.fromEntries(Object.entries(versions).map(([name, version]) => [name, {
    name, version, dir: `/profile/node_modules/${name}`, manifest: {},
  }])) as Record<string, RuntimePackage>
  packages['@antst/dashi-app']!.manifest.dependencies = Object.fromEntries(
    Object.entries(versions).filter(([name]) => ['@antst/dashi', '@antst/dsh-file-uploads-none', '@antst/roller', '@sessionbus/dsh'].includes(name)))
  packages['@sessionbus/dsh']!.manifest.dependencies = { '@sessionbus/kit': '0.5.12' }
  const companions = Object.fromEntries(Object.entries({ '@deepseek-ai/cordis': '4.0.5', '@deepseek-ai/schemastery': '3.18.5', zod: '4.4.3' })
    .map(([name, version]) => [name, { name, version, dir: '/native/' + name, manifest: {} }]))
  const peers = Object.fromEntries(['@antst/dashi', '@antst/dashi-app', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']
    .map(name => [name, { ...companions }]))
  packages['@antst/dashi']!.manifest.peerDependencies = { '@deepseek-ai/cordis': '>=4.0.5', '@deepseek-ai/schemastery': '>=3.18.5' }
  return {
    packages, peers, companions, kit: { name: '@sessionbus/kit', version: '0.5.12', dir: '/kit', manifest: {} },
    active: ['@antst/dashi', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']
      .map(moduleName => ({ moduleName, enabled: true, fiberPhase: 'active' })),
    fileUploadsRegistered: true, profileRootImporter: 'file:///profile/package.json',
    noUpload: { unresolved: true, promptError: 'session/attachment-invalid', beforeSeq: 4, afterSeq: 4 },
    resolution: [{ name: '@deepseek-ai/dsh-base', version: '0.2.1-alpha.2', scope: 'profile', packageDir: '/base' }],
  }
}

describe('native installation oracle', () => {
  it('requires an explicit runtime record or refusal intent for installation launches', () => {
    type Arguments = ConstructorParameters<typeof RuntimePtyShell>
    expectTypeOf<Arguments>().toEqualTypeOf<[
      cwd: string, env: NodeJS.ProcessEnv, runtimeRecord: string | { expectRefusal: true, path: string },
    ]>()
    expectTypeOf<[string, NodeJS.ProcessEnv]>().not.toExtend<Arguments>()
  })

  it('stages the standalone observer with its shared resolver and imports the copied pair', () => {
    const staging = readFileSync(new URL('./install-layouts.acceptance.ts', import.meta.url), 'utf8')
      .split('// A standalone observer must not inherit the candidate package\'s admission floor.')[1]?.split('    const patch =')[0]
    expect(staging).toBeTypeOf('string')
    const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'dashi-observer-copy-')))
    try {
      const program = `import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
const root = ${JSON.stringify(fileURLToPath(new URL('../../../', import.meta.url)))}
const workspace = ${JSON.stringify(workspace)}
${staging}
process.stdout.write((await import(observer)).name)
`
      const result = spawnSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8', timeout: 10_000 })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toBe('dashi-runtime-observer')
      for (const [source, target] of [
        ['fixtures/runtime-observer.mjs', 'observer/runtime-observer.mjs'], ['resolve-package.mjs', 'resolve-package.mjs'],
      ]) expect(readFileSync(join(workspace, target!))).toEqual(readFileSync(new URL('./' + source, import.meta.url)))
    } finally { rmSync(workspace, { recursive: true, force: true }) }
  })

  it('rejects newer DSH parts in either runtime scope for candidates and historical baselines', () => {
    for (const scope of ['installation', 'profile']) {
      const observed = record()
      observed.resolution.push({ name: '@deepseek-ai/dsh-session-stats', version: '0.2.1-alpha.3', scope, packageDir: '/new' })
      expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
      expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
    }
  })

  it('records a historical selected provider version but rejects candidate non-convergence', () => {
    const observed = record()
    observed.packages['@antst/dsh-file-uploads-none']!.version = '0.1.2'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).not.toThrow()
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
  })

  it('requires native unknown-receipt refusal without admitting any input', () => {
    const observed = record()
    observed.noUpload.unresolved = false
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
    observed.noUpload.unresolved = true
    observed.noUpload.promptError = 'other-error'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
    observed.noUpload.promptError = 'session/attachment-invalid'
    observed.noUpload.afterSeq++
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
    observed.noUpload.afterSeq--
    observed.kit.version = '0.5.7'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
  })

  it('rejects a second active provider while permitting an inactive disk selection', () => {
    const observed = record()
    observed.active.push({ moduleName: '@antst/dsh-file-uploads-none', enabled: true, fiberPhase: 'active' })
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
    observed.active.pop()
    observed.resolution.push({ name: '@antst/dsh-file-uploads-none', version: '0.1.2', scope: 'inactive', packageDir: '/old' })
    observed.resolution.push({ name: '@deepseek-ai/dsh-base', version: '0.1.5-rc.2', scope: 'inactive', packageDir: '/old-dsh' })
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).not.toThrow()
  })

  it.each([false, true])('rejects a disabled/missing active entry, disabled=%s', disabled => {
    const observed = record()
    if (disabled) observed.active[0]!.enabled = false
    else observed.active.shift()
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
  })

  it('rejects wrong package identities and an unavailable public service', () => {
    const observed = record()
    observed.packages['@antst/dsh-file-uploads-none']!.name = 'different-provider'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
    observed.packages['@antst/dsh-file-uploads-none']!.name = '@antst/dsh-file-uploads-none'
    observed.fileUploadsRegistered = false
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
  })

  it.each(['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'zod'])('checks %s against its native producer without claiming physical factory identity', name => {
    const observed = record()
    observed.peers['@antst/dashi']![name] = { ...observed.companions[name]!, dir: '/another-physical-factory' }
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).not.toThrow()
    observed.peers['@antst/dashi']![name]!.version = '99.0.0'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
    observed.peers['@antst/dashi'] = {}
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
  })
})
