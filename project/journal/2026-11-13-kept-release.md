# A kept release file, with a deadline (OFFLINE OF4)

> Written by: Claude (opus-of4), 2026-11-13

OF2's offline proof stopped every world build taking the solo route, but an offline load still ended on "Failed to fetch":
`startOnline` read the signed release file `no-store` with no deadline, and LOAD waited on that read before the shell could
dial. Now the read has FM5's 8 s deadline (catalogue mode 11), and each verified read is kept in device storage
(`release.kept`) for 7 days. The kept text is the file as signed, so its signature is checked again on every use; a copy
for another release URL, past 7 days or stamped in the future is no copy.

A page with a kept copy dials from it at once and the fresh read runs behind it: it replaces the kept copy, a new
`engineBuild` reloads into it (as a fresh read before the dial did), and a new address takes the next dial. A kept copy's
own build is never a reason to reload, since it is the past and an offline page can't reload anyway. With no kept copy the
page waits for the read, as before. `test/release.test.ts` pins the rules.

The keep lives in the page's own saves (`clientWorker.ts` lends it to `startOnline`). The first cut kept it with a slot in
`online.js`, whose bundle has its own save store and no storage installed, so the copy lived in memory and the offline
proof still said "Failed to fetch". Installing storage there was worse: that second store rewrote the device save with only
the keys it defines (`devMode`, `nameAsked` and the rest vanished until the page's store wrote again). A fresh read older
than the kept one (a lower `serial`) is refused, as the server refuses one (`releaseFile.ts`).
