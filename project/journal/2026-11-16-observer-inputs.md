# Bound authenticated release observation

> Written by: Codex
> State: built locally, 2026-11-16; E7.2c.b.1, hosted proof owed.

The staging observer must verify a signed release, its actual artifact hash,
and matching private health before constructing any client. Reuse the real
release reader and retired-route guard. Bound every streamed response,
overall deadline and cancellation; only eight authenticated immutable
artifact identities are cached. Signature/schema/hash/target failures are
fatal, ordinary network failures retry within the command deadline.

Fifteen signed HTTP controls cover real Ed25519 and hash checks, metadata,
old health, startup/no seats, oversized chunked bodies and stalled reads.
Actual staging94 f8ff9bd9 matched the signed release/artifact/private health
in a read-only control. No server settings, release or live socket changed.
Normal lint/types and the route guards pass. No escape hatch used.
