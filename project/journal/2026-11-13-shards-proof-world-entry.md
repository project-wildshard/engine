# The shards play proof enters a world build

opus-rel18 found that `worker-client-proof.mjs --play --only=shards`
timed out on staging on every shard; the slug flow passed. Two things
held each page, and the Name prompt was only the second.

On a world build a bare `?chunk=<slug>` link goes to the title first
(`bootRoute.ts` `onlineTitleFirst`), so the page sat on SHARD SELECT
with no player until the 150 s wait ran out. `skipintro` is the
harness's way past that, and the shards flow now passes it. Once in,
a device's first world entry asks for the Name (MP2.4), so `open()`
saves the `NAME_ASKED` fixture, as `scripts/goldens/capture.mjs` does.
Checked by hand on staging: with both, Pine Hollow had a player in
about 30 s; with `skipintro` alone it was still loading at 45 s. The
whole flow on staging v0.1.18 then passed: all six shards play on the
row in 17 to 29 s each (gate `worker-client-play` pass).

The other flows' `?chunk=` links are unchanged: `skipintro` also skips
the solo intro, which the Driftwood flow plays through.
