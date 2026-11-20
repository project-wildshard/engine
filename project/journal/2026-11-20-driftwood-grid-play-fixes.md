# Driftwood grid play fixes (mini-dw-fix)

QA-FEEDBACK-2026-11-20-mini rows 3 to 6, from IPHONE13-DRIFTWOOD DW8 and DW9.

- Row 3, the tide barrel: the room owned and pushed its declared barrel, but no row carried it; the page's own barrel body
  sat in the boot's physics (not the cell's), so it never moved and the player walked through it. The native body scripts
  now publish each declared prop as `script:<owner>`, the page's barrel follows that row (its own body and watch dropped),
  and a server-posed barrel leaves the plates to the server. `test/driftwood-barrel-grid.test.ts` pushes it onto plate B
  in the room resident.
- Row 5, New Game on the grid: `prepareNewGameRecovery` asked for a checkpoint, which `bindWire` suppresses on a wire, so
  every grid New Game was refused ("your save is unchanged"); like `prepareRecovery` it now saves only where the page
  stands there. The Saves cards also read the server's copy (read-only, the J130 database) and show it when it holds
  anything, so a mid-quest Driftwood card no longer reads "QUESTS 0 DONE · EMPTY".
- Row 6, "Road tile archive unavailable" in the error modal: a tile the archive could not read failed the road's first
  handoff for good (`primeFailure`), and `RoadTileBacking.step` threw it on every grid frame. Now the handoff's pins are
  released and asked for again (the streamer's own back-off refetches); after `ROAD_PRIME_TRIES` it reports one
  `grid.road-tiles` fault and keeps the whole road meshes, which were never retired.
- Row 4, the wedge inside the wreck hull at (150.7, 0.5, -1.3): the feet perched on a plank box's top edge, hull walls on two
  sides and a beam 5 cm over the head. The edge contact reads as a 52-degree slope (past the 40-degree climb), not a wall, so
  Rapier's autostep never fires; no direction and no jump moved the capsule. `CharacterMotor.stepOver`: a grounded player
  move that stalls under 2% while perched (grounded, no ground under the feet's centre) is tried again from as high as a step
  or the roof allows, and kept when it lands on walkable ground within a step, or crosses steep ground without climbing.
  Feet on ground keep their stall, so the bank and pocket prediction tests are unchanged.
- Row 8 (mini-dw-report's recheck), frozen at the reward spot after QUEST COMPLETE: the room's reward beat (`nativeComposition`
  `rewardFor`) said on finish that a completion card had taken the carry over, as a page's does. The room has no card, so the
  ride stayed carried for good, through reloads and for every later player in the room. Its finish now always returns false
  (the flag is still filed once), and a finished beat's save no longer restores the carry.
