# Laser Core release notes

## 0.2.0-beta.3: startup recovery and desktop operations (2026-10-28)

- Keep the node marked as starting while it verifies saved blocks, even when
  verification takes longer than five minutes. Open the interface after a short
  splash, show elapsed time, and connect automatically when RPC becomes ready.
- Initialize optional services on late readiness, preserve publisher recovery,
  and report actual process failures without prompting an unnecessary restart.
- Keep native node and CLI console windows hidden during normal operation.

- Idle the optional explorer publisher while the chain tip is unchanged and
  respect server source authority. Publishing remains independent of mining.

- Every supported Windows x64 package must include the publisher service,
  snapshot helper and helper SHA-256 identity. All packaging paths validate
  the staged runtime and the resulting application archive.
- Configure publishing from Settings → Explorer publisher or Network. Save an
  operator-issued token once; credentials are encrypted for the OS account and
  restored automatically on subsequent portable launches. Existing launch/file
  configuration is imported on first use. No server token is bundled.
- Show export/upload progress, last delivered height/time and actionable errors
  separately from mining. Retry failures, bound upload time, reject redirects,
  cancel work on disable/shutdown, and resume after the local node recovers.

- Add saved mining intensity presets from Minimal (10%) through Full (100%),
  with changes taking effect on the next mining cycle. Minimal and Quiet pause
  the optional research observer while the node and miner continue running.
- Reduce simultaneous CUDA work at low intensity and pace GPU and CPU mining
  through the matching native runtime update. Intensity controls workload; it
  does not set a device power limit or guarantee a particular fan speed.
- Display receiving addresses as one continuous string and simplify the
  transaction-submission receipt, keeping the full recipient and exact amounts
  available without treating submission as network confirmation.
- Clarify the About dialog's separate desktop app and node engine versions,
  display the network as Shadownet (testnet), and group runtime, protocol,
  storage, and connection settings under technical details.

The Windows x64 beta.3 package includes these changes and the matching native
runtime with mining-intensity support. The node engine remains 3.0.0-beta.2;
active Shadownet consensus remains PhotonHash v0.2.2. This is an unsigned
prerelease for the experimental, valueless Shadownet. Previous downloads remain
available. Build identity, runtime hashes and dependency inventory accompany
the executable.

## 0.2.0-beta.2: desktop redesign (2026-10-21)

- Native Electron Overview, Send, Receive, Mining, and Network views, with a
  matching startup screen and locally bundled fonts and React runtime.
- Static renderer generation from `ui-src/`, without a runtime template
  evaluator or a preview HTTP server in the application.
- Exact photon amounts through native JSON, IPC, balance display, and payment
  validation; unavailable balances remain unknown instead of appearing as zero.
- Fresh wallet and balance checks before signing, duplicate-submit protection,
  pending-spend accounting, and reconciliation of wallet locks and expiry.
- Renderer workflow tests and automated checks for generated-source drift.

The Windows x64 portable beta includes this redesign and the existing
3.0.0-beta.2 Shadownet node runtime. Download the executable and `SHA256SUMS`
from the `v0.2.0-beta.2` release. This experimental beta is unsigned; verify
its checksum before running. Existing release artifacts remain available.

## Laser Core 0.2.0-beta.1 candidate notes

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
  authoritative and CPU-only operation remains supported. Its individual
  SHA-256 identity is recorded with the other native runtimes.

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
  into the public package, requires HTTPS, and fails closed when its helper is
  absent or its configuration is malformed.
- Privileged IPC accepts calls only from the expected local renderer and
  independently validates wallet names, mining counts, addresses, amounts,
  and fees before constructing CLI arguments.
- Electron runtime fuses disable RunAsNode, NODE_OPTIONS, and inspector CLI
  arguments and legacy file-protocol privileges, and require ASAR integrity
  and ASAR-only application loading. Local pages use a fixed-resource
  `laser-core://` protocol with no fetch, service-worker, or CSP-bypass
  privileges.
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
- The 2026-07-27 dependency audit found zero production dependency
  vulnerabilities. It reports 16 high-severity development-only findings in
  electron-builder's transitive glob tooling. The latest electron-builder is
  in use; npm's suggested remediation is a breaking forced downgrade. These
  modules process repository-controlled build inputs and are not application
  runtime dependencies.
- There is no automatic update channel. Users must verify and install later
  candidates manually.
