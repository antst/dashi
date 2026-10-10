import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

interface PatchRow {
  readonly disabled: boolean
  readonly id: string
  readonly name?: string
}

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))

function rowsAt(source: string, spaces: number): readonly PatchRow[] {
  const lines = source.split('\n')
  const prefix = ' '.repeat(spaces)
  const rows: PatchRow[] = []
  for (let index = 0; index < lines.length; index++) {
    const match = new RegExp(`^${prefix}- id: ([^\\s]+)$`, 'u').exec(lines[index] ?? '')
    if (match?.[1] === undefined) continue
    const body: string[] = []
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next] ?? ''
      if (line.startsWith(`${prefix}- `) || line.length > 0 && !line.startsWith(`${prefix}  `)) break
      body.push(line)
    }
    const name = body.map(line => new RegExp(`^${prefix}  name: ['"]?([^'"]+)['"]?$`, 'u').exec(line)?.[1])
      .find(value => value !== undefined)
    rows.push({
      disabled: body.some(line => line === `${prefix}  disabled: true`),
      id: match[1],
      ...(name === undefined ? {} : { name }),
    })
  }
  return rows
}

function manifest(path: string): { readonly name: string; readonly version: string } {
  return JSON.parse(readFileSync(path, 'utf8')) as { name: string; version: string }
}

describe('validated DSH patch surface', () => {
  it('keeps dashi overrides and preset composition aligned with installed DSH', () => {
    const require = createRequire(import.meta.url)
    const dshManifestPath = require.resolve('@deepseek-ai/dsh/package.json')
    const fromDsh = createRequire(dshManifestPath)
    const baseManifestPath = fromDsh.resolve('@deepseek-ai/dsh-base/package.json')
    const { tested } = JSON.parse(readFileSync(
      join(root, 'packages', 'dashi', 'validated-dsh-versions.json'), 'utf8',
    )) as { tested: string[] }
    for (const path of [dshManifestPath, baseManifestPath]) {
      const installed = manifest(path)
      expect(tested, `${installed.name}@${installed.version} is not tested`).toContain(installed.version)
    }

    const dashi = readFileSync(join(root, 'packages', 'dashi-app', 'cordis.patch.yml'), 'utf8')
    const base = readFileSync(join(dirname(baseManifestPath), 'cordis.patch.yml'), 'utf8')
    const dashiOverrides = rowsAt(dashi, 0)
    const baseRows = new Map(rowsAt(base, 4).map(row => [row.id, row]))
    for (const row of dashiOverrides) expect(baseRows.has(row.id), `base row ${row.id}`).toBe(true)

    const disabled = (rows: readonly PatchRow[]): string[] => rows.filter(row => row.disabled)
      .map(row => row.id).sort()
    // DSH base owns the host rows. Dashi owns only its terminal preset, not web presets.
    expect(disabled(dashiOverrides)).toEqual([])
    expect(dashiOverrides.map(row => row.id)).toEqual(['system-prompt', 'session-query-sqlite'])
    const scoped = rowsAt(dashi, 10)
    expect(scoped.map(row => [row.id, row.name])).toEqual([
      ['tool-ask-user', '@deepseek-ai/dsh-tool-ask-user'],
      ['tool-present', '@deepseek-ai/dsh-tool-present'],
      ['tool-ralph', '@deepseek-ai/dsh-tool-ralph'],
      ['time-context', '@deepseek-ai/dsh-time-context'],
      ['tool-subagent', '@deepseek-ai/dsh-tool-subagent'],
    ])
    expect(rowsAt(dashi, 4).find(row => row.id === 'preset-standard')?.name)
      .toBe('@deepseek-ai/dsh-agent-preset')
    expect(dashi).toContain('modelSelectionSettings: true')
    expect(dashi).not.toContain('toolFilter:')
    expect(rowsAt(dashi, 4).some(row => row.id === 'authorization')).toBe(false)
  })
})
