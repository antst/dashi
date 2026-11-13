import { expect } from 'vitest'

export interface RuntimePackage {
  name: string
  version: string
  dir: string
  manifest: { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }
}
export interface RuntimeRecord {
  packages: Record<string, RuntimePackage>
  peers: Record<string, Record<string, RuntimePackage>>
  kit: RuntimePackage
  companions: Record<string, RuntimePackage>
  active: Array<{ enabled: boolean; fiberPhase: string; moduleName: string }>
  fileUploadsRegistered: boolean
  profileRootImporter: string
  noUpload: { unresolved: boolean; promptError: string; beforeSeq: number; afterSeq: number }
  resolution: Array<{ name: string; version: string; scope: string; packageDir: string }>
}

/** Runtime selections only. An inactive second package on disk is not a failure. */
export function assertActiveRuntime(
  record: RuntimeRecord, dshVersion: string, appVersion: string, phase: 'published' | 'candidate' = 'candidate',
): void {
  expect(record.fileUploadsRegistered).toBe(true)
  expect(record.noUpload.unresolved).toBe(true)
  expect(record.noUpload.promptError).toBe('session/attachment-invalid')
  expect(record.noUpload.afterSeq).toBe(record.noUpload.beforeSeq)
  for (const [name, pkg] of Object.entries(record.packages)) expect(pkg.name, 'selected package identity').toBe(name)
  for (const importer of ['@antst/dashi', '@antst/dashi-app', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']) {
    expect(record.peers[importer], `${importer} peer selections recorded`).toBeDefined()
    for (const name of Object.keys(record.packages[importer]?.manifest.peerDependencies ?? {})) {
      if (name.startsWith('@deepseek-ai/') || name === 'zod') expect(record.peers[importer]?.[name]?.name, name).toBe(name)
    }
  }
  for (const name of ['@antst/dashi', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']) {
    expect(record.active.filter(entry => entry.moduleName === name && entry.enabled && entry.fiberPhase === 'active'), `single ACTIVE ${name}`).toHaveLength(1)
  }
  // Historical app/provider selections stay as published; DSH must still be coherent.
  for (const name of ['@deepseek-ai/dsh', '@deepseek-ai/dsh-base']) {
    expect(record.packages[name]?.version, name).toBe(dshVersion)
  }
  for (const peers of Object.values(record.peers)) {
    for (const [name, pkg] of Object.entries(peers)) {
      if (name.startsWith('@deepseek-ai/dsh')) expect(pkg.version, name).toBe(dshVersion)
    }
  }
  for (const entry of record.resolution) {
    if (entry.name.startsWith('@deepseek-ai/dsh') && ['installation', 'profile'].includes(entry.scope)) {
      expect(entry.version, `${entry.scope} ${entry.name}`).toBe(dshVersion)
    }
  }
  for (const name of ['@antst/dashi-app', '@antst/dashi']) {
    expect(record.packages[name]?.version, name).toBe(appVersion)
  }
  if (phase === 'published') return
  expect(record.packages['@antst/dsh-file-uploads-none']?.version).toBe(appVersion)
  const app = record.packages['@antst/dashi-app']
  for (const peers of Object.values(record.peers)) for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', 'zod']) {
    const peer = peers[name]
    if (peer !== undefined) {
      expect(peer.name).toBe(name)
      expect(peer.version, `${name} matches native producer (not physical factory identity)`).toBe(record.companions[name]?.version)
    }
  }
  for (const name of ['@antst/dashi', '@antst/dsh-file-uploads-none', '@antst/roller', '@sessionbus/dsh']) {
    expect(record.packages[name]?.version, name).toBe(app?.manifest.dependencies?.[name])
  }
  expect(record.kit.version).toBe(record.packages['@sessionbus/dsh']?.manifest.dependencies?.['@sessionbus/kit'])
}
