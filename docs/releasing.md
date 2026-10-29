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
3. Obtain the compatible native source through authorized access. Record its
   exact revision, toolchain, dirty status, binary hashes, and any patches.
   Stage v3 and pinned compatibility runtimes using the README instructions.
   Recheck CUDA and explorer helper identities separately.
4. On Windows x64, run `npm run release:win` from the clean desktop checkout.
   The script runs tests, verifies staged identities, packages the application,
   and assembles the release inventory. Do not use `-AllowDirty` for a public
   release. Preserve the build evidence outside tracked application source.

Staging records the source checkout and hashes of supplied binaries. This does
not independently prove those binaries were compiled from that source. Preserve
the native build receipt as well. A source revision string is not a reproducible
build attestation.

## Verify the package

Run the strict bundle verifier on the assembled directory:

```powershell
npm run verify:release -- -ReleaseDir <candidate-directory>
```

It checks the six-file inventory, checksums, build identity, SPDX document, and
Authenticode status. Inspect ASAR application files and all native resources
against the reviewed inputs, confirm Electron fuses and credential exclusions,
and run the packaged code on an isolated temporary profile. Check startup,
renderer/IPC, wallet restore/unlock with disposable keys, shutdown, and native
compatibility. Do not borrow a user's live node, wallet, RPC token, or ports.
Record results and unresolved limitations. Have a second reviewer reproduce
the material checks for wallet or release-boundary changes.

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
