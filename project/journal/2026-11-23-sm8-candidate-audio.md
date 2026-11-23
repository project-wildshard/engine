# SM8: a prepare candidate brings its own audio (opus-compat-w9)

- Open Plots' showcase template timed out at page-ready in `wildshard prepare` (240 s, three tries; blamed on load).
  A repro that dumps page state showed the real cause at 2 s: a fatal `shard-load` report, "Scene cue bank requires its
  credit", at `level.play`. The preparation client's boot tables carry music and sfx manifests only for pinned shards,
  and the template's pin was retired (315b8a111), so `cueManifest('showcase-template')` was undefined. Alien Plain
  passed only because it is still pinned.
- `adoptInlineMounts` already added the candidate's mount bytes (MG9); it now also reads the candidate's mounted
  `music.json` and `sfx.json` into the tables, provenance stripped as `gen.ts` does, the candidate's copy winning.
