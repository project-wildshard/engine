# Engine binds wire's class descriptors (WIRE-STABILITY WR2)

opus-wire. The entity classes' ids, forms, audiences and order now live
in `@wildshard/wire` (shardfile `packages/wire`). Engine keeps only the
accessors: `bindClass(PLAYER, { x: player => ..., ... })`, typed so a
descriptor field without a binding, a binding with no field, or an
accessor returning the wrong kind fails the typecheck.

- The v0 wire is untouched: `NET_SCHEMA_HASH` stays 3494901458, and
  `test/wire-bindings.test.ts` holds every compiled column equal to the
  frozen cfd6681 tables WS2 vendored (plus `player.name`, which landed
  after it). Class numbers on the wire stay the v0 index until WR5.
- Decoders find a spawn's class by id (`netClassOf`, `initialBitsOf`), not
  by `NET_CLASSES[cls]`. Each class carries its stable wire id (1 to 6).
- `NetCommand` and its admission schemas come from `@wildshard/wire/netCommand`
  now; format re-exports the same file for anyone still on it.
- The layer lint learnt `@wildshard/wire`: a contract package at format's
  rank. Encounter states arrive as strings from the brains, so the binding
  narrows them and throws on an undeclared one, as the v0 column did.
- Codex review (J206): no MUST. Its SHOULDs are in: the layer regex refuses
  a look-alike package (`@wildshard/wirefoo`), and the bindings test samples
  the script, state and encounter accessors, not just their columns.

## WR3: the socket wrapper carries wire v1 unchanged

- `test/wire-socket-routing.test.ts` pairs the real server and client socket
  transports over `ws`: v1-shaped payloads on prefixes 0 and 1 reach only
  the game listener, byte for byte; ready, playtest, voice (8), resume and
  countdown reach only the control listener; ping and pong (2, 3) are the
  wrapper's own. The v1 codec itself is shardfile 918ec19.

## CI caught a pnpm bug: subdirectory deps from an empty store

- The first land's hosted CI failed: every shard's `@wildshard/wire` was
  `@wildshard/format`. pnpm 10.34.9 writes a git subdirectory dependency's
  lockfile entry without its `path`, and a frozen install from an empty
  store (CI's) then installs the repo root under the wire's name. 10.21 and
  11.25 write `path`, and 10.34.9's frozen install honours it. The lockfile
  now carries `resolution: {path: /packages/wire, tarball: …}`, proved by a
  frozen install into a fresh store, and `test/wire-lockfile.test.ts` fails
  if a plain install rewrites it.
