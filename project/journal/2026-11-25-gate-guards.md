# Gate guards (opus-guard)

- QA 11-25 row 53: 5068a7365 passed the push gate because tsc -b trusted a cloned, warm cache older than the new
  untyped scripts/trailer/capture.mjs (TS 7.0.2 misses a new root older than the buildinfo). The gate now touches
  every pushed file before its typecheck; a forced full typecheck was 62 s, too slow.
- QA 11-25 row 54 follow-up: main-watch read Lane: with %(trailers), but main-push writes Lane: in its own
  paragraph above Assisted-by, so git never saw it (5068a7365 reads as no lane). It reads the whole body now.
- QA 11-25 row 58: main-push pushes only its own lane's commits (git replay past the others, which stay on local
  main and are named); land refuses a commit naming another lane; the commit-msg hook writes Lane: from
  WS_LANE_NAME. ALLOW_CARRY=1 is the J381 hatch back to M1 carrying.
- FAST-RELEASE FR-A25: release-cook hardens before the cook move (the move runs the box copy of rebuild.sh, which only
  harden refreshes), then reads the cook unit (systemctl show) against rebuild.sh and stops on a gap. The box after
  v0.1.91: AllowedCPUs 13-15, CPUWeight unset, MemoryMax 8G effective (unit file 12G from 11-10, overridden by
  the drop-in); rebuild.sh unit now says 8G too.
- QA 11-25 row 60: staging-qa holds desktop-gpu.lock (a lockf child) while its legs measure; new heavy-lane leases
  for full Vitest and builds wait while it is held (push gates and land do not, so pushes keep flowing); every K
  timing carries the 15-min load, and over 0.75 x CPUs a miss reads "noisy, rerun" (P2) instead of a hold.
- QA 11-25 row 61 (engine half): shard-sweep.yml runs scripts/shard-sweep.mjs every 20 min with the nightly app.
  It reads each shard repo's published.json, tags a missing tag, and starts shard-pin for an unpinned revision
  no pin run has tried (titled by run-name). Its first dry run found sunscar-dunes r9 and mirror-salt r8 unpinned.
- Main red 45676829545 (row 58 follow-up): main-push run with no lane name (CI, Jake) sends unnamed commits; a named
  lane still leaves them. push-known-red's fixture commit names its lane.
- QA 11-25 row 62: a kept K1/K2 profile leaves the world (EXIT TO MAIN, the clean quit) before its browser closes, so
  the next attempt finds no held body; a timing whose leg reloaded on "online seat elsewhere" reads "harness, rerun" (P2).
- QA 11-25 row 64: shard-pin waits (40 min) for the head's packs on the build its channel serves a new page, then
  refuses naming the build (scripts/pin-packs.mjs). Live 19:35 UTC: Pine r18 has none for staging's 75fd4b97.
- ZONE-SNAPSHOTS ZS7: the staging Zone Select snapshot drops Ink & Cel Valley's two hidden cards (live staging names
  neither retired zone after the API prune); test/retired-zones.test.ts keeps them out of tests, scripts and sources.
- QA 11-24 row 15 (J521): land --done logs its local branch delete to ~/.cache/wildshard/deleted-branches.log and deletes
  origin's copy of the plan branch when its tip is on what landed (under a lease), logged too. main-push runs only on main.
