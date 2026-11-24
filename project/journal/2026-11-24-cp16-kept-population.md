# CP16: kept Pine plans run their population rows as written

opus-road, 2026-11-24. A scan of every kept original (API `/api/shardfiles`, 115) found 20 shipping a native plan file;
OF29e3 refused Pine r5, r6 and r10 by name for naming the population family's six hosts. Pine r5 is prod's catalogue head.
The hosts all still exist and OF29e1 proved the six rows run tick for tick as the family stood from the files, so the
step goes back to running them as written. `test/kept-native-plans.test.ts` holds all 20 plan files as stored.

Driftwood r4 and r5 still name OF22c3's island population hosts (retired in v0.1.59, before prod's v0.1.67; their
populations live only in `server/mixed-population.json`, with no declared creatures). Making them run needs a step that
declares their creatures from that file, as Driftwood's own source did by hand (OF22b1, OF22c2); the test names them.
