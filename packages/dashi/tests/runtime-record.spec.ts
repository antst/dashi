import { describe, expect, it } from 'vitest'
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
  return {
    packages, peers: {}, kit: { name: '@sessionbus/kit', version: '0.5.12', dir: '/kit', manifest: {} },
    active: ['@antst/dashi', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']
      .map(moduleName => ({ moduleName, enabled: true, fiberPhase: 'active' })),
    fileUploadsRegistered: true, profileRootImporter: 'file:///profile/package.json',
    fileUploadsProvider: { name: 'fileUploads', fiber: 'file-uploads-none', importer: 'file:///profile/index.js',
      package: { ...packages['@antst/dsh-file-uploads-none']! } },
    resolution: [{ name: '@deepseek-ai/dsh-base', version: '0.2.1-alpha.2', scope: 'profile', packageDir: '/base' }],
  }
}

describe('native installation oracle', () => {
  it('rejects newer DSH parts in either runtime scope for candidates and historical baselines', () => {
    for (const scope of ['installation', 'profile']) {
      const observed = record()
      observed.resolution.push({ name: '@deepseek-ai/dsh-session-stats', version: '0.2.1-alpha.3', scope, packageDir: '/new' })
      expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
      expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
    }
  })

  it('records a published provider shadow but rejects candidate non-convergence', () => {
    const observed = record()
    observed.packages['@antst/dsh-file-uploads-none']!.version = '0.1.2'
    observed.fileUploadsProvider!.package.version = '0.1.2'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).not.toThrow()
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
  })

  it('rejects a stale loaded provider even when package resolution reports the pinned version', () => {
    const observed = record()
    observed.fileUploadsProvider!.package.version = '0.1.2'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2') }).toThrow()
    observed.fileUploadsProvider!.package.version = '0.2.0-alpha.2'
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

  it('rejects a service mounted from the bundle importer instead of the profile root', () => {
    const observed = record()
    observed.fileUploadsProvider!.importer = 'file:///profile/node_modules/@antst/dashi-app/index.js'
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
    observed.fileUploadsProvider!.importer = 'file:///profile/index.js'
    observed.fileUploadsRegistered = false
    expect(() => { assertActiveRuntime(observed, '0.2.1-alpha.2', '0.2.0-alpha.2', 'published') }).toThrow()
  })
})
