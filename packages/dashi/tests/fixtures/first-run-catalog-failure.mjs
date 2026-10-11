export const name = 'first-run-catalog-failure'
export const inject = ['credentials', 'sessionController']

// Read-side fault only: the credential commit and command lifecycle remain native.
export function apply(ctx) {
  const catalog = ctx.sessionController.modelCatalog.bind(ctx.sessionController)
  ctx.sessionController.modelCatalog = async () => {
    if ((await ctx.credentials.describe('DEEPSEEK_API_KEY')).configured) throw new Error('W127_CATALOG_READ_FAILED')
    return catalog()
  }
}
