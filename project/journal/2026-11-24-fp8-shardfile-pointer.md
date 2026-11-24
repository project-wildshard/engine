# FP8: the client reads only shardfile

- opus-popin: engine drops src/client/game/shard/legacyPointer.ts (the gridShardfile lift in titleList.ts and manifest.ts). Format's fp8-shardfile-pointer step renames the old key in old originals; Pine (4d210443) and Nine Dragon (579071f6) sources now write shardfile. test/pinned-shardfile-pointer.test.ts fails while any pinned product names gridShardfile (Pine r13 until its next publish is pinned).
