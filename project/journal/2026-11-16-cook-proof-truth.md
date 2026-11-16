# Cook proof truth (TC31)

> Written by: Claude (mini-push2, Mac mini)

- Meta TEST-COVERAGE TC31, J370 (4): `unmeasured` passes, and a proof
  that walked 0 lanes is never `proved`. The check already returned
  `unmeasured` for an empty walk; the cook index now asks
  `indexProof`, which says `proved` only for ticks, lanes and steps
  all above 0, since the report crosses the job's process boundary
  as JSON. `test/cook-proof-truth.test.ts` has one test per rule.
