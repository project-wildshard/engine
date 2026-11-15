# Hoverboard speeds and the boost word (opus-hoverspeed)

Meta QA 11-15 rows 8 and 9.

- Row 8: Jake felt the board's speeds changed with the MMO server. The agreed
  speeds are G39/G60 (14 m/s in a shard, 30 on the road) and G540 (Developer
  boost 4x in a shard = 56, 2x on the road = 60; road-class padding cells run
  road speed). The page and the in-page server (GridSimulation) already ran
  them; a dedicated worker's cell and road rooms installed no board cap and
  refused boost (E7.7's "never installed"), so online every case ran 14 while
  the page predicted 30/56/60. `gridBoardLimitAt` (shared/game/grid/rules.ts)
  is now the one world-feet read for all three; `runCells` grants the boost.
  `test/dedicated-board-speed.test.ts` drives bots over real sockets: 14/14/14/14
  before, 14/30/56/60 after.
- Row 9: Jake wants the left-edge HOVER tab to say BOOST while boost is on
  and the word gone while it is off. `mountBoostLook` adds the word under
  HOVER (`.ws-hover-boost`, shown only while boost is shown); a keyboard page
  has no tab, so `mountBoostTag` stands the same word alone on the left edge
  (`.ws-boost-tag`) while boost is on (my pick, so desktop says it too).
