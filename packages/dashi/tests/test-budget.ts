const ceilingMultiplier = process.env.CI === 'true' ? 3 : 1

export function testCeiling(strict: number): number {
  return strict * ceilingMultiplier
}
