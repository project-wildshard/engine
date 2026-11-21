# DW12c: the road tile capture, lean (mini-dw12c, 2026-11-21)

The outer road's tile capture was the first DW12 knockout beyond noise (~120 to 170 MB), so I measured the capture
itself: a WebKit micro-bench (a ~35 MB synthetic deck job, 500 tiles, run in a worker) put WebContent up 156 to 173 MB,
and stage knockouts showed it was all per-tile garbage, mostly the compaction's `Map` and growing number arrays. Behind
`debug.roadCaptureLean` the job now compacts through one vertex table per source into six reused arenas, encodes into an
arena, hashes in place, puts without a second copy, and the worker is retired once each road's capture drains: +37 to
39 MB on the same job, the same bytes.

In the page it did not move the Driftwood peak (three alternating pairs, off 1,528 / 1,493 / 1,400 MB, on 1,512 / 1,500 /
1,440): there the deck's capture adds only ~20 to 65 MB over its window, so the knockout's share is mostly something else
the backing switches on (the tile-lattice clip, the page's job copy, the stream). Off by default. A first version without
the worker retirement ran ~45 MB higher before the outer road: a lean job allocates too little for the idle worker's
collector to run, so the inner road's job stood in its heap.
