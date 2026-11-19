# OF9b1: one pointer key, the old one lifted at the door

> Written by: Claude (opus-of9b), 2026-11-19

ONE-FORMAT OF9b wants the manifest to be discovery only, and J365 (7) says `shardfile` is the one key. The page still read
the old runtime-page key in twenty places, each `shardfile ?? <old>`. Every product that writes the old key (Driftwood, Pine,
Nine Dragon, Nalati) also declares a client-plan entry, so the old key always meant "`shardfile`, on a runtime page".

So the old key is now read in one place, `shard/legacyPointer.ts`, where discovery data (`defineAuthoredShard`) and title
rows (`titleMetadata`, `readTitleRows`) enter the page. Past that door every reader sees `shardfile` only, and the type
no longer has the old field. Old uploads still load: the lift is the migration. Two different files under the two keys
are still refused. When every live product has re-published with `shardfile` (the M8 moves), the lift can go.
