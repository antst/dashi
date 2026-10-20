export default {
  test: {
    include: ['packages/dashi/tests/install-layouts.acceptance.ts'],
    testTimeout: 900_000,
    hookTimeout: 60_000,
  },
}
