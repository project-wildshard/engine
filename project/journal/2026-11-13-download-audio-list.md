# 2026-11-13: DOWNLOAD fetches exactly the audio a shard names (AUDIO AU19)

- `test/download-audio-list.test.ts` runs the real spawn-manifest cook (`writeSpawnManifests`) over seven pinned
  products (Driftwood, Pine, Nalati, Nine Dragon, Open Plot Alien Plain, Sunscar Dunes, Far Reach) and reads back each
  `client-phone` and `grid-phone` manifest. Its `/assets/{music,sfx}/**` rows must equal AU18's derived engine music,
  the default `best` set's boot effects and the shard's own audio mounts, with no extra and none missing; the piano
  rows are AU18's list alone, no row appears twice, no folk or orchestral folder appears, and Dunes and Far Reach have
  no engine music row. The test bakes this checkout's boot tables itself (`serialize-asset-tables.mjs`, 0.2 s) into a
  tmp build root, so it needs only the pins (`pnpm pins`, as CI's test jobs have), never a prior app build.
- Today: Driftwood 91 (6 piano, 69 best, 16 own), Pine 77, Nalati 161, Nine Dragon 10, Alien Plain 8, Dunes and Far
  Reach 0. No manifest bug turned up.
- The cook's parts take minutes of q11 encode over these products, so `BuildHalf.filesOnly` writes the manifests' lists
  alone (no parts, no server packs, wire size = raw size). The file lists don't depend on packing. Module mocks are
  banned in tests (E422), hence a seam rather than a stub.
- Both directions were proved by breaking the cook: one extra piano file in Driftwood's manifests failed Driftwood, and
  dropping the death sting failed every shard that plays it. Each test also checks its comparator catches one added
  and one removed row on the real manifest.
