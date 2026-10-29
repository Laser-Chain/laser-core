# Public release security audit

Audit date: 2026-07-27

Maintenance note, 2026-10-28: the historical dependency counts below describe
that audit's inputs. The current lockfile updates Electron to 43.8.4 and patches
compatible transitive dependencies; a fresh full `npm audit` reports zero known
advisories. This is a dated dependency check, not a new independent security
audit or an update to existing release binaries. CI now repeats the full audit.

## Result

No credentials, private keys, bearer tokens, local user paths, or private
repository URLs were found in the tracked source or its public Git history.
The public package inventory is explicit and excludes development servers,
wallet files, environment files, local publisher configuration, build output,
and staged runtimes from source control.

The audit found and fixed release-boundary weaknesses before this candidate:

- privileged IPC calls now require the exact local renderer frame;
- wallet, address, amount, fee, and mining inputs are revalidated in the main
  process before they become CLI arguments;
- optional explorer publishing now requires HTTPS and an existing configured
  helper, with bounded scheduling and no sibling-project discovery; and
- Electron fuses disable Node-mode, debug environment entry points, and legacy
  file-protocol privileges while enforcing ASAR integrity and ASAR-only
  application loading. Renderer pages use a fixed-resource custom protocol
  without fetch, service-worker, or CSP-bypass privileges.

## Scope and checks

- Reviewed all tracked JavaScript, HTML, CSS, PowerShell, package metadata,
  compatibility patches, documentation, and release inventory rules.
- Scanned the tracked tree and every public commit for common credential,
  private-key, private-path, and repository-origin patterns.
- Traced renderer, preload, IPC, child-process, filesystem, wallet-secret,
  networking, node-runtime selection, and shutdown paths.
- Tested fail-closed store-version selection, local-only navigation, sandboxed
  renderers, wallet restore boundaries, secret expiry, mining cancellation,
  and privileged argument validation.
- Audited npm dependencies and inspected the packaged ASAR, release manifest,
  SBOM, checksums, executable signatures, Electron fuses, and binary strings.

## Dependency status

`npm audit --omit=dev` reports zero vulnerabilities. The full development-tree
audit reports 16 high-severity findings under electron-builder's transitive
glob/brace-expansion tooling. The latest electron-builder release is already
used, and npm's proposed fix is a breaking forced downgrade. The affected
modules process repository-controlled files during packaging and are not
runtime dependencies of the shipped application.

## Residual release risks

- The Windows executable is not Authenticode-signed. It is published only as a
  prerelease and must be verified against `SHA256SUMS`.
- The project is `UNLICENSED`; public visibility does not grant reuse rights.
- Laser and Shadownet are experimental. This review is not a formal proof of
  consensus correctness or cryptographic security, and the client must not be
  used for assets of value.
- Public seed addresses, protocol identifiers, compatibility patches, version
  numbers, and source commit identifiers are intentional release metadata, not
  secrets.
