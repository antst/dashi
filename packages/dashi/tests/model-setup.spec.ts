import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationEntry } from '@deepseek-ai/dsh-authorization'
import { credentialKey, credentialRef } from '@deepseek-ai/dsh-credentials'
import Schema from '@deepseek-ai/schemastery'
import { describe, expect, it, vi } from 'vitest'
import { addModelProvider, credentialOptions, missingCredentialNotice, setModelCredential } from '../src/model-setup.js'
import type { QuestionItem } from '../src/state.js'

// Call-routing controls only; durable commits and completed requests are proved by the real-profile PTY cases.
function metadata() {
  const section = {
    ns: 'native-provider', revision: 7,
    schema: Schema.object({ apiKeyEnv: Schema.string().role('credential-ref') }).toJSON(),
    value: { apiKeyEnv: 'NATIVE_KEY' },
  }
  const set = vi.fn(async () => {})
  const ctx = {
    llm: {
      listConfigurableProviders: () => [{ provider: 'native', displayName: 'Native', settingsNs: section.ns, settingsPath: [] }],
      listProviders: () => [],
    },
    settings: { describe: () => [section], mutate: vi.fn(async () => {}) },
    credentials: { describe: vi.fn(async () => ({ configured: false, writable: true })), set },
    authorization: { list: vi.fn((): AuthorizationEntry[] => []) },
    logger: { warn: vi.fn() },
  }
  return { ctx: ctx as unknown as Context, raw: ctx, section, set }
}
const signal = (): AbortSignal => new AbortController().signal

describe('native model setup boundary', () => {
  it('reads the native credential-ref role, not a guessed field name', () => {
    const { ctx, section } = metadata()
    expect(credentialOptions(ctx)).toEqual([{ label: 'Set credential for Native', value: { kind: 'model-credential', provider: 'native' } }])
    section.schema = Schema.object({ apiKeyEnv: Schema.string().role('secret') }).toJSON()
    expect(credentialOptions(ctx)).toEqual([])
  })

  it('makes no readiness claim for an opaque route or configured reference', async () => {
    const { ctx, raw, section } = metadata()
    expect(await missingCredentialNotice(ctx, 'native')).toContain('NATIVE_KEY is not configured')
    raw.credentials.describe.mockResolvedValue({ configured: true, writable: true })
    expect(await missingCredentialNotice(ctx, 'native')).toBeUndefined()
    section.value.apiKeyEnv = ''
    expect(await missingCredentialNotice(ctx, 'native')).toBeUndefined()
    expect(raw.logger.warn).not.toHaveBeenCalled()
    expect(await missingCredentialNotice(ctx, 'custom-provider')).toBeUndefined()
    raw.settings.describe = () => []
    expect(await missingCredentialNotice(ctx, 'native')).toBeUndefined()
    expect(raw.logger.warn).not.toHaveBeenCalled()
  })

  it('logs failed startup reads without an on-screen error', async () => {
    const { ctx, raw } = metadata()
    raw.credentials.describe.mockRejectedValue(new Error('native metadata unavailable'))
    expect(await missingCredentialNotice(ctx, 'native')).toBeUndefined()
    expect(raw.logger.warn).toHaveBeenCalledOnce()
  })

  it('confirms a concurrently configured shared reference and preserves it when declined', async () => {
    const { ctx, raw, set } = metadata()
    raw.credentials.describe.mockResolvedValueOnce({ configured: false, writable: true }).mockResolvedValueOnce({ configured: true, writable: true })
    const questions: QuestionItem[] = []
    const result = await setModelCredential(ctx, 'native', async question => {
      questions.push(question)
      return { id: question.id, selected: question.secret ? [] : ['Cancel'], ...(question.secret ? { custom: 'not-a-real-key' } : {}) }
    }, signal())
    expect(questions[0]?.secret).toBe(true)
    expect(questions[1]?.question).toContain('Other profiles use the same shared credential store')
    expect(result.text).toBe('credential replacement cancelled')
    expect(set).not.toHaveBeenCalled()
  })

  it('does not write a reference that the profile changed while the question was open', async () => {
    const { ctx, section, set } = metadata()
    const result = await setModelCredential(ctx, 'native', async question => {
      section.value.apiKeyEnv = 'CHANGED_KEY'
      return { id: question.id, selected: [], custom: 'not-a-real-key' }
    }, signal())
    expect(result.kind).toBe('error')
    expect(set).not.toHaveBeenCalled()
  })

  it('returns only a storage receipt and never exposes a writer exception containing the answer', async () => {
    const { ctx, set } = metadata()
    const ask = async (question: QuestionItem) => ({ id: question.id, selected: [], custom: 'never-display-this' })
    expect((await setModelCredential(ctx, 'native', ask, signal())).text).toContain('send a new prompt')
    expect(set).toHaveBeenCalledWith(credentialRef('NATIVE_KEY'), 'never-display-this')
    set.mockRejectedValueOnce(Object.assign(new Error('never-display-this'), { code: 'EACCES' }))
    const failed = await setModelCredential(ctx, 'native', ask, signal())
    expect(failed).toEqual({ kind: 'error', text: 'credential write failed for Native (NATIVE_KEY) [EACCES]; storage outcome not confirmed; send a prompt to check, or set it again' })
    expect(set).toHaveBeenCalledTimes(2)
  })

  it('uses the directory address and revision, and reports cancelled credential entry after saving the provider', async () => {
    const { ctx, raw } = metadata()
    const result = await addModelProvider(ctx, async question => question.id === 'provider'
      ? { id: question.id, selected: ['Native (native)'] }
      : Promise.reject(Object.assign(new Error('cancelled'), { code: 'ASK_ABORTED' })), signal(), vi.fn())
    expect(raw.settings.mutate).toHaveBeenCalledWith('native-provider', [{ op: 'set', path: [], value: {} }], 7)
    expect(result).toEqual({ kind: 'success', text: 'provider Native added; sign-in cancelled' })
    expect(raw.credentials.set).not.toHaveBeenCalled()
  })

  it('reports cancelled flow selection without an attempted login or an uncertain-storage claim', async () => {
    const { ctx, raw, section } = metadata()
    section.value.apiKeyEnv = ''
    raw.authorization.list.mockReturnValue([{ key: credentialKey('native', 'login'), label: 'Native', methods: [{ id: 'key', label: 'Key' }], inFlight: false }])
    const login = vi.fn()
    const result = await addModelProvider(ctx, async question => question.id === 'provider'
      ? { id: question.id, selected: ['Native (native)'] }
      : Promise.reject(Object.assign(new Error('cancelled'), { code: 'ASK_ABORTED' })), signal(), login)
    expect(result).toEqual({ kind: 'success', text: 'provider Native added; sign-in cancelled' })
    expect(login).not.toHaveBeenCalled()
    expect(raw.credentials.set).not.toHaveBeenCalled()
  })

  it('preserves a native sign-in failure message and code without claiming storage absence', async () => {
    const { ctx, raw, section } = metadata()
    section.value.apiKeyEnv = ''
    raw.authorization.list.mockReturnValue([{ key: credentialKey('native', 'login'), label: 'Native', methods: [{ id: 'key', label: 'Key' }], inFlight: false }])
    const login = vi.fn(async () => { throw Object.assign(new Error('native login failure'), { code: 'EACCES' }) })
    const result = await addModelProvider(ctx, async question => ({ id: question.id, selected: [question.options[0]!.label] }), signal(), login)
    expect(result).toEqual({ kind: 'error', text: 'provider Native added; sign-in failed: native login failure [EACCES]; use /login or /model to try again' })
    expect(login).toHaveBeenCalledOnce()
  })
})
