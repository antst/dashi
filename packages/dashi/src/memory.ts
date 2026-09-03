import { resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-instructions'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type { Overlay } from './state.js'
export function memoryOverlay(agent: Agent): Overlay {
  const cwd = agent.session.header.cwd ?? process.cwd()
  let root = cwd
  const active = new Map<string, { path: string; scope: string }>()
  for (const seq of agent.session.surface.nodes) {
    const event = agent.session.eventAt(seq)
    if (event?.type !== 'user/message' || event.data.source.kind !== 'agent-instructions') continue
    const source = event.data.source, identity = source.baselineIdentity === undefined
      ? undefined : JSON.parse(source.baselineIdentity) as { projectRoot?: unknown }
    if (typeof identity?.projectRoot === 'string') root = resolve(cwd, identity.projectRoot)
    for (const change of source.changes) {
      if (change.action === 'remove') active.delete(change.scope)
      else active.set(change.scope, { path: change.path, scope: change.scope.split('\0')[0] ?? change.scope })
    }
  }
  return { cursor: 0, kind: 'list', options: [...active.values()].map(item => {
    const homePath = /^(?:~\/\.dsh|\$DSH_HOME)\/(.*)$/u.exec(item.path)?.[1]
    return { detail: `scope ${item.scope}`, label: item.path,
      value: { kind: 'open-file', path: resolve(homePath === undefined ? root : resolveDshHome(), homePath ?? item.path) } }
  }), purpose: 'memory', title: 'Memory' }
}
