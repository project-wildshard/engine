# MG10: the engine moves to shard-format 0.37.1 (memory epoch 8)

> Written by: Claude

Lane mini-pinemem5, branch `plan/mg10-format-037` (MEMORY-GATES MG10).

Format 0.36.0 refits the offline phone estimate to an every-zone sweep on engine `0af7ccd8` (memory epoch 8): every
pinned zone's estimate falls except Far Reach's playing (944 -> 1,000 MB, under its envelope; format's only refusing
memory line is 1.5 GB). 0.37.x steps the J412 ratchet down to those readings: Nine loading 1,929 -> 1,688 MB, Pine
1,648 / 1,982 -> 1,627 / 1,807, Nalati loading 1,731 -> 1,582; Driftwood's loading row and Nine's playing row go. 0.37.0
took Nine's and Pine's rows from the offline estimate and this repo's `cook-built-shards` full check read them 1-6%
higher, so 0.37.1 takes the full-check readings. All 27 pins admit and `cook-built-shards` passes. No engine code or
ledger change.

Not yet 0.38.0 (J426's armed list, Driftwood armed): the pinned Driftwood product (revision 4) carries an epoch-1
runtime reading, which an armed zone refuses with no override; engine pins 0.38.0 once a current Driftwood is pinned.

Land: J381 hatch `SKIP_CHECK=1`. The full gate's failures (motion traces, guardian temperament, elite native kernels,
ground review, json declarations, preview leases, browser adapter, gate-related tests) fail on clean main `d0fd6e62`
too (mini-nalatimem1 confirmed; codex-tc48 is fixing them). The pin's own tests pass: cook-built-shards,
shardfile-full-check, wire-lockfile, phone-memory-line. The wire lockfile entry the pin's install rewrote is restored.
