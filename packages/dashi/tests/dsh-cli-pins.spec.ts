import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolvedPiAiVersion } from '../../../scripts/dsh-cli-pins.mjs'

describe('resolved pi-ai diagnostic', () => {
  it('reads the selected CLI adapter importer, not a hoisted decoy, without pinning its version', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dashi-cli-pi-ai-')))
    try {
      const base = join(root, 'node_modules/@deepseek-ai/dsh-base')
      const adapter = join(base, 'node_modules/@deepseek-ai/dsh-llm-pi-ai')
      const provider = join(adapter, 'node_modules/@earendil-works/pi-ai')
      const decoy = join(root, 'node_modules/@earendil-works/pi-ai')
      const adapterDecoy = join(root, 'node_modules/@deepseek-ai/dsh-llm-pi-ai')
      for (const directory of [base, adapter, provider, decoy, adapterDecoy]) mkdirSync(directory, { recursive: true })
      writeFileSync(join(root, 'package.json'), '{"name":"@deepseek-ai/dsh"}')
      writeFileSync(join(base, 'package.json'), '{"name":"@deepseek-ai/dsh-base","exports":{"./package.json":"./package.json"}}')
      writeFileSync(join(adapterDecoy, 'package.json'), '{"name":"decoy-adapter","exports":{"./package.json":"./package.json"}}')
      writeFileSync(join(adapter, 'package.json'), '{"name":"@deepseek-ai/dsh-llm-pi-ai","exports":{"./package.json":"./package.json"}}')
      writeFileSync(join(decoy, 'package.json'), '{"name":"@earendil-works/pi-ai","version":"9.9.9","main":"index.js"}')
      writeFileSync(join(decoy, 'index.js'), 'throw new Error("must not execute the decoy")')
      for (const version of ['1.1.0', '1.3.0']) {
        writeFileSync(join(provider, 'package.json'), JSON.stringify({ name: '@earendil-works/pi-ai', version,
          type: 'module', exports: { '.': { import: './index.js' } } }))
        writeFileSync(join(provider, 'index.js'), 'throw new Error("must not execute pi-ai")')
        expect(resolvedPiAiVersion(join(root, 'package.json'))).toBe(version)
      }
      writeFileSync(join(provider, 'package.json'), '{"name":"not-pi-ai","version":"1.3.0","main":"index.js"}')
      expect(() => resolvedPiAiVersion(join(root, 'package.json'))).toThrow('invalid pi-ai manifest')
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('fails instead of inventing a version when the adapter has no pi-ai', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'dashi-cli-pi-ai-')))
    try {
      const base = join(root, 'node_modules/@deepseek-ai/dsh-base')
      const adapter = join(base, 'node_modules/@deepseek-ai/dsh-llm-pi-ai')
      mkdirSync(adapter, { recursive: true })
      writeFileSync(join(root, 'package.json'), '{"name":"@deepseek-ai/dsh"}')
      writeFileSync(join(base, 'package.json'), '{"exports":{"./package.json":"./package.json"}}')
      writeFileSync(join(adapter, 'package.json'), '{"exports":{"./package.json":"./package.json"}}')
      expect(() => resolvedPiAiVersion(join(root, 'package.json'))).toThrowError(expect.objectContaining({
        code: 'ERR_MODULE_NOT_FOUND',
        message: `Cannot find package '@earendil-works/pi-ai' imported from ${join(adapter, 'package.json')}`,
      }))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})
