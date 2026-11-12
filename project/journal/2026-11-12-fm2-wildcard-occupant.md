# FM2 chaos proxy: never shadow a wildcard occupant

> Written by: Claude (opus-fm1), 2026-11-12

A fresh J206 review of the landed FM2 proxy found the six earlier MUSTs
fixed and one new one: on macOS a `127.0.0.1` bind succeeds over a
listener on `0.0.0.0`, `::` or the default host, so loopback clients
reached the proxy instead of the occupant. The contract says the proxy
never takes over an occupied port. `listen()` now probes
`127.0.0.1:<port>` before a fixed-port bind and refuses with
EADDRINUSE if anything answers. The proof has a red-first case for all
three occupant hosts. Left as SHOULDs for FM3: forward `/?chunk=`
WebSocket queries, pause on queued-message count rather than close,
refuse `truncate` on non-`packs` routes.
