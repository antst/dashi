import { spawn } from 'node:child_process'
import { draftImage } from './image-input.js'
import type { DraftAttachment } from './state.js'

const APPLE_SCRIPT = `
ObjC.import('AppKit')
const pasteboard = $.NSPasteboard.generalPasteboard
let data = pasteboard.dataForType('public.png')
if (!data) {
  const tiff = pasteboard.dataForType('public.tiff')
  if (tiff) {
    const image = $.NSBitmapImageRep.imageRepWithData(tiff)
    if (image) data = image.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $())
  }
}
if (!data) $.exit(2)
console.log(ObjC.unwrap(data.base64EncodedStringWithOptions(0)))
`.trim()

interface Capture {
  readonly found: boolean
  readonly output?: Uint8Array
}

function capture(command: string, args: readonly string[], base64: boolean, path?: string): Promise<Capture> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...(path === undefined ? {} : { env: { ...process.env, PATH: path } }),
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => { chunks.push(chunk) })
    child.once('error', error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') resolve({ found: false })
      else reject(error)
    })
    child.once('close', code => {
      if (code !== 0) return resolve({ found: true })
      const output = Buffer.concat(chunks)
      if (output.length === 0) return resolve({ found: true })
      if (!base64) return resolve({ found: true, output: new Uint8Array(output) })
      try {
        const decoded = Buffer.from(output.toString('utf8').trim(), 'base64')
        resolve({ found: true, ...(decoded.length === 0 ? {} : { output: new Uint8Array(decoded) }) })
      } catch (error) {
        reject(error)
      }
    })
  })
}

/** Read a PNG from an installed platform clipboard helper. */
export async function readClipboardImage(platform = process.platform, path?: string): Promise<DraftAttachment> {
  const attempts = platform === 'darwin'
    ? [
        ['pngpaste', ['-'], false] as const,
        ['osascript', ['-l', 'JavaScript', '-e', APPLE_SCRIPT], true] as const,
      ]
    : platform === 'linux'
      ? [
          ['wl-paste', ['--no-newline', '--type', 'image/png'], false] as const,
          ['xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o'], false] as const,
        ]
      : []
  let helperFound = false
  for (const [command, args, base64] of attempts) {
    const result = await capture(command, args, base64, path)
    helperFound ||= result.found
    if (result.output !== undefined) return draftImage(result.output, 'image/png', 'clipboard.png', 'clipboard')
  }
  if (attempts.length === 0) throw new Error('Clipboard image paste is supported on Linux and macOS.')
  throw new Error(helperFound
    ? 'The clipboard does not contain a PNG image.'
    : `Clipboard image paste needs ${platform === 'darwin' ? 'pngpaste or osascript' : 'wl-paste or xclip'}.`)
}
