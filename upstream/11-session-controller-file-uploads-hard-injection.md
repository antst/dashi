# Session controller cannot activate without the web-only fileUploads service

## Body

`@deepseek-ai/dsh-api-session-controller` cannot be mounted in a non-web
profile starting with DSH 0.1.5-rc.2. It hard-injects `fileUploads`, but the
only production provider is the web client's file-upload plugin, which itself
requires the web `connection` service.

### Reproduction

1. Install a uniform `@deepseek-ai/*` 0.1.5-rc.2 graph.
2. Create a profile containing `dsh-base` and
   `@deepseek-ai/dsh-api-session-controller`, without the web client or
   `@deepseek-ai/dsh-client-file-upload`.
3. Boot that profile.

The session-controller entry remains pending because `fileUploads` is absent,
and the profile reports that entries did not activate. This happens during
construction, before any prompt or attachment is submitted. The same
composition failure is present in 0.1.6-alpha.2.

The hard dependency is visible in
`packages/api/session-controller/src/index.ts:88-99`. Construction immediately
calls `ctx.fileUploads.registerAgentResolver` at `index.ts:120-129`.
`commands.ts:349-365` also resolves upload receipts and calls `bindPrompt` for
every prompt, including an empty receipt list, while queue removal calls
`retirePrompt` at `commands.ts:473-478`.

The only production implementation is
`packages/client/file-upload/src/index.ts:57-83`; its static inject list
includes `connection`. DSH's own session-controller tests demonstrate that the
controller otherwise needs only four operations by providing no-op
`registerAgentResolver`, `resolve`, `bindPrompt`, and `retirePrompt` methods in
`packages/api/session-controller/tests/test-remote.ts:269-275`.

Expected: mounting the session controller should not require a web transport.
Either make `fileUploads` optional with neutral behavior when there are no
receipts, or ship the service contract with a non-web default provider. A real
receipt without an upload provider should still fail with the existing
`session/attachment-invalid` / `FILE_NOT_STAGED` error.

Target: DSH Discussion (Bug)
