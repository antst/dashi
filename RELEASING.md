# Cutting a release

Start from the accepted release-preparation commit merged onto `main`, with
the gates and installation checks green. Complete the ledger's required
host proofs using the four archives below before pushing a tag.

## Obtain the four archives and hash lines

Use Linux x64, Node **22.23.3**, and the workspace's pinned pnpm. Do not pack
with another Node version or package manager. Choose a new, durable directory
outside the working tree; replace the example path below with its absolute
path in both command blocks. Keep that path for a new shell or a reboot.
From the repository root:

```sh
release_directory=/absolute/path/in/durable-storage/dashi-0.2.2
mkdir "$release_directory"
pnpm install --frozen-lockfile
node scripts/pack-release.mjs "$release_directory/archives" > "$release_directory/hashes.txt"
```

The shared script checks the toolchain, deletes only the two generated `lib`
directories, builds, and packs all four packages. A build failure stops packing.
Its stdout is exactly the four tag-message lines; build and pack output goes
to stderr. The merged head's Linux gate prints the same four lines and checks
three consecutive clean-build-and-pack sets. Compare all four hashes with
that run and with the archives accepted in the required host proof packets.

## Create and push the tag once

For 0.2.2, the annotation contains these archive names, each preceded by its
actual SHA256 from `$release_directory/hashes.txt`:

```text
<sha256>  antst-dsh-file-uploads-none-0.2.2.tgz
<sha256>  antst-dashi-0.2.2.tgz
<sha256>  antst-dashi-app-0.2.2.tgz
<sha256>  antst-dashi-launcher-0.2.2.tgz
```

Each line starts at column 0: exactly 64 lowercase hexadecimal characters,
exactly two spaces, then the archive file name, with nothing after it. Any
order is accepted. There must be exactly four such lines, one per archive;
no other annotation line may begin with 64 hexadecimal characters. Other
annotation prose is optional; any line beginning with 64 hexadecimal characters
is read as a payload line and must match the exact form. The tag and all four package versions must be
the same plain `MAJOR.MINOR.PATCH`, without prerelease or build metadata.

At the proven `main` commit, for this release:

```sh
release_directory=/absolute/path/in/durable-storage/dashi-0.2.2
git tag -a v0.2.2 -F "$release_directory/hashes.txt"
node scripts/check-release-payloads.mjs v0.2.2 "$release_directory/archives"
git push origin v0.2.2
```

The local payload check reads the public npm registry and needs network access.
Keep the external directory for the host proofs and tag; it adds no untracked
outputs to the working tree. Do not push until the local check and the
proof/hash comparison pass.
Never move a pushed release tag or overwrite a published version.

## What the workflow does

Preflight checks the plain version, rebuilds and packs with the same toolchain
and script, validates the annotated tag's four hashes, and checks registry
integrities. Every exact external dependency in a packed manifest must exist
with the frozen lock's integrity. All gates and installation checks must pass.
The publish job rebuilds, packs and checks again before uploading anything.

Publication order is provider, core, app, launcher; each goes to npm `latest`
with provenance. Before any upload, all four packuments are read: an existing
version must have the expected archive integrity. Absence means a reachable,
valid packument lacking that version, never a network, auth or registry error.
The GitHub release is created only after all four versions are published or
verified equal. No archive is carried between workflow runs.

## Failure and continuation

The table assumes no versions existed before the first attempt. An interrupted
upload may already have committed: inspect registry integrity, not just the
job's exit status.

| Failure point | npm state | GitHub release | Next action |
| --- | --- | --- | --- |
| Version, build, hash, registry preflight, gate or installation check | No new upload | Not created | Resolve the cause before any continuation; a changed payload needs new proofs and a new version/tag. |
| First upload refused by trusted publishing | Nothing published | Not created | Stop and report the cause; do not re-run until it is known. |
| 5xx or dropped connection during an upload | That upload's outcome is uncertain; earlier uploads remain published | Not created | Run ends without replay; manually re-run the same tag, which reads registry integrity before uploading anything. |
| Provider upload | Provider absent or uncertain | Not created | Inspect the provider's registry integrity before deciding whether to re-run the same tag. |
| Core upload | Provider published; core absent or uncertain | Not created | Inspect core integrity first. |
| App upload | Provider and core published; app absent or uncertain | Not created | Inspect app integrity first. |
| Launcher upload | Provider, core and app published; launcher absent or uncertain | Not created | Inspect launcher integrity first. |
| GitHub query or release creation | All four published and verified | Absent, or creation uncertain | Check whether the release exists; continue only with the same tag and bytes. |

A manual re-run of the same tag rebuilds and rechecks all archives, skips only
versions with equal integrity, and continues missing versions in that order.
Any unequal version or registry error stops before the first upload. Never
replay an uncertain upload blindly; no automatic upload retry or dist-tag
repair occurs. The upload command alone sets pnpm's fetch retries to zero;
registry reads are unchanged. During partial publication, the app is not published until its
exact siblings exist; the old launcher remains current until the final upload.

This release's pnpm trusted-publisher upload is exercised only at the tag run;
prepared-archive dry runs and local registry controls do not prove OIDC admission.
