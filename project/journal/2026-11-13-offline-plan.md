# The OFFLINE plan's last rows (opus-offline)

> Written by: Claude (opus-offline), 2026-11-13

Meta `docs/plans/OFFLINE-PLAN.md`, J298 (Jake 2026-11-12: "The preview build should have a different cache ... staging and
prod should never try to play offline versions ... Load into the world. And then have a really hard time moving around").

- **OF12, a cache per channel.** One bundle serves every channel and the deploy stamps `__WS_WORLD__`, so the channel is read
  at run time (`cacheNames.ts` `cacheChannel`, the same rule as `homeIconChannel`). Production keeps `ws-assets-v1`,
  `ws-builds-v1`, `ws-shell-v3-<build>` and `ws-content-v1`: renaming them would cold-start every player. Preview and staging
  put the channel after `ws-` (`ws-preview-assets-v1`), so production's `ws-shell-` prefix test never matches another
  channel's shells. Pages read `assetCacheName()`; the road workers, which have no stamp, are told the channel by the page.
  The build still bakes production's name into `spawnManifests.cacheName`; the page maps it to its own. A staging or preview
  worker deletes its origin's pre-OF12 caches (production's names) once, unless a production worker marked the origin
  (`ws-production-mark`), so a staging phone doesn't keep two copies. `offline-proof.mjs --one-origin` serves preview, then
  staging, then preview again on one origin and one profile.
- **OF9, into the world without a seat.** `clientWorker.ts` awaited the online shell's `booted` (the seat) before the world
  showed, so with no backend the card sat at Worker boot until the stuck-step watch. A world build now waits for the seat only
  `SEAT_GRACE_MS` (1.5 s; none when `navigator.onLine` is false, `seatGrace.ts`), then opens the world unseated: the first-rows
  waits are skipped, the shell keeps dialling, `ready()` is said early (the online shell already held it until a seat), and the
  seat, when it comes, places the player (GO5). A seat inside the grace keeps QA row 29's reveal at the saved place.
