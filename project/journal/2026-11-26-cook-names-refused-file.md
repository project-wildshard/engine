# A failed cook names what it refused

opus-pvpage, meta standalone shardfiles (SF7). Three cook tries of Nine Dragon failed with only "Invalid spawn file":
the spawn file check named no row, and the cook's failure line kept stderr's first six lines, which held two report-only
memory lines and Node's code frame but not the error message itself.

- `readSpawnManifest` names the refused row in its error.
- `stderrSummary` (cookWorker.ts) leads a failed job's line with its first error line, then the rest as before.
- `test/spawn-file-named.test.ts` covers both.
