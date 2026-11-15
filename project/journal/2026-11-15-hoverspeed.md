# Hoverboard speeds and the boost word (opus-hoverspeed)

Meta QA 11-15 rows 8 and 9.

- Row 8: Jake felt the board's speeds changed with the MMO server. The agreed
  speeds are G39/G60 (14 m/s in a shard, 30 on the road) and G540 (Developer
  boost 4x in a shard = 56, 2x on the road = 60; road-class padding cells run
  road speed). The page and the in-page server (GridSimulation) already ran
  them; a dedicated worker's cell and road rooms installed no board cap and
  refused boost (E7.7's "never installed"), so online every case ran 14 while
  the page predicted 30/56/60. `gridBoardLimitAt` (shared/game/grid/rules.ts)
  is now the servers' one world-feet read (the page computes the same through
  `gridBoardLimit`); `runCells` grants the boost unless `WORLD_BOOST=off`.
  Review: the server can't tell a Developer page from another, so it trusts the
  bit; the kill switch is the reversible half. Placed cells (SA33) still drop
  `speedClass` in `gridAssembly()` (pre-existing): such a road-class cell runs 14
  on the server and 30 on the page.
  `test/dedicated-board-speed.test.ts` drives bots over real sockets: 14/14/14/14
  before, 14/30/56/60 after.
- Row 9: Jake wants the left-edge HOVER tab to say BOOST while boost is on
  and the word gone while it is off. `mountBoostLook` adds the word under
  HOVER (`.ws-hover-boost`, shown only while boost is shown); a keyboard page
  has no tab, so `mountBoostTag` stands the same word alone on the left edge
  (`.ws-boost-tag`) while boost is on (my pick, so desktop says it too).
- The probe (`scripts/hover-speed-probe.mjs`) on a local build showed the
  in-page server had the same drift on the road: `GridSimulation` installed the
  cap only in `stepAll`, and the standalone grid server steps rooms through
  `stepSite` (and a cell world steps itself), so the road ran 14 / 56.
  `capBoards(site)` now runs on every step path.
- `scripts/hover-speed-probe.mjs`: the four cases by real driving, on staging
  (`--base`), a local build (loopback) or engine's local world (`--rig`).
  Staging (38d11aca): 14 / 13.8 / 14.3 / 13.9 m/s with 63-102 corrections a
  case; local world after the fix: 14 / 56 / 29.4 / 59.5.
