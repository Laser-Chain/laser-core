# Laser Core desktop redesign

This is the native Electron renderer imported from `Laser Core.dc.html` in
`Laser redesign direction (2).zip`. It uses the existing isolated preload IPC
bridge for wallets, payments, node diagnostics and mining. There is no HTTP
server, prototype backend, remote font request, or runtime template evaluator
in the shipped application.

Edit `app.template.html`, `app-controller.js`, and `base.css` in this directory.
Run `npm run build:ui` with Python 3 available, then `npm test`. Generated files
in `renderer/` are included in the application, so Python is not needed to run
the client. The fonts and React runtime are bundled with their license notices.

Run `npm start` to open Electron. `npm run dist:redesign` creates the local
Windows x64 portable candidate at
`dist/redesign/Laser-Core-Redesign-x64.exe`, without replacing existing release
artifacts. This command does not publish a release or certify a code signature.
Use the existing release workflow for a public release.

The five views use real node data. Locked or unavailable balances are unknown,
not zero. Monetary calculations use integer photons; unsafe JSON integers from
the native CLI are preserved as strings before crossing IPC. Sending rechecks
the wallet and spendable balance before signing. Opening or unlocking a wallet
does not start mining. Contacts and preferences retain their existing local
storage keys; passphrases stay in the native session secret store.

Automated renderer tests exercise startup, wallet creation/unlock/restore/lock,
secret expiry, pending balance accounting, transaction review/cancellation,
duplicate submission, mining controls, clipboard failure, and unavailable node
metrics. Native smoke checks should use an isolated profile and datadir, with
public peers and Explorer publishing disabled. No preview server is needed for
normal operation.
