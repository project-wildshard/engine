# Brasscap corpus copy (J506)

- opus-popin: engine now keeps a pinned Brasscap Mesa export at test/fixtures/corpus/brasscap-mesa/ (shard-brasscap 4a6ff4e, status earlyAccess), written by scripts/brasscap-export.mjs, the twin of shard-format's src/tools/brasscap-export.ts. The GLB blobs stay out (19.6 MB, five over the 1 MB blob cap); the pin keeps the whole build's tree hash, so it matches shard-format's copy. test/brasscap-corpus.test.ts checks the folder, the sections and the player status.
