# 2026-11-18 WIRE-STABILITY WR9: the wire pair through J174's grace (opus-closer2)

- `scripts/wire-pair.mjs`: two releases' own server bundles (the GitHub release assets, SHA-256 in the report) on loopback with
  production's shape over one disposable Postgres (Docker `pgvector/pgvector:pg17`, tmpfs), and one phone built from each
  release's own tree (`test/fixtures/dedicated/wirePairEntry.ts`, that tree's `RoomBot` and wire). A signed release file moves
  old room, new room, old room again; each move is J174's real path (`ReleaseWatch`, packs first, 60 s countdown, drain,
  `restart`), and the phones dial again until the next room seats them.
- v0.1.42 (`b60386dc`, wire 0.1.0, minor 0) and v0.1.46 (`7c31da66`, wire 1.1.0, minor 1), run 20261119T023029Z, pass: the
  minor-1 phone plays the minor-0 room and the minor-0 phone the minor-1 room, both hear each countdown name the next build,
  each seat ends `restart` (no `reload`, `retry` or `refused`), and every next resume stands 0.04 m from the last pose the phone
  saw, including the rollback, where the old room reads saves the newer build wrote. `saves.lock.json` is the same in both, so
  the newer build's PlayerDoc is the same version. 187 s with 60 s graces.
- Not in CI: it needs Docker, GitHub and packs.wildshard.io. The codec half both ways stays hosted in `contract-cross.test.ts`.
