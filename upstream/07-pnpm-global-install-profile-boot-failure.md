# pnpm global installs produce profiles with missing DSH packages

## Body

- Queued (not yet posted): DSH Discussion: with `pnpm install -g @deepseek-ai/dsh@0.1.2-rc.1` under pnpm 11 on macOS, every profile fails to boot, including DSH's own `dsh --profile web`, with missing @deepseek-ai/dsh-llm (and others). Cause: healProfilesModuleFallback (packages/boot/app-boot/src/profile.ts:578-592) walks the CLI's dependency closure with require.resolve.paths from the CLI package's own location, but pnpm 11's global layout keeps the CLI package under store/v11/links with its dependencies hoisted into the global instance's .pnpm/node_modules, which that walk does not reach; the healed $DSH_HOME/profiles/node_modules ends up with 68 of the packages and no dsh-llm. Reproduced 2026-09-04 on macOS 27 arm64, pnpm 11.7. Suggest resolving the closure from the pnpm virtual-store instance (the realpath's .pnpm/node_modules sibling) or documenting that global pnpm installs are unsupported and npx/local installs are the path.

Target: DSH Discussion (plain)
