import { writeFileSync } from 'node:fs'

export const name = 'dashi-held-flush-fixture'
export const inject = ['commands', 'sessions']

export function apply(ctx) {
  const file = process.env.DSH_DASHI_HELD_FLUSH_RECEIPT
  if (file === undefined) throw new Error('held-flush fixture needs a receipt path')
  let armedSession
  let flushEnteredAt
  let signalledAt
  let heldAt
  let held = false
  let maintenanceError
  const signalReceived = Promise.withResolvers()

  process.once('SIGTERM', () => {
    signalledAt = performance.now()
    signalReceived.resolve()
  })
  process.once('exit', code => {
    writeFileSync(file, JSON.stringify({
      pid: process.pid, code, signalledAt, exitedAt: performance.now(),
      armedSession, flushEnteredAt, heldAt, held, maintenanceError,
      stack: new Error('native exit receipt').stack,
    }, null, 2) + '\n')
  })

  ctx.on('session/flush', async session => {
    if (session.id !== armedSession) return
    if (flushEnteredAt === undefined) {
      flushEnteredAt = performance.now()
      process.stdout.write('W137_FLUSH_ENTERED\n')
    }
    await signalReceived.promise
    if (!held) {
      heldAt = performance.now()
      process.stdout.write('W137_FLUSH_HELD\n')
    }
    held = true
    return new Promise(() => {})
  }, { global: true })

  ctx.commands.register({
    name: 'dashi-arm-held-flush',
    description: 'Arm the native shutdown durability barrier for this fixture root.',
    handler: ({ agent }) => {
      if (armedSession !== undefined) throw new Error('held-flush fixture is already armed')
      armedSession = agent.session.id
      void agent.runMaintenance(() => ctx.sessions.flush(agent.session)).catch(error => {
        maintenanceError = error.message
        ctx.logger.error(error)
      })
      return { kind: 'success', text: 'W137_FLUSH_ARMED' }
    },
  })
}
