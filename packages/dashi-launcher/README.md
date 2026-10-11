# @antst/dashi-launcher

The `dashi` command starts an installed DeepSeek Harness profile. It starts
`dsh` on PATH, so use your global bin directory or `npm exec` / `pnpm exec`
in a project. It does not choose a separate DSH installation or change the
child environment.

## Install

Use Node 22.19 or newer on the Node 22 line, or Node 24+. DSH's profile
manager needs `pnpm` on PATH even when DSH itself is installed with npm or
run by npx. If you do not already have it:

```sh
npm install -g pnpm@10.28.1
```

The minimum supported DSH is `0.2.1-alpha.2`; dashi 0.2 uses DSH's 0.2
integration. Linux and macOS installation checks run the global, on-demand,
project and mixed sequences below on Node 22. The workspace's frozen pnpm
graph is a development check, not an installation requirement for users.

### Global or on-demand DSH

With npm:

```sh
npm install -g @deepseek-ai/dsh@0.2.1-alpha.2
npm install -g @antst/dashi-launcher@0.2.0-alpha.2
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

With pnpm (including pnpm 10.28.1):

```sh
pnpm setup
# Open a new shell after setup so pnpm's global binaries are on PATH.
pnpm add -g @deepseek-ai/dsh@0.2.1-alpha.2
pnpm add -g @antst/dashi-launcher@0.2.0-alpha.2
```

For pnpm 11.18.0, apply the [global-store remedy](#dsh-installed-globally-with-pnpm-11)
below before starting DSH. Then:

```sh
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
dashi
```

With npx, without a permanent CLI installation:

```sh
npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
npx --yes --package=@deepseek-ai/dsh@0.2.1-alpha.2 --package=@antst/dashi-launcher@0.2.0-alpha.2 dashi --version
npx --yes --package=@deepseek-ai/dsh@0.2.1-alpha.2 --package=@antst/dashi-launcher@0.2.0-alpha.2 dashi
```

Or start the installed profile directly:
`npx --yes @deepseek-ai/dsh@0.2.1-alpha.2 --profile dashi`.

### DSH installed globally with pnpm 11

On pnpm 11.18.0 the default global virtual store can prevent DSH's native
loader from finding its installed platform binding. The error includes:

```text
No usable native binding found for node-addon-require-builtin-darwin-arm64
```

The suffix identifies your platform. This is the DSH/pnpm layout issue
tracked in [Discussion 9432](https://github.com/deepseek-ai/deepseek-harness/discussions/9432),
not a missing dashi dependency. Disable the global virtual store and
reinstall DSH:

```sh
pnpm config set --global --json enableGlobalVirtualStore false
pnpm remove -g @deepseek-ai/dsh && pnpm add -g @deepseek-ai/dsh@0.2.1-alpha.2
```

The setting affects subsequent pnpm installations; it does not migrate
existing installations by itself. No launcher environment injection or
automatic retry is used.

### Project DSH

From your project directory, with npm:

```sh
npm install --save-exact @deepseek-ai/dsh@0.2.1-alpha.2 @antst/dashi-launcher@0.2.0-alpha.2
npm exec -- dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
npm exec -- dashi
```

Or with pnpm:

```sh
pnpm add --save-exact @deepseek-ai/dsh@0.2.1-alpha.2 @antst/dashi-launcher@0.2.0-alpha.2
pnpm exec dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
pnpm exec dashi
```

### Global and project installations together

`dashi` starts the `dsh` on PATH: run it the way you run DSH, through your
global bin directory or `npm exec` / `pnpm exec` in a project. Those project
commands put the project's binaries first; a bare global invocation uses
your normal PATH. To inspect the selection, use `command -v dsh` and
`dashi --version` globally, or `npm exec -- dashi --version` /
`pnpm exec dashi --version` in the project. `--version` reports DSH;
`dashi --help` reports both dashi and DSH.

Unless you set `DSH_HOME`, both installations use DSH's same `~/.dsh`
profiles, settings and session history. A profile therefore needs to be
compatible with whichever DSH you start; a second installation is not a
second profile or an automatic migration.

### Upgrading an existing profile

Exit dashi and preserve your profile's manifest, lockfile, patches and
provider configuration before upgrading. Update the launcher with the
manager and location you used to install it, then update the shared profile.
For a global npm installation:

```sh
npm install -g @antst/dashi-launcher@0.2.0-alpha.2
dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2
```

For global pnpm, replace the first command with
`pnpm add -g @antst/dashi-launcher@0.2.0-alpha.2`.
For a project, use `npm install --save-exact @antst/dashi-launcher@0.2.0-alpha.2`
then `npm exec -- dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2`,
or `pnpm add --save-exact @antst/dashi-launcher@0.2.0-alpha.2` then
`pnpm exec dsh plugin --profile dashi add @antst/dashi-app@0.2.0-alpha.2`.
With npx, repeat the on-demand commands with the new exact versions.
To update DSH itself, repeat your chosen DSH installation command with the
supported version before updating the profile. No home-directory install,
companion pins, lockfile repair or runbook detour is required by these paths.

Historical caveat: upgrading a `0.1.x` profile to `0.2.0-alpha.1` could leave
the Sessionbus plugin's older upload-provider dependency shadowing the app's
pin; `pnpm dedupe` did not repair that path. Alpha.2 changed the plugin to
pre.20, which consumes the provider as a peer, and the in-place upgrade was
proven on the dsh host. The universal checks record the provider actually
mounted from the profile-root importer and its active `fileUploads` service,
not counts of inactive copies on disk.


Without this launcher, use `dsh --profile dashi` directly. When
`SESSIONBUS_LAUNCH_TOKEN` is present, the launcher selects the `sessionbus`
lane profile instead; other arguments, environment, signals and exit status
are forwarded unchanged.
