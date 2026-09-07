# Live patch reload excludes bundle additions

## Body

- Queued (not yet posted): DSH Discussion: live patch reload (patchReload: live) applies cordis.patch.yml edits at runtime but not dsh.profile.bundles additions, and nothing documents the asymmetry; suggest either reloading bundle layers live or stating the restart requirement in the profile docs (apps/cli/src/profile-boot.ts:279-286, packages/boot/app-boot/src/index.ts:236-267) (W-061).

Target: DSH Discussion (plain)
