# OF5: the online route's set stays cached (opus-of5)

> Written by: Claude (opus-of5), 2026-11-13

- The offline title read the wrong route. Shard select's tap remembers the one-shard (`client`) flow before the page knows its
  route; a world that hosts the grid turns the tap into a grid entry, so the device only ever read the grid manifest. The
  title's read-ahead then asked for the `-client-` manifest and its code list, which offline is a file the device never held
  (`offline-proof.mjs` rule `client-manifest-not-warm`). `bootPageMode` now corrects the last pick's flow to the route the
  page booted: grid where the world hosts the grid, `client` on prod's one-cell world.
- A spawn code list (`/assets/spawn/code/<sha16>.json`) is named by its own bytes but did not match the worker's content
  pattern, so it lived in the build's shell and an update dropped it. It now goes to `ws-assets-v1` with the manifests. The
  deck's draft cards (`/drafts/`, which no worker route served) are network first like `/programs/`, and carried on update
  (their names come from the source art, not their bytes, so they are not content).
- A world build (`__WS_WORLD__` in the worker's document) no longer precaches the solo server: `standalone/serverWorker-*`,
  `serverRuntime-*` (3.4 MB) and the server book. A build with no world (preview) still does.
- After an update on the title, the read-ahead of the corrected flow fetches the new build's manifest, code list and files
  online, so the first offline launch after an update finds the route's manifest and code list. The new build's own code is
  still precached only at control (DL1), so a title-only update is OF5a.

Proof (local staging-like, `offline-proof.mjs --mode=offline`, Driftwood, Nalati, Pine): before, Driftwood's offline title read
`driftwood-isle-client-phone-*.json` and its code list (`client-manifest-not-warm`, both failing); after, every deck entry is
green with only telemetry and the release read failing, and the draft card comes from the cache. Resume stays red on
`no-resume`: a staging-like page waits at the seat, never plays, so the site has nothing to resume (OF9). A title-only update
from A to B (two local preview builds, one origin) now passes DOWNLOAD offline on B's code list, which B's title read-ahead
fetched; the entry then fails at `standalone/identity.js`, because B precaches its code only once a page reaches control (DL1).

## OF5a: a title-only update holds the new build's code

A title page never reaches control, so the worker's code precache (DL1) never ran for a build seen only on the title. A title
that stays 10 s now sends `ws:title-settled` (`mainMenu.ts`); `boot/sw.ts` asks the active and the waiting worker for an
update precache, and the worker does it only when it holds another build's generation, so a first visit still reads nothing
(S2). A tap within the 10 s cancels it, and any later navigation pauses it as before.
