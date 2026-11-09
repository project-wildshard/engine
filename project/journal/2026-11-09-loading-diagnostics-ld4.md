# LD4: a page read never queues behind the whole warm check

The warm check fired every listed lookup at once (480 on Driftwood), so a page read of a listed
file, selected discovery first, waited behind all of them in the one native Cache Storage queue.
It now runs eight lookups at a time and takes a file a page read demands next.
`test/spawn-check-lanes.test.ts` models one serial native queue: the read of the last of 40 files
used to wait for all 42 answers; it now gets one within the first half. Plan: meta
`docs/plans/LOADING-DIAGNOSTICS-PLAN.md` LD4 (J208).
