import { describe, expect, it } from 'vitest'
import { detectAtTrigger } from '../src/at-trigger.js'

describe('terminal @ trigger', () => {
  it('returns the active shared-grammar token and its exact span', () => {
    expect(detectAtTrigger('read @"src/my fi', 16)).toEqual({
      end: 16, query: 'src/my fi', quoted: true, start: 5,
    })
    expect(detectAtTrigger('mail@example.com', 16)).toBeUndefined()
  })
})
