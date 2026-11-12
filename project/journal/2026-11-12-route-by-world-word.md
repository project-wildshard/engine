# One-shard pages route by the world's own word (opus-route2)

- Follow-up to opus-brass3 (`ba88ac9a`), whose review said the route trusted the page's grid catalogue, not the world. Prod's box
  `/health` shows `"table":{"driftwood-isle":0}`: the world opens Driftwood alone, so a one-shard page of any other grid shard
  (Nalati from Shard select) joined it, was seated in Driftwood and bounced to the title the same way.
- Fix: the door's `world` word (GO4, sent before any hello) now names the shard each open cell runs (`shards`). A one-shard page
  of a placed shard reads that word (`worldWord`, kept a minute per tab, so Shard select's one-way-in read usually answers it)
  and joins only when its shard is named (`opensShard`); otherwise it runs the in-page server. No word (unreachable, stalled, an
  older door) keeps the catalogue's answer, within GO4's 3 s.
- Guards: test/server-route.test.ts (the rule), test/online-shell.test.ts (a real World's word). Local proof: a stamped build
  on online-rig with WORLD_CELLS=driftwood-isle, Nalati in play 30 s with no seat taken, Driftwood seated, Chromium and WebKit.
- Review folds: the kept word is filed under `of`, so an older build in the same tab cannot read a kept no as its yes; a page that
  heard nothing answers its second read at once, so a page waits GO4's 3 s once, not twice.
- Not done: an off-grid shard a `WORLD_CELLS` list opens still plays solo (its early in-page server is already running); a closed
  placed shard starts its in-page server at the Worker step, not early; a one-shard page dials the bare address, so a world of
  several cells still seats it where the device last stood (GO5), and progress on a closed shard is the page's own save.
