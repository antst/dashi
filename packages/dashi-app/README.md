# @antst/dashi-app

Installable DeepSeek Harness (DSH) profile bundle for dashi, a terminal UI
for DSH.

Install DSH 0.1.5-rc.2 or newer and start dashi:

```sh
pnpm install @deepseek-ai/dsh@0.1.5-rc.2
dsh plugin --profile dashi add @antst/dashi-app
dsh --profile dashi
```

The profile bundle includes roller for file rewind.

Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease.
When upgrading DSH, remove `node_modules` and the lockfile before installing so
pnpm cannot retain stale peer-only DSH packages.
A DSH profile must use one uniform DSH version. The minimum supported version
is `0.1.5-rc.2`; CI tests `0.1.5-rc.2`, `0.1.6-alpha.1`, and
`0.1.6-alpha.2` with exact, reproducible graphs.

Status: pre-release alpha. Interfaces and behavior may change between alpha versions.

Full documentation, source, and issue tracker:
https://forgejo.antst.net/ai/dashi
