# lint-all's overlap fixture races fs.watch (lane opus-failmodes2)

`test/lint-all.test.ts`'s "combined CI command overlaps" case gives
each fake `pnpm` 2 s to see the other's `.started` file, and it heard
of that file only through `fs.watch`. On macOS a watch starts late
(FSEvents), so a file written just after the first check was missed
and the fake exited 70. It failed 5 of the push queue's last ~95
gates on 2026-11-10, at loads from 14 to 69, breaking whole batches.
The fake now also polls every 25 ms. The assertion is unchanged: both
checks must still start before either finishes.
