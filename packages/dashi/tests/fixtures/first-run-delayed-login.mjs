import { credentialKey } from '@deepseek-ai/dsh-credentials'

export const name = 'first-run-delayed-login'
export const inject = ['authorization']

// A native notice-only flow completed by the test transport, not a fake credential service.
export function apply(ctx) {
  ctx.authorization.registerFlow({
    key: credentialKey('w127', 'delayed-login'), label: 'W127 delayed login',
    methods: [{ id: 'key', label: 'Test key' }],
    async run(session) {
      session.notify({ message: 'W127_OLD_LOGIN_PENDING' })
      const response = await fetch(`${process.env.DEEPSEEK_BASE_URL}/w127/login-key`, { signal: session.signal })
      await session.commit({ kind: 'api-key', key: await response.text() })
    },
  })
}
