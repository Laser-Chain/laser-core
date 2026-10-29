# Node privacy and its limits

Laser Core does not currently provide an anonymous networking mode. Shadownet
uses direct peer connections and operating-system hostname resolution. Peers
can observe the connecting IP address. A local P2P bind or loopback RPC address
does not hide outbound connections. There is no supported Laser Tor/SOCKS5,
onion-service, I2P or encrypted P2P transport setting in this release.

Mining rewards, accounts, amounts and transaction relationships are public chain
data. Anonymizing a future connection cannot erase earlier observations or hide
on-chain activity. ML-DSA signatures protect authorization; they do not encrypt
transactions or make a node anonymous. Photonic proof-of-work research does not
change these privacy properties.

## Separate protections

| Protection | What it addresses | What it cannot establish |
| --- | --- | --- |
| Encrypted P2P transport | Passive reading of peer traffic | Hidden IP addresses, anonymous ledger activity, protection from malicious endpoints |
| Tor or I2P routing | Direct exposure of a node's network address to peers | Unlinkable rewards, immunity to traffic correlation, endpoint security |
| Loopback RPC and scoped authentication | Unauthorized remote node control | Outbound network anonymity or a secure compromised OS |
| Encrypted wallet files | Disclosure of keys from copied files while locked | Malware reading an unlocked wallet or public account activity |
| Release hashes and build records | Changed bytes and traceable build inputs | Publisher authentication without a trusted distribution channel/signature |

Bitcoin Core supports [Tor/SOCKS routing and onion services](https://github.com/bitcoin/bitcoin/blob/master/doc/tor.md)
and [I2P through SAM](https://github.com/bitcoin/bitcoin/blob/master/doc/i2p.md).
Its `onlynet` restriction applies to automatic outbound connections; manual
connections and inbound listeners require separate attention. Bitcoin's
[BIP324](https://github.com/bitcoin/bips/blob/master/bip-0324.mediawiki) adds
opportunistic transport encryption with distinct limits on authentication and
active interception. Those are useful engineering references. Neither their
existence nor an encrypted connection makes public-chain transactions anonymous.

## Acceptance gates for a future private networking mode

These are planned requirements, not implemented switches or guarantees:

1. Route every outbound P2P path through one audited SOCKS5 transport: configured
   peers, seeds, learned peers, retries and reconnects. Resolve destination
   hostnames through the proxy. Permit only explicit local proxy endpoints and
   validate malformed/overlong addresses before connecting.
2. Fail closed when the proxy is unavailable, refuses a request, times out,
   returns partial/malformed replies or disconnects. Never retry directly or
   resolve a destination through the host DNS resolver. Bound connection time,
   buffers and concurrent attempts. Apply the policy across restart and network
   changes; reject incompatible configuration rather than weakening it.
3. Disable public listeners and clearnet address advertisement in that mode.
   Add onion services only with explicit lifecycle, authentication and local-key
   handling. Keep RPC local and independently authenticated. Avoid publishing
   the same stable identity across private and public routes.
4. Cover the entire application. Explorer publishing, external links and any
   future updater, telemetry or crash uploader need an explicit routing policy.
   The optional explorer publisher currently connects directly over HTTPS; its
   operator can observe the client IP and uploaded chain data. A P2P proxy alone
   cannot cover it. A strict mode must disable unsupported external services.
5. Prove the boundary with disposable nodes: fake-proxy tests, poisoned DNS,
   IPv4/IPv6 egress monitoring and deny-all-except-proxy firewall tests. Exercise
   startup, discovery, sync, relay, mining announcements, recovery and shutdown.
   Require zero non-proxy network attempts by every application process, with
   the proxy down as well as up. Run Windows and Unix coverage and preserve
   packet/egress evidence. Local unit tests alone are insufficient.
6. Review fingerprinting, persistent identifiers, logs, transaction timing and
   peer-selection diversity. Small anonymity networks and concentrated peers
   increase correlation and eclipse risks. Evaluate encrypted transport and
   ledger privacy separately, with independent review before security claims.

SOCKS5 is a proxy protocol, not encryption or an anonymity network by itself.
Tor and I2P also have their own trust and cryptographic assumptions; do not call
them post-quantum simply because Laser transactions use post-quantum signatures.
Any future transport cryptography needs a reviewed protocol and maintained
implementation rather than a custom key exchange.

## Operating the current beta

Treat this release as experimental, address-visible software. Use an up-to-date
OS, keep control ports local, protect wallet backups and avoid putting assets
of value on Shadownet. Do not publish RPC tokens, wallet files, private service
configuration or unredacted diagnostics. Do not expose RPC to make P2P reachable.
Keep the explorer publisher disabled unless its separate disclosure is intended.

A VPN or OS-level routing policy can change which address is visible, but it
needs independent egress testing and cannot make the ledger anonymous. Installing
a proxy or setting a browser proxy does not route Laser's native connections.
Changing network policy can interrupt mining; plan a deliberate restart after
testing a disposable node instead of changing an active miner in place.

No software can promise complete safety or anonymity against every adversary.
Reports should state the threat model, tested protections and remaining limits.
