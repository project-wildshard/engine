# OF2: world builds never take the solo route (opus-of2)

- J298 (Jake, 2026-11-12): staging and prod play online only. OF1's offline proof showed why the old gates hurt: going offline
  flipped the route, so a resumed grid page booted the in-page server (`standalone/identity.js`, `/assets/spawn/server/`), files
  online play never downloads, and ended at "Missing server input" or the title.
- `serverRoute(world)` now reads only the world stamp: a world build is `'online'` for every page; `earlyStandalone` is
  `world === undefined`. `opensShard` is gone (OF3 writes its own card rule), and `clientWorker` no longer asks the world word or
  `worldHostsGrid` to pick a server.
- The one thing the world's word still decides is the page: a grid page whose world is known to host one cell (the check in
  time, or the device's kept answer; no word takes the grid, J300) calls the grid's new `reshard`, which travels to that cell's
  one-shard page (`pageEntry.ts` `reenterShard`). That page then joins online. A page left during the check goes nowhere.
- A page whose browser keeps no storage now joins with a page-only device id instead of playing solo.
- Known cost, on purpose: Brasscap's Developer-only one-shard page now joins the world, which seats it in a grid cell (the
  bounce `ba88ac9a` papered over with solo play). OF3 marks such cards "Not in this world yet".
