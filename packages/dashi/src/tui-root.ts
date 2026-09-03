import { Service, type Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'

export interface TuiRootContext {
  current(): Agent | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiRoot: TuiRootContext
  }

  interface Events {
    'tui/root-changed'(previous: Agent | undefined, current: Agent | undefined): void
  }
}

export class TuiRoot extends Service implements TuiRootContext {
  private agent: Agent | undefined

  constructor(ctx: Context) {
    super(ctx, 'tuiRoot')
    ctx.on('agent/disposed', ({ agent }) => { this.clear(agent) }, { global: true })
  }

  current(): Agent | undefined {
    return this.agent
  }

  bind(agent: Agent): void {
    if (this.agent === agent) return
    const previous = this.agent
    this.agent = agent
    this.ctx.emit('tui/root-changed', previous, agent)
  }

  clear(expected?: Agent): void {
    if (this.agent === undefined || (expected !== undefined && this.agent !== expected)) return
    const previous = this.agent
    this.agent = undefined
    this.ctx.emit('tui/root-changed', previous, undefined)
  }
}
