# DF8: hidden road pools merge once (mini-driftwood13n, 2026-11-20)

On the iPhone 13 dock the 31 to 35 ms `grid.road tiles` laps were the tile stream's publishes: each one re-merged its
material's whole pool, two a step, while the pools were still hidden before the handoff. With `debug.roadHandoffPaced`
on, hidden pools only record their tiles and the handoff merges each pool once, in 4 ms slices (`RoadTilePool.settle`),
before showing it. Still off everywhere until cooled phone pairs decide.

`route-bench --gpu-fence` (gpuFence.mjs): a WebGL2 fence after each render and a full-collection sentinel (an object held
3 s, then only weakly; only a full collection empties it), because the phone's Heap agent stamps every collection with one
time and an all-process xctrace saves slower than a 10-minute phone hold.
