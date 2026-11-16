# Cook budget counts its own keys (buddy-engine, urgent)

- From 2026-11-14 06:12 UTC the box cook failed every job (52) with
  "Over the pack budget". `PACK_BUDGET_BYTES` (4 GB) was checked
  against the whole packs bucket, and PAGE-SIZE's `content/` sets were
  32.7 of its 33.53 GB. The cook never writes or collects `content/`,
  so nothing it could do would ever free the space.
- `usageOf` now counts only the cook's own keys (everything outside
  `content/`) for `bytes`, `objects` and `share`. `byPrefix` still
  lists the content sets, so a GC report shows them.
- The test failed first with the production message
  (`8000000000 + 10199261 of 4000000000`), using an 8 GB sparse
  `content/` object against the default budget. The second case keeps
  the refusal when the cook's own keys are over.
- It goes live when opus-ss16e releases v0.1.23 and moves the cook onto
  it.
