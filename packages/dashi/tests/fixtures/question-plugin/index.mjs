import { appendFileSync } from 'node:fs'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dashi-question-fixture'
export const inject = ['agents', 'commands', 'skills', 'tools', 'tuiRoot', 'userQuestions']

export function apply(ctx) {
  let stdoutBroken = false
  ctx.on('session/event', (_session, event) => {
    if (process.env.DSH_DASHI_BREAK_STDOUT !== '1' || stdoutBroken
      || event.type !== 'assistant/chunk' || !JSON.stringify(event.data).includes('Inspecting')) return
    stdoutBroken = true
    setImmediate(() => {
      process.stdout.destroy(Object.assign(new Error('fixture EPIPE: broken stdout'), { code: 'EPIPE' }))
    })
  }, { global: true })
  ctx.on('agent/pre-step', async (_request, next) => {
    const file = process.env.DSH_DASHI_PRE_STEP_EVENTS
    if (file === undefined) return next()
    const decision = await next()
    if (decision.kind !== 'reject') {
      appendFileSync(file, `${JSON.stringify(decision.messages.map(message => ({
        content: message.content,
        source: message.source,
      })))}\n`)
    }
    return decision
  }, { global: true })
  ctx.commands.register({
    name: 'dashi-slow-fixture',
    description: 'Wait before completing a fixture command.',
    handler: async () => {
      await new Promise(resolve => { setTimeout(resolve, 750) })
      return { kind: 'success', text: 'Slow fixture complete.' }
    },
  })
  ctx.skills.register({
    name: 'dashi-fixture-skill',
    description: 'Fixture user-invocable skill',
    source: 'runtime',
    content: 'Follow the recorded fixture response.',
  })
  ctx.on('tui/root-changed', (previous, current) => {
    const file = process.env.DSH_DASHI_ROOT_EVENTS
    if (file === undefined) return
    const accessor = ctx.tuiRoot.current()
    const retained = previous === undefined ? undefined : ctx.agents.get(previous.id)
    appendFileSync(file, `${JSON.stringify({
      event: 'tui/root-changed',
      previous: previous === undefined ? null : String(previous.id),
      current: current === undefined ? null : String(current.id),
      accessor: accessor === undefined ? null : String(accessor.id),
      ...(previous === undefined ? {} : {
        previousRegistered: retained === previous,
        previousStatus: previous.status,
      }),
    })}\n`)
  })
  ctx.tools.register(defineTool({
    name: 'dashi_question_fixture',
    description: 'Ask a recorded batch of terminal acceptance questions.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (_args, exec) => JSON.stringify(await ctx.userQuestions.ask({
      agent: exec.agent,
      signal: exec.signal,
      questions: [
        {
          id: 'manager',
          header: 'Package manager',
          question: 'Which package manager?',
          options: [{ label: 'pnpm' }, { label: 'npm' }],
        },
        { id: 'reason', header: 'Reason', question: 'Why this choice?' },
      ],
    })),
    presentCall: () => ({ card: 'generic', title: 'Ask terminal fixture questions' }),
  }))
  ctx.tools.register(defineTool({
    name: 'dashi_presenter_failure',
    description: 'Throw from both presenter hooks for terminal fault coverage.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async () => {
      await new Promise(resolve => { setTimeout(resolve, 300) })
      return 'DASHI_PRESENTER_RESULT'
    },
    presentCall: () => { throw new Error('fixture presentCall failure') },
    presentResult: () => { throw new Error('fixture presentResult failure') },
  }))
}
