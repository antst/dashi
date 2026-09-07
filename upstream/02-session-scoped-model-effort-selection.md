# Session-scoped model and effort selection

## Body

- Queued (not yet posted): DSH Discussion (Ideas): session-scoped model/effort selection. rc.1 selectModel always calls agentDefaultModel.saveSelection (packages/api/session-controller/src/commands.ts:119-145) and neither SessionCreateRequest, resolveAgent, nor AgentPreset carries a model or effort, so a launch flag like `--model` cannot avoid moving the deployment default (W-025). Release to the lane with the install-hazards report.

Target: DSH Discussion (Ideas)
