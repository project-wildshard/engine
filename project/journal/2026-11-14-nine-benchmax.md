# Nine benchmax (opus-nine, meta NINE-DRAGON-BENCHMAX)

- NB3's cut. benchmax now prints the settle's per-tile, per-content attach measures and the geometry warm counts. On a
  local Nine build at CPU x4 the 1.5 s `app:spawn-view-tiles` was: ~450 ms of collider ring builds holding the 4 lanes,
  ~270 ms of slab bank reads, then 49 slab part warms one after another (~470 ms), then the rest. Identical per-tile slab
  times across tiles gave it away: every tile waited on the same serialized publication chain.
- Cuts, loader only (play keeps one part a frame): every fence tile starts at once; a tile's contents attach together, so
  every slab key's publication queues at once; the slab library waits for its bank reads (250 ms cap per wait) and
  publishes what they made as one warm under one hidden root (49 warms to 2); a geometry warm's pauses yield per 8 ms
  work slice instead of a timer hop per step. Lanes alone took ~250 ms; batching only paid once contents ran together.
- x8: readyFrame 4.1-4.6 s to 3.0 s. The phone's 4.6 s was ~75 ms per serialized warm, so it should move more there;
  NB7's paste will say. What's left is CPU: placement builds, meshopt decode on the main thread, 49 parked draws.
- NB6 widened to play: Ring 1's boot smoke now also profiles its ten gameplay frames and refuses a 1.5 s window the main
  thread spent 80 % busy without a break (idle, `(program)` and WebGL calls left out, so CI's SwiftShader GPU can't trip
  it). deskbench gets `--capped` (vsync kept: Jake plays on this Mac) and `--stalls` (the same check per desktop pose).
- (NB3's cut lands as its own commit after the NB6 one: the pre-commit typecheck reads the tree, and NB6's test imports came first.)
- NB6 follow-up: stalls.mjs has a hand-written stalls.d.mts; the play exports needed their declarations too.
- NB3's cut commits after NB6 (the commit typecheck reads the tree: NB6's test imports had to land first).
- NB6 proof: play's clock mark found no sample on its second call (V8 reused the repeated eval's compiled script with
  the mark inlined), so every eval now gets new text. Ring 1's developer group then passed (play busy 20-52 ms) and a 2 s
  busy sleep every 5th frame failed it: "Play stall: the main thread worked 1.50 s of a 1.5 s window".
