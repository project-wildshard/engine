# The grid prefetch leaves the session's static closure (fix forward, main ci 44429492263)

- After the splat fixes and the format 0.41.1 pin, the session closure still read over its 4,400,000 B raw cap (a local
  Template build of main `a84ddb4b`: 4,410,606 B). `session/finish.ts` and `session/data.ts` imported the grid's
  whole-set prefetch (`grid/prefetch.ts`, with its index reader and quota) statically.
- The entry already loads that module with its common services (`entry.ts`), so `finish.ts` now takes it by a dynamic
  import that resolves at once, and `data.ts` reads the counts through `__ws_gridPrefetch`, which the first run sets
  (no run: null, as before). Local Template build: 4,397,642 B (2,358 B under).
- `finish-background-idle.test.ts` hands the continuation the module as a port, as it handed the two functions.
