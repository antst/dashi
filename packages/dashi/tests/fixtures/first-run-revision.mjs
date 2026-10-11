export const name = 'first-run-native-revision-control'
export const inject = ['settings']

// A concurrent native profile writer, triggered by the peer's ordinary native step.
export function apply(ctx) {
  ctx.on('agent/pre-step', async (_request, next) => {
    const section = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === 'llm-pi-ai')
    if (!section) throw new Error('revision control has no native settings section')
    await ctx.settings.mutate(section.ns, [{ op: 'set', path: ['providers', 'deepseek'], value: { displayName: 'Concurrent native update' } }], section.revision)
    return next()
  }, { global: true })
}
