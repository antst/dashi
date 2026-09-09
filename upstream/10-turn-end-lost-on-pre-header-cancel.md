# turn/end is lost when a pre-header LLM request is cancelled

## Body

- Queued (not yet posted), HIGH: DSH Discussion (Bug): in @deepseek-ai/dsh-agent-loop 0.1.2-rc.1 a turn cancelled while the LLM fetch is still awaiting response headers (the ordinary "cancel during time-to-first-token" case) never gets its turn/end. ReactLoopAgent.turn() logs `{kind:'aborted', reason: signal.reason}` (packages/core/agent-loop/src/agent.ts:313, appended at :328); signal.reason is the caller's cancel-cause object, which every fetch-based adapter hands to fetch via AbortSignal.any (packages/llm/llm-deepseek/src/adapter.ts:473-476,643-648); Node/undici installs a non-enumerable `stack` accessor on that object when a pre-header fetch is aborted, Session.append rejects it as non-serializable (dsh-session lib/index.js:1409 via dsh-util-values enumerableStringKeys), the append throws inside the finally and is rerouted to agent/error, and the log keeps step/end as its last event with the turn open forever; mid-body aborts are unaffected. Adapter and loop otherwise honor the abort (adapter settles in 3 ms). Reproduced 2026-09-06 on rc.1 with Node 25.9 against a local endpoint that accepts the socket and never sends headers; invisible to DSH's own tests because the replay provider never calls fetch. Suggested fix: log a detached snapshot of the cause (captured in cancel()) or rebuild the closed AgentCancelCause union at :313, never the object handed to platform code. Consumers folding turn/start..turn/end (dashi, sessionQuery) show the turn running indefinitely. Found via sessionbus lane cells 6 and 8.

Target: DSH Discussion (Bug)

Priority: high
