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
