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
