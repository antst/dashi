# @antst/dashi-launcher

The `dashi` command starts the dashi terminal UI through an installed DeepSeek
Harness profile.

Install DSH 0.1.5-rc.2 or newer and start dashi:

```sh
pnpm install @deepseek-ai/dsh@0.1.5-rc.2 @antst/dashi-launcher
dsh plugin --profile dashi add @antst/dashi-app
dashi
```

Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease.
When upgrading DSH, remove `node_modules` and the lockfile before installing so
pnpm cannot retain stale peer-only DSH packages.
A DSH profile must use one uniform DSH version. The minimum supported version
is `0.1.5-rc.2`; CI tests `0.1.5-rc.2`, `0.1.6-alpha.1`, and
`0.1.6-alpha.2` with exact, reproducible graphs.

Without this launcher package, use `dsh --profile dashi` directly or define:

```sh
alias dashi='dsh --profile dashi'
```
