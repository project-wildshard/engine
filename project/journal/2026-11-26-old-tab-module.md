# One old-tab module: the updated card, the pill, the day logout

Fix-preview PV11 and PV12, opus-pvpage. `src/client/engine/boot/oldTab.ts` owns what an old tab sees.

- A code file, pack or book this tab's build names and the server no longer has goes to
  `oldTabMissed` (browserChunkRecovery.ts): a failed chunk when `/version.json` names another build, and
  RL8's `reloadIfStaleBuild` for content reads. One card, "Wildshard was updated. Reload to keep playing.
  Your progress is safe.", one Sentry event (`screen: old-tab-updated`, an error, not a warning), and one
  reload behind the RELOADING cover. The reload spends the session's one claim, `boot.force-cache.j383`,
  shared with forceUpdate.ts; with it spent, or a world running, the card keeps a Reload button and the
  tab never loops. The `stale-reload` screen retired into it.
- forceUpdate.ts's retired-client page shows the same card and event.
- The Update pill's player text is "Update available"; it shows on the title and pause menus only.
- PV12: `installDayLogout` (entry.ts) signs a tab out at 24 hours open, with a card, a `day-logout`
  event and a reload 4 s later; a slept laptop logs out on its next visibility or pageshow.
- index.html's inline stale-build screen stays its own: it runs when the entry never loads, before any
  module can.

Guards: oldTab.test.ts, update-pill.test.ts, stale-build-reload, the screen-reports walk.
