import { describe, expect, it } from 'vitest'
import { countAudibleBells } from './terminal-output.js'

describe('terminal output bell counter', () => {
  it.each([
    ['OSC 8 with BEL', '\u001B]8;;https://example.test\u0007link\u001B]8;;\u0007'],
    ['OSC 8 with ST', '\u001B]8;;https://example.test\u001B\\link\u001B]8;;\u001B\\'],
    ['OSC 52 with BEL', '\u001B]52;c;cGF5bG9hZA==\u0007'],
    ['OSC 52 with ST', '\u001B]52;c;cGF5bG9hZA==\u001B\\'],
  ])('excludes %s terminators', (_label, sequence) => {
    expect(countAudibleBells(`${sequence}\u0007`)).toBe(1)
  })
})
