# 2026-11-13: the engine's shared audio set, deduped and re-encoded (AUDIO AU9, AU18)

> Written by: Claude (opus-au21)

- AU9: 83 of `sfx/best`'s 152 recordings (2,407,229 bytes) were byte-identical copies of Nalati's own
  `sfx/nalati-grasslands/` files, and `sfx/best/sfx.json` named none of them (only its provenance did). They are gone,
  with their provenance rows. The other 69 and the piano title and three stings were re-encoded with sharddev 0.2.10's
  AU7 encoder (`aac_at`, AU5's caps) and renamed to their bytes' sha1 (AU21), and `sfx.json` and the piano
  `music.json` name the new files: 1.96 MB to 1.22 MB, so the tracked shared set went from 4.48 MB to 1.22 MB.
- The piano `island-*` and `pine-*` slot files are Driftwood's and Pine's mounts, not engine files: they change name when
  those shards are re-prepared with sdk 0.2.10, and that pin updates `music.json`'s two slots.
- Jake's blind A/B of 5 music and 5 sfx pairs is on the read list; a clip he flags goes back to its old file.
- AU18: the package exports `./game/boot/{audio,bytes,versions}.generated`, so sharddev can install the engine's asset
  tables and print a shard's engine music list (`engineMusicFiles`) at build.
