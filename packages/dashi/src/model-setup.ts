import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type { SettingsDescriptor } from '@deepseek-ai/dsh-settings'
import Schema from '@deepseek-ai/schemastery'
import type { OverlayOption, QuestionAnswer, QuestionItem } from './state.js'

export type SetupQuestion = (question: QuestionItem) => Promise<QuestionAnswer>

function at(value: unknown, key: string): unknown {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
}

function descriptor(ctx: Context, route: LlmConfigurableProvider): SettingsDescriptor {
  const found = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === route.settingsNs)
  if (found === undefined) throw new Error(`Provider ${route.displayName} has no editable settings section`)
  return found
}

/** Read only DSH's schema role and live reference; never default or validate configuration here. */
function reference(section: SettingsDescriptor, path: readonly string[]): CredentialRef | undefined {
  let schema: Schema | undefined = new Schema(section.schema as Partial<Schema>)
  let value: unknown = section.value
  for (const key of path) {
    schema = schema?.type === 'dict' ? schema.inner : schema?.dict?.[key]
    value = at(value, key)
  }
  const refs = Object.entries(schema?.dict ?? {}).flatMap(([field, spec]) => {
    const name = at(value, field)
    return spec.meta.role === 'credential-ref' && typeof name === 'string' && name !== '' ? [credentialRef(name)] : []
  })
  return refs.length === 1 ? refs[0] : undefined
}

function routeOf(ctx: Context, provider: string): LlmConfigurableProvider {
  const route = ctx.llm.listConfigurableProviders().find(item => item.provider === provider)
  if (route === undefined) throw new Error(`No configurable provider ${provider}`)
  return route
}

export function credentialOptions(ctx: Context): readonly OverlayOption[] {
  const sections = ctx.settings.describe({ redactSecrets: true })
  return ctx.llm.listConfigurableProviders().flatMap(route => {
    const section = sections.find(item => item.ns === route.settingsNs)
    if (section === undefined || reference(section, route.settingsPath) === undefined) return []
    return [{ label: `Set credential for ${route.displayName}`, value: { kind: 'model-credential' as const, provider: route.provider } }]
  })
}

export function credentialGuidance(provider: string): string {
  return `${provider}: use /login to sign in, or /model → Set credential to enter a provider key.`
}

/** Called only after the shell's first frame; unreadable/opaque routes make no readiness claim. */
export async function missingCredentialNotice(ctx: Context, provider: string | undefined): Promise<string | undefined> {
  try {
    // A fresh root has no request/selection projection yet. The native catalog owns its default.
    provider ??= (await ctx.sessionController.modelCatalog()).default.provider
    const route = ctx.llm.listConfigurableProviders().find(item => item.provider === provider)
    if (route === undefined) return undefined
    const section = ctx.settings.describe({ redactSecrets: true }).find(item => item.ns === route.settingsNs)
    if (section === undefined) return undefined
    const ref = reference(section, route.settingsPath)
    if (ref === undefined || (await ctx.credentials.describe(ref)).configured) return undefined
    return `${route.displayName}: credential ${ref} is not configured. ${credentialGuidance(provider)}`
  } catch (error) {
    ctx.logger.warn('dashi: unable to read startup credential metadata', error)
    return undefined
  }
}

