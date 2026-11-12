# 2026-11-12: stale cook test split

- Main went red (run 43288951110, shard 12): `cook-stale-preparation.test.ts`
  took 61.4 s, past the 60 s CI file budget (J193). Its measured time was
  already 49.8 s, nearly all the cook worker case (46.6 s, three cooks in
  the bounded child). That case moved to
  `cook-stale-preparation-worker.test.ts`, the shared Template fixture to
  `test/fixtures/stale-preparation.ts`, and the worker file got its own
  native group (`native-cook-stale`) like the publish file. Local: both
  files together 15 s.
