# Plain plugin packages installed by dsh plugin add never load

## Body

- Queued (not yet posted): DSH Discussion: `dsh plugin add` of a plugin package without a bundle manifest installs it and warns, but composes no loader row, so it never loads; suggest adding an insert row to the profile patch (or a `dsh plugin enable <pkg>` verb) and making the warning say what is missing (apps/cli/src/plugin.ts:59-91) (W-061).

Target: DSH Discussion (plain)
