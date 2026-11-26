# Carried content reaches the set; the cut refuses a gap (opus-obs120, QA 11-25 row 121, P0)

- Prod v0.1.92 could not load: its client asked `content/2ba30cfddecd9b49` for boot tables, grid seams and strips and
  title art, and got 404. R2 held the set whole (9,828 keys, its own index), so nothing was pruned or deleted.
- `splitOutput` keeps `carriedPaths` on the page only. v0.1.92 published its content, so its own deploy-chunks graph
  (`content: true`) named code only, and every content path a kept unmarked build (95061e376, 805deb1b5) also listed
  looked carried: 357 paths stayed on play.wildshard.io and never reached the set, while the stamped content base sent
  the current client to the set.
- The split now copies carried content into `dist-content` too (the page keeps it for older tabs), and `--join` takes
  the same bytes from both sides as one file. `stamp-content.mjs`, which runs at the cut, refuses a page holding a
  content path the set's index lacks (`contentGaps`), naming the paths.
