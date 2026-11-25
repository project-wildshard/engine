# Gate guards (opus-guard)

- QA 11-25 row 53: 5068a7365 passed the push gate because tsc -b trusted a cloned, warm cache older than the new
  untyped scripts/trailer/capture.mjs (TS 7.0.2 misses a new root older than the buildinfo). The gate now touches
  every pushed file before its typecheck; a forced full typecheck was 62 s, too slow.
- QA 11-25 row 54 follow-up: main-watch read Lane: with %(trailers), but main-push writes Lane: in its own
  paragraph above Assisted-by, so git never saw it (5068a7365 reads as no lane). It reads the whole body now.
