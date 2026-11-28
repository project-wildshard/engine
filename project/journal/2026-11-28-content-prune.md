# 2026-11-28: old content sets prune themselves once nothing reads them

- Fix preview PV15. From v0.1.101 no release publishes a content set, but wildshard-packs still holds 263 sets under
  `content/` (2,497,003 objects, 469 GB) and the C8 root leftovers (`shardfiles/<slug>/` and `programs/`, 29 folders,
  1,010 objects, 0.26 GB). Nothing could be deleted today: every channel's deploy-chunks.json retains content-marked
  builds for rollback (explore 4, preview 5, staging 3, production 4), and preview's live page reads
  `content/6f0bef60e640b443/`.
- `src/scripts/content-prune.mjs` promotes the PV15 preflight into src. It lists every set and leftover and says who
  reads it: a live page's content base, a retained build, or a cook index naming a key under a leftover. A format-2 graph
  does not name the set a build read, so one retained content build anywhere keeps everything. It is a dry run by
  default. `--delete` takes only units that a delete run saw unread at least a day earlier and that are still unread.
  It keeps that first-seen time in `content-prune.json` at the bucket root and deletes nothing when any channel read fails.
- `.github/workflows/content-prune.yml` runs `--delete` daily with the packs keys. As retained builds roll off, the sets
  go a day later with no hand step (J505).
- Not stray, so not deleted: the root `assets/<shard>/` art C8 called stray (0.04 GB then, 0.22 GB now). The cook
  still writes it (newest 2026-11-28 01:26 UTC) and its indexes name 2,670 keys under `assets/<shard>/`,
  `assets/models/`, `assets/hdri/`, `assets/horizon/` and `assets/baked/`. It stays with the cook and PV25, with
  `assets/spawn/`, `index/` and `loose/`.
