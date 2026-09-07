# Cold seeded sessions lose their title in the session list

## Body

- Queued (not yet posted): DSH Discussion: cold session list never shows a title for a seeded (forked) session whose inherited log exceeds coldBlankProbeMaxBytes; ApiSessionList refuses projection-cache rows for cold seeded sessions (packages/api/session-controller/src/list.ts:327-336) and probes the log only under the size bound (list.ts:164-205), so a durable session/title event is ignored in the picker until the session is opened (W-051). Suggest honoring a projection-cache title row, or probing the tail of the log for the latest title event.

Target: DSH Discussion (plain)
