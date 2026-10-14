import { appendFileSync, existsSync } from 'node:fs'
import { setTimeout as delay } from 'node:timers/promises'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'dashi-question-fixture'
export const inject = ['agentPresets', 'agents', 'authorization', 'commands', 'credentials', 'jobs', 'schedule', 'sessionController', 'settings', 'skills', 'subagentModelSelection', 'tools', 'tuiRoot', 'userQuestions']

export function apply(ctx) {
  const workingGate = process.env.DSH_WORKING_PROOF
  if (workingGate !== undefined) ctx.tools.register(defineTool({
    name: 'dashi_working_hold',
    description: 'Hold one private working-row proof call until its observed-state gate.',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    execute: async (_args, exec) => {
      const gate = exec.agent.session.header.parentSession === undefined ? workingGate
        : process.env.DSH_WORKING_CHILD_GATE ?? workingGate
      while (!existsSync(gate)) await delay(20, undefined, { signal: exec.signal })
      return 'W143_NATIVE_TOOL_RESULT'
    },
    presentCall: () => ({ card: 'generic', title: 'Private working-row hold' }),
  }))
  ctx.commands.register({
    name: 'dashi-schedule-proof',
    description: 'Read native schedule history or create a one-shot deletion barrier.',
    handler: async ({ agent, rawInput }) => {
      if (rawInput.trim() === 'barrier') {
        return { kind: 'success', text: JSON.stringify(await ctx.schedule.create(agent.id, {
          after_seconds: 60, title: 'W114 deletion barrier', prompt: 'W114 deletion barrier',
        })) }
      }
      return { kind: 'success', text: JSON.stringify({
        history: await ctx.schedule.history({ sessionId: agent.id, id: rawInput.trim(), limit: 10 }),
        catalog: await ctx.schedule.catalog(),
      }) }
    },
  })
  let unownedJob
  ctx.commands.register({
    name: 'dashi-unowned-job-proof',
    description: 'Expose one native unowned job and inspect its consuming result after human reads.',
    handler: ({ agent, rawInput }) => {
      if (rawInput.trim() === 'consume') {
        if (unownedJob === undefined) throw new Error('unowned job was not started')
        return { kind: 'success', text: JSON.stringify(ctx.jobs.read(unownedJob, agent.id)) }
      }
      if (unownedJob !== undefined) throw new Error('unowned job already started')
      unownedJob = ctx.jobs.start({
        kind: 'bash', label: 'W114 unowned output',
        run(job) {
          job.append('W114_OUTPUT_STILL_UNCONSUMED')
          return { done: Promise.resolve({ status: 'completed', result: 'W114_RESULT_STILL_UNCONSUMED' }), cancel() {} }
        },
      })
      return { kind: 'success', text: `Unowned job ${unownedJob}` }
    },
  })
  ctx.commands.register({
    name: 'dashi-preset-proof',
    description: 'Inspect real alpha.2 scoped delegation and its native route policy.',
    handler: async ({ agent, rawInput }) => {
      if (rawInput.trim() === 'enable') {
        const descriptor = ctx.settings.describe().find(entry => entry.ns.endsWith('subagent-model-selection-settings'))
        if (descriptor === undefined) throw new Error('native model-selection settings form unavailable')
        await ctx.settings.update(descriptor.ns, {
          enabled: true, allowedModels: [{ provider: 'deepseek-official', model: 'deepseek-flash' }],
        }, descriptor.revision)
      }
      const scoped = ctx.tools.get('subagent', agent)
      const host = ctx.tools.get('subagent')
      if (scoped === undefined || host === undefined) throw new Error('native subagent definitions unavailable')
      return { kind: 'success', text: JSON.stringify({
        preset: ctx.agentPresets.composedPreset(agent.ctx),
        scopedShadowsHost: scoped !== host,
        settings: ctx.subagentModelSelection.current(),
        selectionParameters: ['provider', 'model', 'reasoning_effort'].filter(name => Object.hasOwn(scoped.parameters.properties, name)),
        listModels: ctx.tools.get('list_subagent_models', agent) !== undefined,
        policy: agent.session.snapshotEvents().filter(event => event.type === 'subagent/model-selection-policy')
          .map(event => event.data),
        rows: ctx.agentPresets.inspectCompositions(agent.ctx).flatMap(revision => revision.modules.map(row => row.moduleName)),
      }) }
    },
  })
  const fixtureCredential = credentialKey('dashi-fixture', 'account')
  ctx.effect(() => ctx.authorization.registerFlow({
    key: fixtureCredential,
    label: 'Dashi fixture account',
    methods: [{ id: 'fixture', label: 'Fixture sign-in' }],
    async run(session) {
      session.notify({ message: 'Continue with the fixture sign-in.', url: 'https://example.invalid/login', code: 'DASHI-FIXTURE' })
      const secret = await session.prompt({ kind: 'secret', message: 'Enter the fixture secret.' })
      if (secret.startsWith('[paste #')) throw new Error('fixture received an unexpanded paste marker')
      const account = await session.prompt({ kind: 'select', message: 'Choose the fixture account.', options: [{ id: 'primary', label: 'Primary' }] })
      await ctx.credentials.modifyRecord(fixtureCredential, async () => ({ kind: 'grant', payload: { account, secret } }))
    },
  }))
  let stdoutBroken = false
  ctx.on('agent/assistant-stream', ({ frame }) => {
    if (process.env.DSH_DASHI_BREAK_STDOUT !== '1' || stdoutBroken
      || !JSON.stringify(frame).includes('Inspecting')) return
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
  ctx.commands.register({
    name: 'dashi-file-fixture',
    description: 'Submit one unstaged file receipt through the Session Controller.',
    handler: async ({ agent, signal }) => {
      try {
        await ctx.sessionController.prompt({
          requestId: 'dashi-file-fixture', sessionId: agent.id, mode: 'queue',
          content: [{ type: 'file', receiptId: 'not-staged' }],
        }, signal)
        return { kind: 'success', text: 'unexpected file admission' }
      } catch (error) {
        return { kind: 'error', text: `${error.code}: ${error.details?.reason}` }
      }
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
