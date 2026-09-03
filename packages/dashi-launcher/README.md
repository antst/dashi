# @antst/dashi-launcher

The `dashi` command starts the dashi terminal UI through an installed DeepSeek
Harness profile.

Install the exact validated DSH release and start dashi:

```sh
pnpm install @deepseek-ai/dsh@0.1.2-rc.1 @antst/dashi-launcher
dsh plugin --profile dashi add @antst/dashi-app
dashi
```

Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease.
When upgrading DSH, remove `node_modules` and the lockfile before installing so
pnpm cannot retain stale peer-only DSH packages.
dashi validates each DSH release before adopting it, and its packages pin DSH
dependencies exactly.

Without this launcher package, use `dsh --profile dashi` directly or define:

```sh
alias dashi='dsh --profile dashi'
```
