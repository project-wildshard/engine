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
