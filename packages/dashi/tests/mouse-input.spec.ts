import { describe, expect, it } from 'vitest'
import { filterWheelInput } from '../src/mouse-input.js'

describe('wheel input filter', () => {
  it('maps exact SGR wheel reports to three transcript lines', () => {
    expect(filterWheelInput('\u001B[<64;12;7M')).toBe(3)
    expect(filterWheelInput('\u001B[<65;12;7M')).toBe(-3)
  })

  it('passes non-wheel mouse reports through', () => {
    expect(filterWheelInput('\u001B[<0;12;7M')).toBe('\u001B[<0;12;7M')
  })
})
