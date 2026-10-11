# @antst/dashi-launcher

The `dashi` command starts the dashi terminal UI through an installed DeepSeek
Harness profile.

Install DSH 0.2.1-alpha.2 and the matching dashi 0.2 prerelease:

```sh
pnpm add --save-exact @deepseek-ai/dsh@0.2.1-alpha.2 @antst/dashi-launcher@0.2.0-alpha.2
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

For a home pnpm install, `dsh`/`dashi` live in `$HOME/node_modules/.bin`.
Add it to your login shell's PATH (e.g.
`export PATH="$HOME/node_modules/.bin:$PATH"` in the appropriate shell rc), or
invoke the bins by full path. Without editing an rc file, run `pnpm exec dashi`
from the home install directory. The runbook's per-shell export and daemon
drop-in cover scripts and the service, not your login shell.

Npm is unsupported for prerelease DSH because it cannot constrain a scoped
package family to one prerelease.
When upgrading DSH, follow the [host installation runbook](https://github.com/sessionbus/sessionbus-dsh/blob/main/docs/HOST-INSTALL.md): snapshot first and repair stale peer-only packages and CLI companion pins without wiping `node_modules` or the lockfile.
A DSH profile must use one uniform DSH version. The minimum supported version
is `0.2.1-alpha.2`; CI tests `0.2.1-alpha.2` with an exact, reproducible graph.

Without this launcher package, use `dsh --profile dashi` directly or define:

```sh
alias dashi='dsh --profile dashi'
```
