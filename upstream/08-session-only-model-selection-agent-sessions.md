# Session-only model selection for Agent Sessions lanes

## Body

- Queued (not yet posted): DSH Discussion: session-only model selection, restated for the Agent Sessions lane case: SessionSelectModelRequest carries sessionId but selectModel always calls agentDefaultModel.saveSelection (packages/api/session-controller/src/commands.ts:119-145), so a headless lane opened with a model moves the deployment default for every later session in that DSH home (D-039; duplicates the W-025 entry's ask with the second motivating case).

Target: DSH Discussion (plain)
