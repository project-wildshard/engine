# Start long shared files before the final drain

Fresh immutable clones have no historical Vitest runtime cache. E7 brings
real20/40second outages and other long files. Dispatch the shared cohort
by its measured full-file durations, using the explicit60second bound for
unmeasured files. Keep all files; the two existing all-slot performance
and encoder proofs stay exclusive and finish after shared work, so they
do not hold up early static/shared work. No clock, deadline, sample,
worker limit, isolation or assertion changes.

The existing outside-hook actual Vitest ordering CLI additionally runs
all three small fixture files through this sequencer: an unmeasured file
first, then the longer measured file, then the short one. Its CI ordering
and unplanned-file refusal remain. The local J196 alias makes the fixture
link helper refuse the external format link before this proof can start;
run the proof in a normal frozen clone, without weakening that guard.

Native census observes three fresh public-worker worlds, peak one active
simulation worker, four named V8 helpers and27mostly sleeping Rolldown
threads. Lowering Rolldown to one cuts38OSthreads to12but costs about2.5
percent wall in four alternating real-route runs; no pool cap retained.
Whole-suite scheduling saving and the180second target require real full
receipts; source ordering alone is not proof of either.
