# The box cook gets its recorder

Meta QA 11-24 row 43 (MA13, SHARD-COMPAT SP1b5b's box half). The engine half (`611fe2bcc`) taught `recook` to run the
record pass first, but the box only ever runs `serve`, and nothing on the box named a recorder, so the pass logged
"off" and every render change cooked every head stale.

Three changes. `serve` now runs the record pass on boot and the boot recook waits for it (`bootCook`'s `before`), while
the poll starts at once, so a new upload never queues behind the recordings. rebuild.sh installs the recorder beside
the cook: `@wildshard/cli` and Playwright's WebKit at pinned versions, with install scripts off, plus the preparation
client that `server-staging-<build>` built from the same commit, so a recording names the cook's renderer. The unit
names them, with Brasscap as the canary, and the record runs in the job's own namespace with only loopback up
(`lo-up`), because `wildshard prepare` serves its page on 127.0.0.1.

The client folder is unpacked over itself for each build. A script never deletes (J358), so old hashed assets stay
until someone removes them by hand. The box deploy rides opus-rel86's next train (J482), and the row is done when a
staging render change ends with every live shard `cooked, prepared by cook`. opus-ma.
