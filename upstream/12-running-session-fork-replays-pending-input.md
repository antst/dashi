# Forking a running session replays its pending prompt in the child

## Body

In DSH 0.1.5-rc.2, forking a running source session at its latest completed
turn does not produce a child containing only that completed history. The
child also inherits the inbox insertion for the source's in-progress prompt
and begins answering that prompt.

### Reproduction

1. Create a session and complete one turn.
2. Submit a second prompt to a model backend that remains running long enough
   to invoke another SessionController operation.
3. Call `sessionController.fork` with `atSeq` equal to the first turn's
   `turn/end` sequence.
4. Inspect the child session before submitting any child-specific prompt.

Actual: the child contains the second prompt's `agent/inbox/spliced` insertion
and starts a turn for it. The caller cannot clear the inherited item before it
runs because the child id is returned only after agent creation and
publication. A caller intending to ask an isolated side question therefore
gets an unwanted answer to the source's open prompt first.

The fork code selects the completed boundary at
`packages/api/session-controller/src/commands.ts:225-242`, then advances its
cut from `turn/end + 1` until the next `turn/start` at `commands.ts:243-245`.
That range includes the durable inbox insertion immediately before the open
turn. The whole prefix is passed as the child seed at `commands.ts:257-275`.
Agent-loop reconstructs inbox state from that seed while creating the child at
`packages/core/agent-loop/src/index.ts:764-800`, and publishes the prepared
agent before returning at `index.ts:824-828`.

Expected: SessionController should support an exact completed-boundary fork
that excludes later inbox splices. This could be an explicit fork option, or
the running-source case could stop the seed at the selected `turn/end` rather
than advancing across pre-turn inbox events.

Target: DSH Discussion (Bug)
