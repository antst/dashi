# W-139 private recordings

All logs restore through DSH's current strict codec. No owner's session is
included. The only mechanical edits replace the builder's worktree and private
home prefixes with `/recorded/dashi-workspace` and `/recorded/dashi-private-home`;
ids, times, sequence numbers, outcomes and content structure remain unchanged.
One replacement artefact is the denied job's summary: it has 112 characters
instead of DSH's 120-character cut, because its replaced prefix is eight
characters shorter. The recording was not regenerated after that replacement.
The capture driver is not committed. The raw original no longer exists, so
the replacements of the builder's worktree and private-home path prefixes
cannot be compared against it.

The volume recording uses the committed `live-activity-recording.patch.yml`
beside a replay-model patch in a private DSH home, from the repository root.
It sets **both** `jobs.maxConcurrentJobsPerOwner: 20` (stock: 10) and
`tool-jobs.completionDelivery: quiet`. The producer writes frames to the
`DASHI_ACTIVITY_RECORDING` path. Run `/dashi-record-activity`, send one replay
prompt to claim its forty notices, then run `/dashi-record-activity seventy`.
The two frames contain 60 jobs (40 settled, 20 running) and 70 jobs (60 settled,
10 running). These are native registry jobs with scripted outcomes for volume,
not sixty shell processes. In particular their `failed, exit code: 1` is not a
bash outcome; tests of bash notice presentation use the separate log below.

`live-activity-bash-notices.jsonl` was captured from the real shipped DSH
0.2.1-alpha.2 profile, private home, deterministic replay adapter and the same
two settings. Four native `bash` calls supplied the required description and
`run_in_background: true`: `printf W139_NATIVE_EXIT_ZERO`, `exit 3`, `sleep 300`,
and a `printf denied > …/W139_DENIED_MARKER` targeting an owned directory outside
the session workspace and `/tmp`. Only the last marker path was outside the
write sandbox; it remained absent. The observed sleep job id was killed once
through `/tasks kill bash-3`. A subsequent new replay prompt claimed its notice.
The log retains the native calls/results, inbox splices, claims, kill command
and receipts. It demonstrates exit 0, exit 3, a user kill, and a real sandbox
denial with nested bracketed detail, not constructed notice messages.
