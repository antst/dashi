import { expect } from 'vitest'

export interface RuntimePackage {
  name: string
  version: string
  dir: string
  manifest: { dependencies?: Record<string, string> }
}
export interface RuntimeRecord {
  packages: Record<string, RuntimePackage>
  peers: Record<string, Record<string, RuntimePackage>>
  kit: RuntimePackage
  active: Array<{ enabled: boolean; fiberPhase: string; moduleName: string }>
  fileUploadsRegistered: boolean
  profileRootImporter: string
  fileUploadsProvider: { name: string; fiber: string; importer: string; package: RuntimePackage } | null
  resolution: Array<{ name: string; version: string; scope: string; packageDir: string }>
}

/** Runtime selections only. An inactive second package on disk is not a failure. */
export function assertActiveRuntime(
  record: RuntimeRecord, dshVersion: string, appVersion: string, phase: 'published' | 'candidate' = 'candidate',
): void {
  expect(record.fileUploadsRegistered).toBe(true)
  expect(record.fileUploadsProvider?.name).toBe('fileUploads')
  expect(record.fileUploadsProvider?.fiber).toBe('file-uploads-none')
  expect(record.fileUploadsProvider?.package.name).toBe('@antst/dsh-file-uploads-none')
  expect(new URL('.', record.fileUploadsProvider?.importer).href).toBe(new URL('.', record.profileRootImporter).href)
  for (const name of ['@antst/dashi', '@antst/dsh-file-uploads-none', '@sessionbus/dsh']) {
    expect(record.active.filter(entry => entry.moduleName === name), `single ACTIVE ${name}`).toHaveLength(1)
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
  expect(record.fileUploadsProvider?.package.version, 'actually loaded provider vs app pin')
    .toBe(app?.manifest.dependencies?.['@antst/dsh-file-uploads-none'])
  for (const name of ['@antst/dashi', '@antst/dsh-file-uploads-none', '@antst/roller', '@sessionbus/dsh']) {
    expect(record.packages[name]?.version, name).toBe(app?.manifest.dependencies?.[name])
  }
  expect(record.kit.version).toBe(record.packages['@sessionbus/dsh']?.manifest.dependencies?.['@sessionbus/kit'])
}
