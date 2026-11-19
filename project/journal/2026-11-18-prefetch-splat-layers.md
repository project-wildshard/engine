# 2026-11-18: the grid prefetch skips a cooked splat layer's blob (S12f2b4)

Meta SHARD-SOURCE S12f2b4, the gap S12f2b2 left. A phone drawing the
phone set reads a splat layer the cook encoded 6x6 from the cooked file
and never admits its blob, but the grid's off-page prefetch of a
neighbouring cell (`grid/prefetchIndexCore.ts`) had no phone table, so
it still downloaded those blobs: Pine's 8 ground layers at UASTC size,
bytes the entry then never reads.

The prefetch now reads the neighbour's served discovery document (tens
of KB, its title row's `discovery`), takes the phone table the entry
will register (`pageModeKtx2`, this page's mode) and passes its cooked
rows (`phoneSplatLayers`) to the same selection the entry uses. An
older cook, a missing document or a failed read leaves the blobs in, as
before. The offline estimate counts the same way.

Not done here: the cooked files themselves are not prefetched (they are
read by URL, not by hash, so the content cache can't hold them as
rows); the entry fetches them.
