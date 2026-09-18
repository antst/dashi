import type { Context } from '@deepseek-ai/cordis'

export const name = 'file-uploads-none'

export function apply(ctx: Context): void {
  ctx.provide('fileUploads', {
    registerAgentResolver: () => () => {},
    resolve: () => undefined,
    bindPrompt: () => ({ commit: () => {}, [Symbol.dispose]: () => {} }),
    retirePrompt: () => {},
  } as never)
}
