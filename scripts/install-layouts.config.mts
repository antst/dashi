export default {
  test: {
    include: ['packages/dashi/tests/install-layouts.acceptance.ts'],
    testTimeout: 600_000,
    hookTimeout: 60_000,
  },
}
