# The lean move's strays, and the guard that finds them (opus-lean91, meta QA 11-25 row 91)

- fps/table.mjs read its method sources from `root/scripts` and release-proof-proof.mjs made `producer/scripts` then
  wrote `producer/src/scripts` (both named in row 91). The new repo-kit check (2172d3e, check e: moved) found the
  rest: VPS proofs whose ROOT climbed from the old depth (their OUT landed in src/tmp), crossroads-rig staging,
  rooms-watch's LaunchAgent, source-generators' title and ktx2 imports, heavy-lane's e2e watcher command, the
  precommit-source child-loader rule, path regexes in sort-sides, check-spelled-paths, committed-fast-checks and
  precommit-jobs, temp checkouts in five proofs and four commit fixtures, and lint:kit's dead `scripts/**` ignore.
- Kept on purpose, each marked `script-paths:`: meta's own scripts/ in two tests, the VPS box's scripts folder, the
  chunk guard's old-spelling keys, and precommit-source-selection.py (a dead fixture no test runs).
- The guard runs in lint:game, so the push gate refuses the next stray; the baseline stays empty.
