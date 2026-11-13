# Cell loading on the Shard Select card (opus-loadpanel)

- Jake (11-13, iPhone shot): the in-world "DRIFTWOOD ISLE" step panel at a
  cell's wall was blurry, cut off and unlike the new Shard Select loading
  screen. A neighbour cell's preparation now drives the same `Loading` card
  (scoped) in a new `inset` mode: no backdrop, head or world cover
  (`holdCovered` skipped, so the world keeps drawing), `pointer-events:
  none`, placed under the minimap on a phone. `cellScreens.ts` now holds
  `CellLoadingCard` instead of the canvas `CellScreen`; `CellLoading`'s
  steps are unchanged, its port is `show(view)` / `hide(entered)`.
- Entered: the card completes and fades; left or cancelled: disposed at
  once; a new cell's card ends a fading one.
- Local `serve-build` proof builds failed on the title gzip ceiling (main is
  over it) and a stale `_template` receipt from the shared `out/`, so the
  after shots came from a throwaway worktree (HEAD plus this change) whose
  build read a raised title ceiling through a proof-only preload. Phone:
  the card sits under the minimap, above the hover chip; its footer shows
  only a refusal there.
