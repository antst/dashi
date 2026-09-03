import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readClipboardImage } from '../src/clipboard-image.js'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')

function helper(directory: string, name: string, body: string): void {
  const file = join(directory, name)
  writeFileSync(file, `#!${process.execPath}\n${body}\n`)
  chmodSync(file, 0o755)
}

describe('clipboard image boundary', () => {
  it('reads Linux image bytes from the first available helper', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dashi-clipboard-'))
    helper(directory, 'wl-paste', `process.stdout.write(Buffer.from('${png.toString('base64')}', 'base64'))`)
    await expect(readClipboardImage('linux', directory)).resolves.toEqual({
      bytes: png.byteLength,
      data: new Uint8Array(png),
      mediaType: 'image/png',
      name: 'clipboard.png',
      path: 'clipboard',
    })
  })

  it('reports helper absence and an empty clipboard as one-line errors', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'dashi-clipboard-empty-'))
    await expect(readClipboardImage('linux', empty)).rejects.toThrow('needs wl-paste or xclip')
    helper(empty, 'xclip', 'process.exit(2)')
    await expect(readClipboardImage('linux', empty)).rejects.toThrow('does not contain a PNG image')
  })

  it('uses the macOS osascript fallback when pngpaste is absent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dashi-clipboard-macos-'))
    helper(directory, 'osascript', `process.stdout.write('${png.toString('base64')}\\n')`)
    await expect(readClipboardImage('darwin', directory)).resolves.toMatchObject({
      bytes: png.byteLength, mediaType: 'image/png', name: 'clipboard.png', path: 'clipboard',
    })
  })
})
