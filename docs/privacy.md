# Node privacy and its limits

The published **v0.2.0-beta.4 binaries** do not provide a private networking mode. Shadownet
uses direct peer connections and operating-system hostname resolution. Peers
can observe the connecting IP address. A local P2P bind or loopback RPC address
does not hide outbound connections. There is no supported Laser Tor/SOCKS5,
onion-service, I2P or encrypted P2P transport setting in this release.

The current source adds **experimental, opt-in outbound Tor routing** for a
compatible v3 native runtime. It has not been issued as a new binary release or
qualified as anonymous software. Existing downloads do not gain this feature.
An old runtime fails startup when Tor mode is requested; there is no direct
fallback. Do not reconfigure a running miner to test it.

## Experimental source configuration

For builders with a compatible native runtime advertising
`proxy=socks5-isolated-v1`, a maintained local Tor client, and a disposable app
profile, set `LASER_PRIVACY=tor` before launching. `LASER_TOR_PROXY` defaults to
`127.0.0.1:9050`; `[::1]:9050` is also accepted. Use a dedicated Tor SOCKS port
with `IsolateSOCKSAuth`. Laser does not install Tor or turn the computer into a
relay. Only numeric loopback proxies are accepted; Laser trusts the local
service and cannot establish that an arbitrary SOCKS service is really Tor.

The source routes configured peers, the normal seed, discovered peers and
reconnects through SOCKS5. Names are passed to the proxy, without destination
DNS lookups on the host. The daemon requires stream-isolation authentication,
waits for the complete CONNECT reply before sending Laser traffic, and bounds
negotiation to 60 seconds without blocking local RPC. It closes failed attempts
instead of connecting directly. Fresh per-connection HELLO IDs/nonces reduce
simple identifier reuse; they do not prevent traffic correlation.

P2P listening and own-address advertising are disabled. Remove
`LASER_ADVERTISE`; leave `LASER_LISTEN` unset or use `none`. RPC must use numeric
`127.0.0.1` (default `127.0.0.1:29544` in Tor mode). The desktop uses a separate default chain directory (`shadownet-tor`
for packaged apps, `node-shadow-tor` for development), and native peer
persistence uses `peers-tor.v2`. Wallets are not copied or made anonymous. Do not
reuse an active data directory for tests. An explicit `LASER_DATADIR` is still
honored; it is the operator's responsibility to select a disposable directory.

`LASER_ONION_ONLY=1` additionally requires explicit v3 onion destinations in
`LASER_PEERS`. No public Laser onion seed or inbound onion-service management
is supplied. Persisted and learned clearnet peers are filtered in onion-only
mode. Normal Tor mode can use exits; an exit can inspect and modify the
unencrypted Laser traffic between itself and a clearnet peer. Onion destinations
avoid that exit leg. Tor is not a post-quantum transport.

Explorer publishing is disabled **before loading or migrating credentials**;
saved settings remain intact. Attempts to change publisher settings are
rejected in Tor mode. Chromium network requests are blocked and browser
hostname resolution is disabled; the UI still loads bundled resources and
uses authenticated native local RPC. These application guards are not an OS
firewall. They do not prove that all Electron background traffic is absent.
No updater, telemetry or crash upload is enabled by this feature.

Local Windows checks cover native unit/negative tests and disposable fake-proxy
nodes, including discovery, sync, block relay, proxy down/refusal/malformed
replies, timeout, restart and onion-only filtering. The desktop source matrix
passes on Windows, Linux and macOS. A bounded Linux lab with maintained real Tor
now covers actual onion sync/relay/discovery, stream isolation, HTTPS exits,
IPv6 proxy/destination paths, desktop guards, Tor down/restart and packet/firewall
observation. See the [dated verification record](tor-verification.md), including
the browser's classified, packet-free IPv6 route lookup and the stronger socket-call
gate that remains unmet. Native hosted Linux/macOS jobs are still unverified.
**Windows/macOS real-Tor egress, normal production sandboxing, routed host IPv6,
controlled clearnet Laser peers, the remaining helper/lifecycle paths and
independent review remain binary-release gates.** The mode stays experimental.

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

## Acceptance gates before claiming private operation

These are the full acceptance requirements. The source above implements part
of them; implementation is not evidence that every gate has passed:

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
