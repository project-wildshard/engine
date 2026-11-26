# Tools enter a zone like a player (CHUNK-PARAM-REMOVAL CP12)

opus-nalati2. `scripts/zone-entry.mjs` `enterZone(page, { zone, alone })` writes the Zone Select tap into the tab and
opens a bare `/`, so a tool takes the player's path to the zone's grid cell with its neighbours, and no URL names the
zone (J522, Q4 (a)). The tap's bytes come from `src/client/engine/boot/tapRecord.ts`, which `setTitleArrival` now uses
too, so the title and the harness can't drift; a test pins the harness's save prefix to the game identity's.
`alone: true` cuts the page's inline `ws-catalogue` to the zone's one cell by route: the one-cell world CP10 boots.
`node scripts/zone-entry.mjs --init <zone>` prints the same write as an init script for agent-browser and the WebKit
inspector. Both are package exports, so sharddev and the shard repos import the one copy.

CP13's first half rides along: eleven `src/` unit tests that carried `?chunk=` only as an address to keep (the login
and secure doors, freshPage, the dev control socket, the back guard, the build row, the update boundary and tap pause,
drop recorders, drop exit, navmesh) use another param or a bare address. The other ten test code that still reads the
param (first paint, reloads, stuck offline, load failure copy, loading menu, loading-row ratio, slug path, main menu
deck) and move with their M1 rows.

The save store keeps a key's `data` as the parsed record, so the tap goes in as an object: a JSON string reads back as
a string, the entry refuses it and the page shows the title (the first browser run sat on the title for 180 s). `alone`
writes no tap and puts the zone's cell at (0, 0), as CP10's one-cell world boots with none. Local proof on a preview of
799a6edd9: with neighbours, desktop and WebKit iPhone 13 are inside pine-hollow with 22 cells in 11 s and 8 s; alone,
inside it with 1 cell in 12 s and 6 s; no request carries chunk.

CP16 starts on the local proofs: `enterZone` takes the run's flags (`zoneHome` refuses a `chunk`), online-rig's
`enterPage` takes `{ zone, base }`, and the rig proofs, failmode-proof's play pages and reload-title-proof tap in. The
scripts that drive staging or prod wait for a CP1 build there: switched now, they would break that train's own QA.

CP13 closes now that M1 is in: the last ten `src/` tests take a bare address, or a bare `/` with the tap in the tab where
they need a world page (title-first-paint's `firstDocument` takes a zone, loading-row-ratio writes Brasscap's tap). One
DL21 case read "an arrival for another shard"; with the tap naming the page's zone there is no such arrival, so it now
proves a tap past its minute leaves the page the title. The guard's baseline prunes the ten files.

CP16's split-repair checks tell the two paths apart: a `?chunk=` page on a preview opens the one-shard page, the tap
enters the grid. guardian, stun and wake-loss pass on the tap and move now. hare, whip, held-melee, horse-panic, movers,
nalati-signals, perks, pine-writes and sky-trails find no hare, boar, camp horse or `showRow` on the grid page (they
pass on `?chunk=`), and the worker-client scripts are unproven there, so they stay until their checks read the grid world.
