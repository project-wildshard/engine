# Main red: GC4's start-over test met SC5 (buddy-engine)

- Main went red at `20dd4577` (run 43556510458):
  `dedicated-start-over-near` expected Driftwood to start over once its
  walker was far from it, and it never did.
- Two lanes crossed. GC4 (`f1e630b1`) taught a cell not to start over
  while a road walker stands by its edge, and tested both halves. SC5
  (`7c8b8278`, J328) then retired J107's start-over for every grid cell:
  `emptied()` returns early for a grid-placed slug, so a grid cell's
  world is never rebuilt. The near half still passed; the far half
  asserted a rule J328 removed. Neither the empty-cell catch-up nor
  GC13 was involved.
- The test now says SC5's rule: with the walker gone from Driftwood
  and 10x its 300 ms empty time passed, no `cell.booted`. GC4's near
  check (`walkerNear`) only ever applies to a grid cell, so it is now
  moot; it stays until someone removes the start-over path for good.
