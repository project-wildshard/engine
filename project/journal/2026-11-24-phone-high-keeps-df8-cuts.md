# Phone High keeps the pixel-neutral Driftwood cuts

> Written by: Claude (lane opus-perf), 2026-11-24

Meta QA-FEEDBACK-2026-11-24 row 31, Jake on his iPhone 17 Pro, staging v0.1.84: *"Driftwood FPS is still dogshit"*.

QA 11-23-b row 8 (`afb86e1f4`) moved his phone from Low to High. Every DRIFTWOOD-FPS cut was keyed to phone Low, so
High lost all of them, including the ones that draw nothing differently. The DF8 program cuts were on for desktop
(`b0c3ad101`) and phone Low, and phone High was the only setup without them. The route table on staging
(`scripts/fps/table.mjs --profiles phone-high,phone-lpm-low`) shows it. Phone High linked 39 programs after control at
the dock and 41 by the village, against 5 at phone Low. It hit a 153 ms frame in the village (one frame callback of
141 ms) and missed its floor at 0.6 frames over 50 ms a minute.

These now default on for every phone, at Low and at High, with a saved boolean still winning: `debug.programTwins`,
`programFold`, `programReuse`, `bootRoadPrograms` (DF8), `outerStartPaced`, `roadHandoffPaced`, `outerCollidersNear`
(DF8/DW3 pacing), `warmPace`, `warmSettle` (DF10's warm body, drawn under the world), `roadWarmCards` and
`interactStillCoalesce` (DW3). Cuts that change pixels stay Low's: far LOD, cover, the merges and batches, and 1x.
`test/phone-high-cuts.test.ts` holds the gate.

Driftwood at the dock, Chromium phone stand-in, 402 x 874, High at DPR 2, 3.7x CPU (DF3's Low Power factor), four
alternating cold boots: on gave 105 programs (off 184), fps 52.1 / 43.2 (off 43.1 / 38.7), p95 28.0 / 31.1 ms
(off 31.9 / 35.5), frames over 50 ms in 30 s 3 / 7 (off 5 / 9), and render p50 9.6 / 11.9 ms (off 12.3 / 12.6). The
evidence is in meta `project/evidence/driftwood-fps-2026-11-24/`.
