import { readFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import type {
  AttachmentStore,
  EncodedImageAttachment,
  ImageAttachmentRef,
  ImageMediaType,
} from '@deepseek-ai/dsh-attachment'
import type { DraftAttachment } from './state.js'

const MEDIA_TYPES: Readonly<Record<string, ImageMediaType>> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function isImagePath(path: string): boolean {
  return MEDIA_TYPES[extname(path).toLocaleLowerCase()] !== undefined
}

export function draftImage(
  data: Uint8Array,
  mediaType: ImageMediaType,
  name: string,
  path: string,
): DraftAttachment {
  return { bytes: data.byteLength, data, mediaType, name, path }
}

/** Snapshot explicit user paths into one disposable composer draft. */
export async function readDraftImages(cwd: string, paths: readonly string[]): Promise<DraftAttachment[]> {
  return Promise.all(paths.map(async (path) => {
    const absolute = resolve(cwd, path)
    const mediaType = MEDIA_TYPES[extname(absolute).toLocaleLowerCase()]
    if (mediaType === undefined) {
      throw new Error(`unsupported image extension for ${path}; accepted: .png, .jpg, .jpeg, .webp, .gif`)
    }
    const data = new Uint8Array(await readFile(absolute))
    return draftImage(data, mediaType, basename(absolute), absolute)
  }))
}

export function encodeDraftImages(images: readonly DraftAttachment[]): EncodedImageAttachment[] {
  return images.map(image => ({
    data: Buffer.from(image.data).toString('base64'), mediaType: image.mediaType, name: image.name,
  }))
}

export function admitDraftImages(
  attachments: AttachmentStore,
  images: readonly DraftAttachment[],
): Promise<readonly ImageAttachmentRef[]> {
  return attachments.saveImages(images.map(image => ({
    data: image.data, mediaType: image.mediaType, name: image.name,
  })))
}
