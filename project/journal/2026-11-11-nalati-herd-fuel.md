# Nalati revision 5: the herd fuel fix (meta SENTRY-TRIAGE S3)

Nalati's herd group step trapped as `RuntimeError: unreachable`
(`WILDSHARD-GAME-82`). It was out of fuel: a herd near the map's edge
picked graze spots out of bounds 16 times in one call, and every
`Read.context` read paid for that function's whole body. shard-nalati
`ceb1854` fixes it, with `82ac1ff` adding the review's points to the test.

Cooked from shard-nalati `82ac1ff` and prepared in phone WebKit on a
`WILDSHARD_PREPARATION_ONLY` preview of `2e6b4856` (renderer `355733d7`,
fence 388, 100 programs). Uploaded with the creator key as revision 5
(`7d23cad0`), flipped live, and pinned here; the save pin follows. The
Ring 1 slice was recut, and the head and the slice are on the `pins`
release. Phone first download is 38.55 MB, down from 41.36: the shard
now ships ASTC6 phone textures under its own mount, so the boot tables
in `bytes.generated.ts` moved with it, and the shard-size baseline is
latched at the new size.

The cook reads `1 current, 27 stale, 0 none`. `loading-card-proof
--shard=nalati-grasslands` passes in Chromium and WebKit with 0 faults.
A headless session of 20,000 ticks ran 247,143 herd segments with 0
faults.
