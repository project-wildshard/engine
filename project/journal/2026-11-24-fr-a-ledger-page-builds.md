# FAST-RELEASE FR-A1: page builds restore ci's ledger encodes

- opus-relaudit (meta FAST-RELEASE, the "every other release path" milestone). preview.yml, server-release.yml's
  devserver-client and explore-release.yml build the full game but restored no spawn parts, so each re-encoded every
  q11 part cold. Preview hit heavy-lane's 1800 s cap 4 runs in a row on 2026-11-24 (preview.wildshard.io stuck since
  18:53 Cancún's build); the devserver client took 29 min median (6 of 25 runs red); explore's build was 53 of 54 min.
- Each now restores ci's full-ledger key first (FS30's pattern). The guard counts page-release.mjs and
  devserver-client.mjs as full builds and refuses a full-game job that restores no ledger key at all.

## FR-A2: the cook publishes its packs in parallel

- The box cook's `publish` PUT one object at a time after the cook finished: the journal shows Pine's
  `phases`-to-`cooked` gap at 1,100 to 4,580 s (Driftwood and Nalati about 1,100 s), and the one cook queue waits behind
  it ("ahead of 28 waiting" after a release re-cook). Each order group now goes 16 PUTs at a time, groups in order
  (parts, rest, spawn, then loose, then the index). `test/cook-parallel-publish.test.ts` proves the order, the bound and
  that a failed PUT stops new ones and fails the publish. Live once the cook moves to a release carrying it.

## FR-A12: the content copy (opus-relaudit, 2026-11-24 evening)

With the ledger restored, preview 45511749250 ran green in 24 min, and 18.7 of them were the content publish: a HEAD
per file (9,742, all 404 on a new set) and then 9,680 server-side copies 8 at a time. A set with no key yet (one S3
list, `MaxKeys: 1`) now skips the HEAD pass, and copies run 24 at a time (`COPY_WIDTH`). Uploads stay at 4: 11-15's
429s were on uploads, and a refused copy already falls back to an upload.
