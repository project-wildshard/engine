# The cook makes every KTX2 (SF15)

Lane opus-cookktx2, meta standalone shardfiles SF15 (J525). A shardfile
carries one image per texture from now on, and the cook encodes the KTX2.
First the shape other lanes read: the KTX2 table the cooked index carries
(`src/shared/game/shardfile/cookedKtx2Table.ts`), per tier a source URL to
the cook's file, so the index writer and the client build against it now.
