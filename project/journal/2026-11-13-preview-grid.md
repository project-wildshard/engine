# 2026-11-13 preview borrows staging's grid (SA35)

- Lane opus-sa35, meta SHARD-AUTHORING SA35 (Jake's grill Q11: "every deploy of preview in the github
  actions for deploy borrows the grid placement from staging by asking the staging mmo in the github
  action"). Preview has no MMO; its page baked `test/pins/catalogue.json`, so an API placement (SA30)
  never reached it.
- What "asking the staging MMO" can mean from a GitHub runner: the MMO's `/health` is tailnet-only
  (D7; the public `rooms-staging` answers 404) and names instances, not cells, and the runner has no
  tailnet secret. The MMO's own grid is its build's pinned catalogue plus the API-signed placement file
  it reads at `PLACEMENT_URL` (SA33, SA33a). So the workflow asks for that file,
  `packs.wildshard.io/releases/staging-placements.json`, and believes it only under the placement key
  through engine's own `readPlacementFile`, the reader the MMO uses. Same inputs, same grid.
- `scripts/preview-grid.ts` writes `tmp/preview-grid/catalogue.json`: the pin's 25 cells, then
  staging's placed cells, each refused the way `placeCell` refuses (off the 7 × 7, a taken spot, a slug
  that already has a cell). A slug the build has no head for joins `missing`. `page-release.mjs
  preview --catalogue=<file>` bakes it (staging and production refuse the flag).
- Staging's file 404: staging placed nothing, the pinned grid (today's live state). Anything else
  (down, 5xx, bad signature, another channel's file): the live preview's own borrowed cells, read
  from `preview.wildshard.io/catalogue.json`, stay, with a `::warning::` and a job-summary line; if
  that is unreadable too, the pin, and a warning.
- The hourly workflow skipped a deploy when no client input changed, which would have hidden a new
  placement. `--news` (Node built-ins only, before install; it checks the signature itself) compares
  staging's cells with the live preview's and deploys on a difference.
- Known limit: the page places the cell; its content loads only when the build has the shard's
  product (a pinned slug). A brand-new author slug's product reaching preview is not this row.