export async function setModelCredential(
  ctx: Context, provider: string, ask: SetupQuestion, signal: AbortSignal,
): Promise<CommandResult> {
  signal.throwIfAborted()
  const route = routeOf(ctx, provider)
  const ref = reference(descriptor(ctx, route), route.settingsPath)
  if (ref === undefined) return { kind: 'error', text: `${route.displayName} has no single key setting dashi can fill; use /login or /config` }
  const confirm = async (): Promise<boolean> => (await ask({
    allowCustom: false, header: 'Replace credential', id: 'replace', multiSelect: false,
    options: [{ label: 'Replace' }, { label: 'Cancel' }],
    question: `Replace ${ref}? Other profiles use the same shared credential store.`,
  })).selected[0] === 'Replace'
  const before = await ctx.credentials.describe(ref)
  if (!before.writable) return { kind: 'error', text: `${ref} is read-only in this DSH launch; change it at its source` }
  if (before.configured && !await confirm()) return { kind: 'success', text: 'credential replacement cancelled' }
  const answer = await ask({
    header: 'Set credential', id: 'credential', multiSelect: false, options: [], secret: true,
    question: `Enter the credential for ${route.displayName} (${ref}).`,
  })
  signal.throwIfAborted()
  if (reference(descriptor(ctx, route), route.settingsPath) !== ref) {
    return { kind: 'error', text: `${route.displayName}'s key setting changed; no key saved` }
  }
  if (!before.configured && (await ctx.credentials.describe(ref)).configured && !await confirm()) {
    return { kind: 'success', text: 'credential replacement cancelled' }
  }
  signal.throwIfAborted()
  try {
    await ctx.credentials.set(ref, answer.custom ?? '')
    return { kind: 'success', text: `credential stored for ${route.displayName} (${ref}); send a new prompt to use it` }
  } catch (error) {
    // Never let a writer's exception echo a secret into command/done or the terminal.
    const code = at(error, 'code')
    return { kind: 'error', text: `credential write failed for ${route.displayName} (${ref})${typeof code === 'string' ? ` [${code}]` : ''}; storage outcome not confirmed; send a prompt to check, or set it again` }
  }
}

export async function addModelProvider(
  ctx: Context, ask: SetupQuestion, signal: AbortSignal,
  login: (key: string, method: string) => Promise<CommandResult>,
): Promise<CommandResult> {
  signal.throwIfAborted()
  const active = new Set(ctx.llm.listProviders().map(item => item.id))
  const dormant = ctx.llm.listConfigurableProviders().filter(item => !active.has(item.provider) && item.declared !== true)
  if (dormant.length === 0) return { kind: 'success', text: 'all available providers are already added' }
  const described = ctx.settings.describe({ redactSecrets: true })
  const sections = dormant.map(route => described.find(section => section.ns === route.settingsNs))
  const labels = dormant.map(route => route.displayName === route.provider ? route.displayName : `${route.displayName} (${route.provider})`)
  const answer = await ask({
    allowCustom: false, header: 'Add provider', id: 'provider', multiSelect: false,
    options: labels.map(label => ({ label })), question: 'Choose a provider DSH already knows.',
  })
  const index = labels.indexOf(answer.selected[0] ?? '')
  const route = dormant[index]
  const section = sections[index]
  if (route === undefined || section === undefined) return { kind: 'error', text: 'no provider selected' }
  signal.throwIfAborted()
  await ctx.settings.mutate(route.settingsNs, [{ op: 'set', path: route.settingsPath, value: {} }], section.revision)
  const saved = `provider ${route.displayName} added`
  try {
    signal.throwIfAborted()
    if (reference(descriptor(ctx, route), route.settingsPath) !== undefined) {
      const result = await setModelCredential(ctx, route.provider, ask, signal)
      return { kind: result.kind, text: `${saved}; ${result.text}` }
    }
    // The native directory exposes no provider-to-flow association. Do not invent one.
    const choices = ctx.authorization.list().flatMap(flow => flow.methods.map(method => ({
      key: String(flow.key), method: method.id, label: `${flow.label} · ${flow.key} · ${method.label}`,
    })))
    if (choices.length === 0) return { kind: 'success', text: `${saved}; no sign-in options are available; use /config for provider settings` }
    const selected = await ask({
      allowCustom: false, header: 'Login', id: 'login', multiSelect: false,
      detail: `${saved}. Choose how to sign in to this provider.`,
      options: choices.map(({ label }) => ({ label })), question: 'Choose a sign-in option.',
    })
    const choice = choices.find(item => item.label === selected.selected[0])
    if (choice === undefined) return { kind: 'success', text: `${saved}; sign-in cancelled` }
    const result = await login(choice.key, choice.method)
    return { kind: result.kind, text: `${saved}; ${result.text}` }
  } catch (error) {
    const code = at(error, 'code')
    if (signal.aborted || code === 'ASK_ABORTED') return { kind: 'success', text: `${saved}; sign-in cancelled` }
    return { kind: 'error', text: `${saved}; sign-in failed: ${error instanceof Error ? error.message : String(error)}${typeof code === 'string' ? ` [${code}]` : ''}; use /login or /model to try again` }
  }
}
