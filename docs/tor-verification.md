# Bounded Tor verification

Recorded 29 October 2026. **Linux network evidence is available; a Windows Tor
release is not qualified.** No installed app, running miner or released binary
was switched to Tor. The published beta.4 binaries still predate this transport.

The desktop runtime source was `beef02a5da5afcb1b9e4f9884615b1f564b111f4`,
with a compatible experimental native runtime advertising
`proxy=socks5-isolated-v1`. The local Docker Desktop Linux lab used Debian 13,
Tor 0.4.9.15 from the signed Tor Project repository, Electron 43.8.4 / Chromium
150.0.7871.250, and Linux 6.6.87.2. These results apply to those inputs and paths.

## What was measured

The disposable lab had no host folder mounts, published host ports, real wallet
or GPU. Its root filesystem was read-only. Tor and application children had
zero Linux capabilities and no-new-privileges; Docker's default seccomp policy
remained enabled. A guest-only firewall blocked private network destinations,
allowed the app TCP loopback only, and allowed Tor public IPv4 TCP ports 80/443.
Containment was checked before Tor started. The host's routes, firewall and DNS
settings were not changed.

The final run recorded 42 passing bounded checks, including:

- Real onion-service sync, discovered peers, three tiny CPU regtest blocks and
  block relay, with no public P2P listener on the proxied client.
- Successful isolated SOCKS streams on distinct observed Tor circuits.
- The native SOCKS transport reaching the Tor Project's HTTPS check with TLS
  certificate verification; that service identified a Tor exit.
- A documented IPv6 HTTPS destination through a Tor exit, and onion sync through
  an IPv6 loopback SOCKS listener. The client-to-Tor-network connection used IPv4.
- Desktop sync/local RPC, blocked browser numeric/hostname/new-session/renderer
  requests, disabled explorer publishing, and unchanged saved settings.
- Desktop/local RPC with Tor stopped, no direct peer fallback, Tor restart
  recovery, node restart and separate private peer persistence.

The final external-interface capture contained 11,660 packets, including 5,142
outbound IPv4 packets, all to TCP 80/443 under the Tor-only egress rule. It showed
zero outbound DNS or IPv6 packets and zero capture drops. After intentional
containment canaries were reset, the application/private-destination denial
counters stayed at zero. Native client traces contained no direct peer connects.
These are observations from a bounded run, not a guarantee about all future runs.

## Browser IPv6 route lookup

The desktop made four UDP `connect()` calls to an IPv6 address to inspect the
local route. A datagram `connect()` sets the associated destination; it is
different from a TCP connection handshake. See the [Linux socket API](https://man7.org/linux/man-pages/man2/connect.2.html)
and Chromium's [route-check implementation](https://github.com/chromium/chromium/blob/main/net/dns/host_resolver_manager.cc).

The lab gave that exact destination a synthetic route to **guest loopback** with
a documentation-only source address. The calls then succeeded locally. A
deliberate UDP payload canary was blocked and counted by the guest firewall;
after resetting that canary, the desktop produced zero denied payload packets
and the destination-specific loopback capture contained zero packets, with no
capture drops. This distinguishes a local route lookup from an observed send.
It did not establish an IPv6 exploit or an observed privacy leak.

The stronger, literal **zero non-proxy socket-call gate remains false**. The
report records the exact classified datagram calls separately and rejects
unclassified external calls. It does not silently count the stronger gate as
passed. A tested browser feature setting did not suppress the lookup and was
discarded; no ineffective setting is included in the desktop source.

## Limits and release gates

Cold onion connections and discovery sometimes needed retries. One repeat missed
a 90-second discovery window; later bounded runs succeeded with more time for
normal retries. The native 60-second per-attempt deadline was not extended.
Production mining latency and stale-block effects were not qualified.

The HTTPS exit check used port 443. It does not prove a real clearnet Laser peer
works through an exit on its usual port, 18675. Exit policies can constrain that
path. No experiment was run against the live Shadownet seed.

Windows/macOS real-Tor and OS egress checks, a normally sandboxed production
desktop, real globally routed host IPv6, controlled clearnet Laser-to-Laser
interoperability, GPU/observer/wallet lifecycle and host-network-change coverage,
and independent review remain outstanding. Chromium's own sandbox was unavailable
under the lab's default container restrictions, so only the disposable Linux
fixture used `--no-sandbox`; container containment and default seccomp stayed on.
That fixture option must not be copied into a production launch.

Tor does not hide public mining rewards, accounts or transaction relationships.
Clearnet Laser traffic beyond an exit is still unencrypted. No production onion
seed, inbound onion management or new Tor-capable binary release is supplied by
this record. The source remains experimental; [privacy guidance](privacy.md)
describes its operating boundaries.
