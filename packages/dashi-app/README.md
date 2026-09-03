# @antst/dashi-app

Installable DeepSeek Harness (DSH) profile bundle for dashi, a terminal UI
for DSH.

Install the exact validated DSH release and start dashi:

```sh
pnpm install @deepseek-ai/dsh@0.1.2-rc.1
dsh plugin --profile dashi add @antst/dashi-app
dsh --profile dashi
```

The profile bundle includes roller for file rewind.

Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease.
When upgrading DSH, remove `node_modules` and the lockfile before installing so
pnpm cannot retain stale peer-only DSH packages.
dashi validates each DSH release before adopting it, and its packages pin DSH
dependencies exactly.

Status: pre-release alpha. Interfaces and behavior may change between
alpha versions; the validated DSH version is `0.1.2-rc.1`.

Full documentation, source, and issue tracker:
https://forgejo.antst.net/ai/dashi
