# Laser Core 0.2.0-beta.1 candidate notes

Laser Core is a Windows x64 desktop full-node wallet and mining client for the
experimental Laser Shadownet. This candidate is testnet software only. Do not
use it to hold assets of value.

## Included runtime

- Current Shadownet runtime: Laser and laserd 3.0.0-beta.2, store format 3,
  wire protocol 3.
- PhotonHash shadow observer: observational and non-consensus.
- Preserved sandbox compatibility runtime: pinned source commit and binary
  hashes recorded in BUILDINFO.txt.
- Optional CUDA mining helper when present; CPU consensus verification remains
  authoritative and CPU-only operation remains supported.

The release builder rejects mismatched CLI/daemon versions and a sandbox
runtime whose binaries do not match its checked build identity.

## Desktop safety changes

- Renderer processes use context isolation, Chromium sandboxing, denied
  permissions, blocked new windows, and local-file-only navigation.
- Content Security Policy blocks remote scripts, fonts, connections, frames,
  and plugins. The user interface no longer fetches Google Fonts.
- Activity and error messages are inserted as text rather than interpolated
  HTML.
- The distributable excludes the legacy unauthenticated development HTTP
  server and its web UI.
- The optional explorer publisher no longer pulls an untracked sibling binary
  into the public package.
- Wallet passphrases remain off command lines and environment variables and are
  zeroed from the bounded in-memory secret store on lock or expiry.

## Verification

Each candidate directory contains the portable executable, BUILDINFO.txt,
NOTICE.txt, these notes, an SPDX dependency inventory, and SHA256SUMS. Run:

```powershell
npm run verify:release -- -ReleaseDir <candidate-directory>
```

For a final Windows publication, also require a valid Authenticode signature:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-release.ps1 `
  -ReleaseDir <candidate-directory> -RequireCodeSigning
```

## Known release gates

- No project-wide license grant has been finalized. NOTICE.txt and package
  metadata state UNLICENSED; a final public source-license decision belongs to
  the repository owner.
- Local candidates are not Authenticode-signed unless a release certificate is
  configured. Unsigned output is suitable for internal qualification, not a
  final Windows publication.
- The dependency advisory lookup is a separate networked release check and is
  not represented by the offline checksum verifier.
- There is no automatic update channel. Users must verify and install later
  candidates manually.
