import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { admitDraftImages, encodeDraftImages, readDraftImages } from '../src/image-input.js'

describe('composer image input boundary', () => {
  it('resolves relative paths, snapshots bytes, and delegates one batch admission to DSH', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dashi-image-'))
    try {
      await writeFile(join(cwd, 'shot.PNG'), Uint8Array.of(1, 2, 3))
      const images = await readDraftImages(cwd, ['shot.PNG'])
      expect(images[0]).toMatchObject({
        bytes: 3, mediaType: 'image/png', name: 'shot.PNG', path: join(cwd, 'shot.PNG'),
      })
      expect(encodeDraftImages(images)).toEqual([{
        data: 'AQID', mediaType: 'image/png', name: 'shot.PNG',
      }])
      const ref = {
        attachmentId: 'attachment-fixture', bytes: 3, height: 1,
        mediaType: 'image/png', name: 'shot.PNG', width: 1,
      }
      const saveImages = vi.fn(async () => [ref])
      await expect(admitDraftImages({ saveImages } as never, images)).resolves.toEqual([ref])
      expect(saveImages).toHaveBeenCalledOnce()
      expect(saveImages).toHaveBeenCalledWith([{
        data: Uint8Array.of(1, 2, 3), mediaType: 'image/png', name: 'shot.PNG',
      }])
    } finally {
      await rm(cwd, { force: true, recursive: true })
    }
  })

  it('refuses unknown extensions before reading or inventing a media type', async () => {
    await expect(readDraftImages('/work', ['shot.bmp']))
      .rejects.toThrow('accepted: .png, .jpg, .jpeg, .webp, .gif')
  })
})
