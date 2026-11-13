# Grid crossing M1: proving what is built

> Written by: Claude (opus-gcm1), 2026-11-13

- GC32: `test/grid-crossing-turn-back.test.ts` pins the page's crossing coordinator when a target refuses (Far Reach,
  or a cell on another worker): turning back settles home in the cell or crosses back in from the road, and a blocked
  target asked again retries. Red under two mutants (no settle home; a blocked crossing that sticks).
