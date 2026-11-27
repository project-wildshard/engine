# public/ verdicts (meta standalone shardfiles SF1)

- `src/scripts/public-verdicts.mjs` gives every file under `public/` a
  verdict after a pins install: engine (`public-engine.json`, what SF12
  keeps), delete (`public-delete.json`, SF13's list) or zone (the slugs
  that wrote it, name its URL, name its set by id, or sit in its path),
  with its source. `--check` and the test fail on a file with no owner.
- Local pins install at e33f409e6: engine 117 files 9.4 MB, zone 1,316
  files 574.9 MB, delete 29 files 21.0 MB (art only). The plan's 146 /
  597.4 / 36 came from preview's content set before QA 11-26 row 14
  took the trailers and the rig out (-12.2 MB of delete), so they don't
  match to the MB; the verdicts are per file and the lists are the
  source of truth from here.
- Engine: practice dummies, piano, title art, the hatchet, pickups,
  clouds and ripples (published by pins today, not tracked: SF12 has to
  track them), UI sounds, road surfaces, and the shell (fonts, icons,
  basis). Delete: skin-fixture, forest_leaves_02, roof_planks, a stray
  driftwood lm-ao KTX2, the two qwantani `.hdr` skies that have pairs.
- Sets a zone names by id (groundLayers, prop sets, sky.hdri) count as
  that zone's, which is what found the shared ground sets.
