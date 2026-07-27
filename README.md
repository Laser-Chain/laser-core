<p align="center">
  <img src="renderer/logo.png" alt="Laser chain logo" width="220">
</p>

<h1 align="center">Laser Core</h1>

<p align="center">
  A desktop full node, encrypted wallet, and miner for Laser Shadownet.
</p>

> [!WARNING]
> Laser Shadownet is an experimental test network. LASER mined here has no
> monetary value. Network history, software, and data formats may reset or
> change. Do not use this client to hold assets of value.

## Start mining

Laser Core currently supports Windows 10/11 x64. The portable client starts a
validating node automatically, connects to Shadownet peers, manages encrypted
wallets, and mines to the wallet you select.

### 1. Download and verify

1. Open the [Laser Core releases](https://github.com/photonicmoney/laser-core/releases).
2. Download `Laser-Core-*-portable-x64.exe` and `SHA256SUMS`.
3. In PowerShell, calculate the executable hash:

```powershell
Get-FileHash .\Laser-Core-*-portable-x64.exe -Algorithm SHA256
```

Confirm that the result exactly matches the executable entry in
`SHA256SUMS`. Current beta builds may be unsigned, so Windows can show a
SmartScreen warning. Only continue after verifying the checksum from this
repository's release page.

### 2. Run your node

Open the portable executable. Laser Core will:

- start the bundled `laserd` full node;
- connect to the Laser Shadownet bootstrap peer;
- validate and store the chain locally;
- start the non-consensus PhotonHash observer; and
- open the wallet and mining interface when RPC is ready.

The status bar shows peer count and chain height. Leave Laser Core running to
remain connected and continue validating Shadownet.

### 3. Create a wallet

1. Open **Overview**.
2. Select **Create**.
3. Choose a wallet name using letters, numbers, or underscores.
4. Enter and confirm a strong passphrase.
5. Store the passphrase somewhere safe—it cannot be recovered.

The encrypted wallet file is normally stored at:

```text
%APPDATA%\laser-core\wallets\<wallet-name>.key
```

Back up that `.key` file while Laser Core is closed. Keep the backup and its
passphrase private. Use **Restore** to import an encrypted wallet backup.

### 4. Mine on Shadownet

1. Wait until the node is online and has at least one peer.
2. Create or open your wallet.
3. Open **Mining**. The active wallet should already be selected.
4. Choose the interval between mining cycles; `10` seconds is a sensible
   starting value.
5. Select **Start Mining**.

The Mining tab reports session blocks, rewards, solve time, errors, backend,
and lifetime totals for the loaded wallet. Select **Stop Mining** before
closing the client or switching wallets. Closing Laser Core also stops mining
and shuts the node down gracefully.

CPU mining works by default. When a compatible bundled CUDA helper and NVIDIA
GPU are available, the client can use CUDA acceleration while independently
checking every candidate with the CPU consensus implementation. Failure or
unavailability falls back to CPU automatically.

## Your local data

Default Windows locations are:

| Data | Location |
| --- | --- |
| Shadownet chain | `%APPDATA%\laser-core\shadownet` |
| Encrypted wallets | `%APPDATA%\laser-core\wallets` |
| Shadow evidence | `%APPDATA%\laser-core\shadownet-evidence` |

Back up wallets before deleting application data. Never share wallet `.key`
files, passphrases, or RPC tokens.

## Node configuration

The portable client works without configuration. Operators can set these
environment variables before starting Laser Core:

| Variable | Purpose |
| --- | --- |
| `LASER_DATADIR` | Use a different chain-data directory |
| `LASER_PEERS` | Override bootstrap peers with a comma-separated list |
| `LASER_LISTEN` | Change the P2P bind endpoint |
| `LASER_ADVERTISE` | Advertise a reachable public P2P endpoint |
| `LASER_MINER_BACKEND` | Select `auto`, `cuda`, or `cpu` |
| `LASER_CUDA_DEVICE` | Select the CUDA device, default `0` |
| `LASER_CUDA_BATCH` | Set CUDA batch size from `1` to `65536` |

By default, the node makes outbound connections and binds P2P locally. Running
an inbound-reachable public node requires an appropriate `LASER_LISTEN`,
`LASER_ADVERTISE`, router/firewall configuration, and normal host hardening.

## Troubleshooting

- **No peers:** confirm the computer is online and that firewall or endpoint
  security is not blocking Laser Core.
- **Node stays offline:** close other Laser processes, restart the client, and
  read the startup error shown in the application.
- **Wallet will not open:** confirm the wallet name, backup file, and
  passphrase. Passphrases cannot be reset.
- **Mining stops:** reopen/unlock the wallet, check the node is online, and
  restart mining. Locking a wallet intentionally stops its mining session.
- **CUDA unavailable:** continue on CPU or update the supported NVIDIA driver;
  CUDA is optional and never changes consensus rules.

## Verify a release bundle

Every release bundle includes build identity, notices, release notes, an SPDX
SBOM, and strict SHA-256 checksums. From a source checkout, verify the full
bundle with:

```powershell
npm run verify:release -- -ReleaseDir <release-directory>
```

## Development

```powershell
npm ci
npm test
```

Packaging also requires a compatible Laser node source checkout. Set
`LASER_SOURCE_DIR` to that checkout, build its Windows node binaries, prepare
the compatibility runtime, and build the client:

```powershell
$env:LASER_SOURCE_DIR = 'C:\path\to\laser'
npm run prepare:sandbox
npm run release:win
```

The release workflow stages exact node binaries under the ignored `.runtime/`
directory, rejects version or hash mismatches, refuses dirty application
source, runs the full test suite, and assembles the final directory atomically.

See [RELEASE_NOTES.md](RELEASE_NOTES.md), [NOTICE.txt](NOTICE.txt), and
[SECURITY.md](SECURITY.md) before distributing or operating the beta.

## License status

No project-wide license grant has been finalized. The source and package are
currently marked `UNLICENSED`; bundled components retain the terms listed in
[NOTICE.txt](NOTICE.txt).
