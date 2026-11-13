# The road builds the next cell's world before its line (opus-crossholds)

> Written by: Claude (opus-crossholds), 2026-11-13

GC36's rig walk (Driftwood to Sunscar and back, 2 workers, crossing on) stood 2 to 5 s at the neighbour's edge with the
crossing `preparing`. A trace (Long Animation Frames, the `wildshard.prepare:*` measures, the live grid's residents each
100 ms) showed why: `LiveGridHost` built a cell's world only on actual entry demand (T7), so the build (2 to 5 s in
Chromium: the native presentation tiles, the scene library, the entry warm-up) started at the line, behind a closed wall.

Now the session asks the host to build ahead (`buildAhead`, GC5): on the road, heading into a cell's mouth, the host
retires the departed world (as the entry would) and builds that cell's world at once, and keeps it (`ahead`) while the
traveller is on the road and has not turned into another mouth. Two traps the first cut fell into, each pinned in
`test/grid-build-ahead.test.ts`: the per-tick retirement threw the built world away and rebuilt it five times over a walk;
and past a cell's line (inside its square, before the 6 m entry) the heading names the cell beyond it, which retired the
world underfoot. The standalone drivers keep T7's rule (no port, no build ahead). A world built from the road takes its
entry point at the cell's edge (clamped), not out on the road.

Also: `loadShardfileNear` baked every mesh's pose in one go (60 to 170 ms frames on the road); it now lets a frame through
between meshes.

Measured (local rig, headless Chromium `--use-angle=metal`): worst stop walk / boost back / boost out 4831 / 1024 / 1961 ms
before, 0 / 0 / 0 ms after. The long frame at the line is not fixed: it is WebGL program links (ANGLE on Metal, 110 to
180 ms each) for the programs the arrival first draws, about 4 in the commit frame (555 ms) and a dozen more in the
following second.
