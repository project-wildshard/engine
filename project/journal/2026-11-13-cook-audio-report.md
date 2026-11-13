# 2026-11-13: the cook reports each shard's audio and its DOWNLOAD share (AUDIO AU6)

- `src/cook/game/audioReport.ts` turns each shard's cooked client manifests (phone and desktop) into a row: recordings
  (the shard's own and the engine's shared files, AU1's list, read from the manifest itself, never re-derived), their
  MB on the wire, the manifest's DOWNLOAD MB and the share. Lines from J303: green to 6 MB, amber over 6, red over 10.
  `writeSpawnManifests` prints the table on every build that lists any audio.
- An overrun never fails anything (J295). `test/audio-report.test.ts` cooks every pinned product (files only, through
  `test/filesOnlyCook.ts`, which AU19's test now shares) and `annotate`s an `AMBER audio shard=… tier=… bytes=…` line
  per shard over 6 MB. The CI budget reporter (`scripts/engine-ci-budget.ts`) prints them in one `::warning` (GitHub
  keeps 10 a step) and adds them to its report's amber list, so the timings job repeats them when a main run reused its
  plan-branch run; main-watch reads the tests jobs' annotations into `main AMBER <sha> audio <shard> <tier> <MB>/6.00 MB`. A shard over
  10 MB is still AMBER on main; the receipt names the red line.
- main-watch's io now hands back the annotation text (`annotations`) and parses both AMBER kinds itself.
- Today (files-only cook, so DOWNLOAD here is raw bytes; audio is served as is): every shard is green. Phone audio:
  Nalati 5.47 MB (161 files), Pine 4.73 (77), Driftwood 3.62 (91), Nine Dragon 2.60 (10), Open Plots 1.22 to 1.49 (7
  or 8), Dunes, Far Reach and the templates 0. The plan's 14.66 MB (Pine) and 8.66 MB (Nalati) were source folders; the
  download holds only the boot set and fence audio.
