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
    const webManifestPath = fromDsh.resolve('@deepseek-ai/dsh-web-app/package.json')
    const validated = JSON.parse(readFileSync(
      join(root, 'packages', 'dashi', 'validated-dsh-versions.json'), 'utf8',
    )) as string[]
    for (const path of [dshManifestPath, baseManifestPath, webManifestPath]) {
      const installed = manifest(path)
      expect(validated, `${installed.name}@${installed.version} is not validated`).toContain(installed.version)
    }

    const dashi = readFileSync(join(root, 'packages', 'dashi-app', 'cordis.patch.yml'), 'utf8')
    const base = readFileSync(join(dirname(baseManifestPath), 'cordis.patch.yml'), 'utf8')
    const web = readFileSync(join(dirname(webManifestPath), 'cordis.patch.yml'), 'utf8')
    const dashiOverrides = rowsAt(dashi, 0)
    const baseRows = new Map(rowsAt(base, 4).map(row => [row.id, row]))
    for (const row of dashiOverrides) expect(baseRows.has(row.id), `base row ${row.id}`).toBe(true)

    const disabled = (rows: readonly PatchRow[]): string[] => rows.filter(row => row.disabled)
      .map(row => row.id).sort()
    expect(disabled(dashiOverrides)).toEqual(disabled(rowsAt(web, 0)))

    const webInserts = new Map(rowsAt(web, 4).map(row => [row.id, row.name]))
    for (const row of rowsAt(dashi, 4).filter(row => row.id !== 'dashi')) {
      expect(webInserts.get(row.id), `web insert ${row.id}`).toBe(row.name)
    }
  })
})
