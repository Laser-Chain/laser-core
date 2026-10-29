# Releasing Laser Core

Release evidence belongs to an exact commit and exact artifact bytes. Changes
on `main` do not update an existing downloadable executable. Desktop versions
and native node versions are separate identities.

## Prepare a candidate

1. Select a clean desktop commit with passing source CI. Run `npm ci`, rebuild
   the renderer, and check that generated files match. Run `npm test`.
2. Review dependency advisories, including packaging tools and Electron itself.
   Empty application npm dependencies do not establish that Chromium, Electron,
   native executables, or development tools are free of vulnerabilities.
3. Obtain compatible native and explorer source through authorized access.
   Set `LASER_SOURCE_DIR`, `LASER_EXPLORER_SOURCE_DIR`, and `LASER_NVCC`. Runtime
   preparation archives the selected Git commits into isolated directories,
   compiles every bundled executable, runs bounded native tests and records
   input digests, compiler identities, commands, compatibility patches and
   output hashes. Existing worktree edits and live runtime files are not inputs.
4. On Windows x64, run `npm run release:win` from the clean desktop checkout.
   The script runs tests, verifies staged identities, packages the application,
   and assembles the release inventory. Do not use `-AllowDirty` for a public
   release. Preserve the build evidence outside tracked application source.

`npm run prepare:v3` builds all three runtime groups, including the pinned
sandbox and explorer. It compiles CUDA without executing GPU workloads. Retain
the ignored `.runtime/build-*/` evidence. `release:win` normally repeats the fresh
build; `-UseVerifiedRuntimes` reuses a previously compiled set only after checking
all receipts and binary bytes. Every package target enforces these checks.

Build receipts are generated locally, not independently signed attestations.
Tool hashes and source manifests improve traceability; this pipeline is not
hermetic or independently reproducible. It does not pin the entire Windows SDK,
system libraries or CUDA installation. Authorized source access is still needed
to reproduce private native components. Never export that source or its history
as part of the desktop package.

## Verify the package

Run the strict bundle verifier on the assembled directory:

```powershell
npm run verify:release -- -ReleaseDir <candidate-directory>
```

It checks the seven-file inventory, checksums, build identity, SPDX document, and
Authenticode status. Inspect ASAR application files and all native resources
against the reviewed inputs, confirm Electron fuses and credential exclusions,
and run the packaged code on an isolated temporary profile. Check startup,
renderer/IPC, wallet restore/unlock with disposable keys, shutdown, and native
compatibility. Do not borrow a user's live node, wallet, RPC token, or ports.
Record results and unresolved limitations. Independent review and a second
builder remain qualification gates for a production release; an unsigned
experimental prerelease must explicitly record when these are outstanding.

Release format v2 adds `BUILD-PROVENANCE.json`: all component receipts, the
application archive digest, each packaged application file's digest and the
lockfile digest. `NOTICE.txt` includes the native dependency license texts.
The SPDX file describes npm dependencies; it is not a complete native/OS SBOM.
Use the verifier from the matching tag for older six-file format-v1 releases.

## Authenticate and publish

The existing beta line is unsigned. `SHA256SUMS` detects changed bytes only when
the manifest is obtained from a trusted source; it does not authenticate the
publisher. A `Valid` Authenticode status alone also does not identify the expected
project publisher. Signed releases need an approved signing identity, controlled
key custody, documented certificate verification, and authenticated checksums.
Use `-RequireCodeSigning` when checking a candidate that must be signed. Do not
create or rotate signing keys as an incidental packaging step.

Before publication, ensure the tag selects the reviewed desktop commit and the
release notes state the native versions, network, signature status, known risks,
and upgrade/recovery expectations. Publish the verified bytes with their existing
notices, SBOM, build information and checksum manifest. Download every uploaded
asset again and verify its digest. Preserve prior releases for rollback; never
replace an existing version's bytes with a new build.

Keep experimental builds marked as prereleases. Shadownet is resettable and its
coins have no monetary value. Desktop unit tests, local native tests, and package
checks do not establish public-network qualification or mainnet readiness.
