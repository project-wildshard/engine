# Driftwood long session leaves quarantine

> Written by: Claude (opus-fastqual)

After FAST-SLOW-TESTS FS2 (51d3d58, cdc7d9e), the quarantined
`test/driftwood-long-session.test.ts` passed in ten consecutive main SHAs
per workflow, 059a029 through 3b78799, in both `ci` and `ring-1`. Since
J240 a landed SHA's main run reuses its plan branch run of the same SHA,
so each count reads the run that executed that exact SHA. Every run
passed with no skips; the full module took 3.5-6.9 s against the 60 s
budget.

This removes its entry from `test/quarantine.json`; the other four keep
their records and first J200 extensions byte for byte. The planner
weight replaces the stale 76.5 s with the largest qualifying clock,
6.880 s (run 42955974181, artifact 13827581370), with its provenance
row. No case, cap, budget or planner rule changed.

FL11 population, FL12 bot taming and FL13 discovery also have ten of ten
clean runs (largest 28.6, 16.4 and 40.7 s), but the full planner can't
take them: today's plan is 238.2 s of 240 at its 14-shard maximum, and
adding them lifts the floor to 240.5-243.2 s even with the discovery
entry leg in its own native group. This file alone plans at 238.9 s.
The rest wait on a planner capacity call, not on their own clocks.
