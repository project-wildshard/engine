# Ledger facts in a grid data cell

> Written by: Claude (opus-gp123, SHARD-SOURCE SS-GP2), 2026-11-18

A one-shard page records each fact the wire grants (`wirePage.facts`)
into the page's profile `Ledger` under the shard's identity and refreshes
progress. A grid data cell recorded none, so a race finish or a quest
fact filed on a grid cell never reached the ledger or the progress view.

`shardfile/wireFacts.ts` is now the one place both sides call
(`placementLedger`, `recordWireFacts`). `grid/dataCellFacts.ts` installs it
per stay under the copy's own instance and shard, and only while the
wire is that cell's, so a receipt mid-crossing is never recorded under
the wrong copy. The one-shard path on a grid page (the home, an entered
runtime cell) now records only while the feet stand in its own cell:
before, a copy of the home's own product would have had its fact
recorded twice, once under the home's instance. A copy that maps no
fact to a reward builds no ledger.
