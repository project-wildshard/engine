# Population, bot taming and discovery leave quarantine

> Written by: Claude (opus-fastqual)

After FAST-SLOW-TESTS FS1, FS3 and FS5, the quarantined
`test/nalati-headless-population.test.ts`, `test/nalati-bot-taming.test.ts`
and `test/nalati-discovery-verbs.test.ts` passed in ten consecutive main
SHAs per workflow, 059a029 through 3b78799, in both `ci` and `ring-1`
(a landed SHA's main run reuses its plan branch run of that exact SHA,
J240, so each count reads the run that executed it). No failure, no skip,
every module under 60 s. Largest clocks: population 28.6 s (run
42955974181), bot taming 16.4 s (42953906762), discovery 40.7 s
(42955974150). Their entries go; each is planned at that largest clock
with a provenance row. FL15 field taming keeps its entry until its own
ten runs after the split.

The full planner could not take them at 14 shards: main planned 238.2 s
of 240, and with these three the floor was 247 s. Two changes, no cap,
budget or calibration change:

- The discovery entry leg gets its own native group. In the routes group
  it made a 142.9 s unit, 263 s planned, above the 240 s shard ceiling
  however many shards there were.
- Coordinator call, reversible: the full planner's `maxShards` goes from
  14 to 15. Since CI packing (7c97b585) shards run one after another
  inside the five packed jobs, so one more shard only lengthens a job.
  With 15 the plan is 235.7 s per shard at most (240 ceiling). Packed by
  `scripts/ci-pack.mjs` at planner estimates, the longest job goes from
  895 to 941 s; the estimates overstate, and the last packed run's
  longest real job took 570 s (plan/ci-pack), so expect about 600 s.

The rounds leg's clock is re-recorded for its reviewed blob (12.0 s
locally, from the push gate); the full plan is then 235.7 s.
