# Preview hosts the grid (J311, opus-preview-grid)

- Jake, 2026-11-12 ~23:15 Cancún: "preview server also needs to have an
  infinite multi grid, and every shard select in preview server also needs
  to be the infinite grid". Meta J311, GRID-CROSSING GC24 to GC27.
- The in-page server already hosts the whole 5×5 grid (Developer's
  Infinite Wildshard on preview), one cell world resident beside the road
  (`STANDALONE_RESIDENTS` 1), crossing by `travel`. What was missing: a
  Shard select tap on a no-world build opened a one-shard page, and the
  solo grid always resumed at its saved site.
- `entry.ts` now runs `enterByShard` on a no-world build for a title tap
  (`pendingTitleArrival`), never for a bare `?chunk=` link or a harness.
  `oneWayIn` returns the cell when the build has no world. The goto rides
  `ServerWorkerStart.goto` (engine-only, not the shard-format control
  schema) to `StandaloneGrid.boot`, which starts in that cell; the site
  save keeps counting from the newest, so the next boot resumes there.
  Red first: `test/standalone-grid-goto.test.ts` expected 4, got 3.
