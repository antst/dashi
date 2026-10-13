import { writeFileSync } from 'node:fs'

// Volume recording: maxConcurrentJobsPerOwner=20 and completionDelivery=quiet.
// These are registry operations with scripted outcomes, not bash processes.
// Real bash notices are recorded separately. No owner sessions are used.
export const name = 'dashi-live-activity-recording'
export const inject = ['commands', 'jobs']

export function apply(ctx) {
  const file = process.env.DASHI_ACTIVITY_RECORDING
  if (file === undefined) throw new Error('activity recording needs an output path')
  const frames = []
  const live = []
  let recorded = false
  const label = index => index % 11 === 0
    ? `cat <<'W139'\nHEREDOC_${index}\nsecond line\nW139`
    : index === 59 ? '\u001B[2J\u009B2Jprintf CONTROL_LABEL' : `printf JOB_OUTPUT_${index}`
  const settled = async (agent, index) => {
    ctx.jobs.start({
      owner: agent.id, kind: 'bash', label: label(index),
      run(job) {
        job.append(`JOB_OUTPUT_${index}\n`)
        return {
          done: Promise.resolve({ status: index % 7 === 0 ? 'failed' : 'completed', detail: `exit code: ${index % 7 === 0 ? 1 : 0}` }),
          cancel() {},
        }
      },
    })
    await new Promise(resolve => setImmediate(resolve))
  }
  const running = (agent, index) => {
    const done = Promise.withResolvers()
    ctx.jobs.start({
      owner: agent.id, kind: 'bash', label: label(index),
      run(job) {
        job.append(`JOB_OUTPUT_${index}\n`)
        return { done: done.promise, cancel() { done.resolve({ status: 'killed', detail: 'fixture cleanup' }) } }
      },
    })
    live.push(done)
  }
  const capture = agent => frames.push(ctx.jobs.list(agent.id))
  ctx.commands.register({
    name: 'dashi-record-activity', description: 'Record the private native activity fixture.',
    handler: async ({ agent, rawInput }) => {
      if (rawInput.trim() === 'seventy') {
        if (!recorded || frames.length !== 1) throw new Error('sixty-job stage required exactly once')
        for (const done of live.splice(0)) done.resolve({ status: 'completed', detail: 'exit code: 0' })
        await new Promise(resolve => setImmediate(resolve))
        for (let index = 60; index < 70; index++) running(agent, index)
        capture(agent)
      } else {
        if (recorded) throw new Error('activity fixture already recorded')
        recorded = true
        for (let index = 0; index < 40; index++) await settled(agent, index)
        for (let index = 40; index < 60; index++) running(agent, index)
        capture(agent)
      }
      writeFileSync(file, JSON.stringify({
        provenance: { dsh: '0.2.1-alpha.2', maxConcurrentJobsPerOwner: 20, completionDelivery: 'quiet', producer: 'live-activity-producer.mjs', sessionId: agent.id }, frames,
      }, null, 2) + '\n')
      return { kind: 'success', text: `W139_RECORDED_${frames.at(-1).length}` }
    },
  })
}
