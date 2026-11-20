# Driftwood grid play fixes (mini-dw-fix)

QA-FEEDBACK-2026-11-20-mini rows 3 to 6, from IPHONE13-DRIFTWOOD DW8 and DW9.

- Row 3, the tide barrel: the room owned and pushed its declared barrel, but no row carried it; the page's own barrel body
  sat in the boot's physics (not the cell's), so it never moved and the player walked through it. The native body scripts
  now publish each declared prop as `script:<owner>`, the page's barrel follows that row (its own body and watch dropped),
  and a server-posed barrel leaves the plates to the server. `test/driftwood-barrel-grid.test.ts` pushes it onto plate B
  in the room resident.
