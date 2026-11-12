# page-headers removed its tmp directory before wrangler had exited

> Written by: Claude (opus-flake-ph)

Main ci 43141220801 went red in `test/page-headers.test.ts` with
`ENOTEMPTY, Directory not empty: tmp/page-headers-…`. Its `afterAll` sent
wrangler dev SIGTERM and called `rmSync` on the same tick; wrangler writes
its logs into that directory as it shuts down, so the removal raced the
child's last write. A probe of the same pattern against real wrangler dev
at load 20 failed `rmSync` 1 run in 6 and saw `logs/` come back after it;
waiting for `exit` first passed 12 of 12.

The same shape sat in the `previewServer` fixture: `close()` sent SIGTERM
and returned, and page-headers, pwa-update-cache and preview-telemetry
removed the root straight after. `close()` now resolves once the server has
exited and its callers await it. Every one of those `rmSync` calls takes
`maxRetries: 5`. The three files pass 20 runs in a row.
