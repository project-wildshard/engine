# Crash mid-crossing (MMO-PLAN MP1C.4)

- `test/grid-crossing-crash.test.ts`: the solo grid server (the page's own worker) is killed three ways, each a
  `shell.dispose()` with no save on the way out, as a dead tab: while the crossing waits on the cell's world (feet within
  6 m, still on the road), half way through the crossing's own progress save (TE-ENG8: the cell's shard document landed,
  the site document never did), and once that save landed. The first two come back on the road at the last save; the
  third inside the cell. No code change: the behaviour already held.
- Red under mutation: without the crossing in `ProgressWatch.look` the last two fail; a boot that ignores the saved site
  fails all three. Runs in CI's `network-rewards` group beside net-fuzz's crossing (real clock, cold road bake). Walks
  use a 30 s wall-clock deadline, not a tick count, since a cell's world loads on its own time (Codex review).
