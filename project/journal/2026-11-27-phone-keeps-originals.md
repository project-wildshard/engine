# The phone keeps a shard's originals (SF7j)

Nine Dragon's 402x874 phone entry asked `scroll.png` and got two 404s and
an abort; Pine's phone did the same on `rock_moss_set_01_lod.glb`. Both
shards carried a hand-made `.phone` copy beside the original, and
`mountTiers` in `shardCook.ts` dropped the original from the phone set
whenever a same-extension `.phone` copy was mounted. The page never names
a shard's phone copy (the client's `phoneUrl` knows only the engine's own
public bytes), so the phone asked for the original and it was missing.

A phone set now keeps every shard original, model or image. A hand-made
`.phone.`/`-phone.` copy still rides the phone tier only, as before, but no
longer replaces anything: J525 makes it legacy (the cook makes the tier
forms), and Nine drops its last one in its own bulk.

Cook 1.16.0. The golden fixture has no phone copy, so its digest holds.
Proof: `test/phone-copy-mounts.test.ts` (images of three formats and two
models, Pine's name among them), red without the fix.
