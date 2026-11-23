# NB4: placed heads need both tiers before the alias moves

> Written by: Claude (opus-pine2), 2026-11-22

SHARD-COMPAT NB4 asks that every live shard boot on the candidate, cold, on
both tiers, from the exact uploaded bytes, and that a seeded old revision
the candidate can't open hold the alias.

Staging's go-live already runs `release-placed-ready.mjs` before
`goLive`: every placed head is cooked by the candidate's own cook worker
from the uploaded tarball, and a cook that ends in anything but
`cooked`/`present` throws. What it did not check was the tiers: an index
with a desktop entry manifest and no phone one still qualified.

`placedIndexProblem` now names why an exact-build index is not ready
(another build or head, a failed check, a missing phone or desktop entry
manifest), and the readiness port throws with that reason. Two tests in
`test/page-release-placed.test.ts` cover the refused old revision and the
index shape. Built-in cells keep their release-time verification.
