# SB41: the pagehide save staled the GPU recovery

fd434263 made an online page save the pier as a `cell` place, and
staging v0.1.40 (20de8e5d) still put the player on the road at (285,0).
A headless staging run (`tmp/buddy-engine/sb41-diag.mjs`, the S22 proof
with a storage dump at each document start) showed why. The reloaded
page found a good record: `grid.recovery.once` named Driftwood's pier,
`{kind:'cell', x:0, y:1.22, z:-194}`, stamped `…215528`. But
`grid.last-played` and the shard's `platform.grid-position` held the
same place stamped `…215850`, 322 ms later.

That later write is the online worker client's pagehide save:
`shell.save()` and then `grid.saveLocation()`. `validSaved` holds the
record's `saved` to the instance's exact save, `at` included. So a newer
stamp made the record stale, `consume` answered `fallback`, and
`safeGridRecovery` placed the home cell's road lane: pitch / 2 + 3.6 =
284.85.

Offline this never happened, because `checkpointsSuppressed` stops the
checkpoint after a prepared recovery. On a wire that flag is set from
`bindWire` on, and `saveLocation` never read it. A dedicated
`recoveryPrepared` fence now refuses `saveLocation` and `serverPlace`
once `prepareRecovery` has written its record. This is what the comment
there already promised: a later pagehide or timer must not replace the
location.

I kept the exact-match rule in `validSaved`. It is how a record proves
it names the instance's real save.

The test (`test/grid-gpu-recovery-online.test.ts`) prepares from the
pier, advances 322 ms, saves again the way the worker does, and still
resumes on the pier. The staging re-proof waits for the next release
that carries this.
