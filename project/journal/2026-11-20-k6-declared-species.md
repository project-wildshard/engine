# K6: declared-species pages on the grid

- opus-k6, v0.1.56 staging QA K6 P0. Sunscar Dunes r5 has no
  `species.program` (OF19d1); its declared species were registered only
  by the standalone data client's kit (OF19d2), so on the grid
  `population.homes` refused at finish and the cell never left the
  loading card. The OF19d2 registration is now
  `shardfile/declaredCreatures.ts`, run by the data client and by a
  new regional resident `kit` hook in the entered kit window. Proved
  on v0.1.56 + this diff under the staging origin: Dunes plays in
  8.8 s. Nine r5's stall is separate (stale client-plan entry in its
  manifest; Nine r6 drops it).
