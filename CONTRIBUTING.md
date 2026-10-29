# Contributing to Laser Core

Laser Core contains the Electron desktop application, its renderer, IPC bridge,
and packaging tools. The native validator, CLI, CUDA miner, and explorer helper
are separately maintained components. Desktop tests do not validate consensus.
Source access and licensing for those components are separate from this repo.
Laser Core is currently `UNLICENSED`; public visibility is not a reuse grant.
See [NOTICE.txt](NOTICE.txt) for bundled dependency terms.

## Build and test

Node.js 22 or 24 and Python 3.12 are sufficient for the source checks:

```sh
npm test
python scripts/build-renderer.py
git diff --exit-code -- renderer/app.js renderer/template.js renderer/style.css
```

The unit tests need no npm installation, native binaries, peers, or real wallet.
Run them on a disposable development checkout. CI checks Linux, Windows, and
macOS; packaged native runtime support remains Windows x64.

Edit the renderer's [source files](ui-src/README.md), regenerate the output, and
include both in the change. To launch Electron or package the app, install the
locked development dependencies with `npm ci` and follow the
[README](README.md#development). Packaging additionally needs authorized access
to compatible native source and staged runtime binaries. Never substitute an
unrelated downloaded binary to make a package pass.

## Propose a change

Use a focused branch and pull request. Explain the user-visible problem, why
the change fixes it, the tests run, and remaining limitations. Keep behavior
changes separate from broad formatting or moves. Add a regression test for a
bug, preferably one that fails before the fix and exercises actual behavior.
Source-text assertions alone cannot establish runtime correctness.

Review wallet, IPC, child-process, filesystem, and packaging changes as security
boundaries. Validate privileged input in the main process, use argument arrays
for native commands, keep secrets out of arguments and logs, and preserve exact
integer photon values. Exercise errors and cancellation as well as success.
Consensus or native protocol changes require review in their owning component;
they cannot be activated by a renderer setting.

Do not test against a valuable wallet or a running user's data directory.
Include only synthetic, redacted fixtures. Do not upload wallet backups, RPC
tokens, publisher settings, raw private logs, `.runtime`, or packaged executables
in issues or pull requests. Report vulnerabilities through the
[private security route](SECURITY.md).

## Review and release

Review the exact final commit and its CI results. A passing unit suite is one
piece of evidence; native compatibility and packaged Electron behavior require
separate checks. High-risk changes should receive independent review before a
release. Use the [release procedure](docs/releasing.md), which distinguishes
source checks, package verification, artifact integrity, and publisher identity.
