# Desktop 120: the bench draws at the tier's render scale (DRIFTWOOD-FPS DF14, mini-dwfps)

- The fps bench pinned desktop High to the screen's 2× through a Developer pixel pick (`devPixels`), but a desktop player
  draws at min(screen, 1.5) (`tiers.ts` desktop.dpr) and dynamic resolution only lowers that. At 1496×717 that was
  4.29 Mpx instead of 2.41 Mpx. `measure.mjs` now pins Settings ▸ Render scale 1.5 for desktop profiles and witnesses
  min(screen, 1.5); a test ties the constant to `tiers.ts`.
- Same page, ABBA ×8 at the dock, native High: ratio 2 → p95 13.35 ms, 144 fps; ratio 1.5 → p95 6.75 ms, 189 fps.
- Dropped on the way: AO restore suppression (n8ao pre-pass hide-and-show as no clip reveal). Pixel-identical, but the
  same-page ABBA measured off 13.45 / on 14.3 ms p95: no gain past the noise.

## phoneNormal calibrated at 2× (DF3)

- Two headless Chromium sweeps on main `aaeec2602` (phone Low, cap 30, rotating dock, throttle 1.5/2/2.5/3) against the
  iPhone 13 on the same SHA at normal power (update/render p50 3/4 ms) fit 2.2× and 1.8×, both inside ±15% and within
  0.5 of each other; together 2.0× (2.82/4.21 ms). `budgets/fps-calibration.json` records both sides, so `phone-low`
  runs at 2× and stops reading "CPU provisional". `phoneLpm` stays unqualified (J485).

## The long frames after control were the world's own draw checks (DF14, 2026-11-23)

- `measure.mjs` now keeps Chromium's long-animation-frame entries after control (`longFrames` in each cell). On the native
  High dock every long frame sat in the frame callback with small update and render, so a CPU profile started at control
  named them: DrawCheck's `checkFramebufferStatus` (104 to 106 ms, frame 300, ~2.3 s) and the world watch's 3 s look
  (`getImageData`, 112 ms). Both wait on the GPU process from the page thread.
- `debug.worldWatchDrawCheck` (the watch reads in a worker and stands in for DrawCheck on its canvas) is now on by default.
  Two ABBA pairs on the dock: frames over 50 ms off 2, 3 / on 1, 1. The one left is the frame control lands in.

## A link-cost term for the phone stand-in (DF5, 2026-11-23)

- At 2.2× CPU the stand-in ranked DF9's `farLod` worse like the iPhone 13, but not DF10's batches: the phone's loss there
  was programs compiled after control, which Chromium links fast at any CPU rate. The route script now counts each boot's
  links after control whose shader sources no earlier link used (`newProgramSourcesAfterControl`); WebKit keeps compiled
  programs by source, so those are the links that cost a phone frame.

## A fenced GPU time for the DF5 ratio (2026-11-23)

- The old DF5 fit divided the phone's capped frame residual by Mac timer queries; at a 30 fps cap the residual was the
  34 − 1000/30 ms cadence floor in 14 of 15 segments, so no ratio could qualify. `scripts/fps/gpuProbe.mjs` fences one
  frame in n with a 1-pixel readPixels before and after its draw; both benches (route-bench `--fenced-gpu`, measureFps
  `fencedEvery`) record the same tail, and `gpu-fit.mjs --fenced` fits phone over Mac on it.
- Fit (same day): build aaeec2602, phone Low 390×658 at DPR 1, cap 30, route `driftwood-fps`, three matched runs. Training
  dock/beach/village gives phone/Mac 3.25 (runs 3.22 to 3.54); quest fire and road crossing are predicted within 0.8 to
  12.5% in every run, so `fps-calibration.json` records the GPU ratio as qualified. Two phone runs whose road crossing
  stuck on a waypoint were refused by the fitter (incomplete legs) and replaced.

## The AO pre-passes re-gated the whole cell every frame (2026-11-23)

- A CPU profile of desktop High at the Driftwood dock (1496×717 at 2, render scale 1.5) put about 9% of the frame in the
  grid's cellClip: n8ao's transparency pre-passes hide every visible opaque renderable for one render and show it again,
  and cellClip took each restore for a reveal, so the next frame re-gated and re-checked every draw in the cell.
  `render/passVisibility.ts` lets the pass mark its restore; cellClip skips its reveal work then (nothing moved between the
  hide and the restore). Live switch `game.aoQuietRestore`, device slot `debug.aoQuietRestore: false` turns it off.
- Same build, after: cellClip's self time 9.4% → 1.5% of the frame. Cold boots at 2× CPU, ABBA (loaded mini, load
  average 8 to 12): render p50 10.2 / 10.5 ms off, 7.9 / 8.4 on; frame p50 15.2 / 14.8 off, 11.3 / 11.4 on.
- The 52 to 81 ms frame about 3.5 s after control in 2× boots is not the world watch's copy: a warm page shows no cost
  for either the copy or a bitmap, a GPU blit read did not remove it (ABBA 1 / 2 / 0 / 1 frames over 50 ms), and a boot
  profile (`deskbench --boot-profile --cpu 2`) shows that window busy with content arriving: the placement culler,
  precompile's material clones, tile content's static matrices. The watch change was dropped.

## What else desktop High at 2× spends (2026-11-23, later)

- A live A/B at the dock, 2× CPU, 5 rounds of 150 frames (one boot, loaded mini): AO off saves ~1.3 ms mean and ~2.8 ms
  p95, all shadow maps held ~1.4 / ~2.5, the DOM HUD hidden ~0.5 / ~1.7 (it barely mutates; compositing, not layout).
- Two look-neutral AO tries were bit-identical (same-instant pixel diff: performance.now frozen, loop parked, 0 of
  2.4 M pixels differ) but no faster than the quiet restore already on main: rendering the pre-pass from a stand-in
  scene of its three renderables (ocean and two pools) and the lights. Dropped.
- `debug.shadowOneMap` (`shadowCadence.ts` `cascadeRedrawsOneMap`): one cascade a frame on desktop High (near every 2nd
  frame, middle and far every 4th) instead of the stagger's 1.75. Live A/B: render −0.34 ms mean, interval −0.4; cold
  ABBA could not resolve it (off 96.8 / 104.6 fps, on 92.2 / 102). Landed off; a moving caster's shadow near the camera
  would step at 60 Hz, which a still board cannot judge.

## AO on water, and stale bodies in every back-to-back bench boot (2026-11-23, 07:15)

- `debug.aoOpaqueDepthWriters` (off): n8ao takes the ocean and the two pools (transparent, depth-writing) as opaque, so
  its depth-writing pre-pass has nothing to draw and is skipped. Same-instant diff: 4.5% of pixels, mean 1.2 levels,
  91% under 2. Live 2× A/B: render −0.23 ms; with `debug.shadowOneMap`, interval −1.07 ms mean and −2.1 ms p95, the
  only pair that got near the floors (p50 9.0, p95 10.4). AO quality knobs (half the samples, one denoise pass) bought
  nothing. Both slots wait on a J430 board.
- The first board's candidate shots had two Guest bodies on the dock. A dropped player's body stands 5 minutes
  (`cellProtocol.ts` `HOLD_MS`) and a bench browser closes without leaving, so any boot within 5 minutes of the last
  one on the same world draws the earlier boots' bodies: every cold ABBA on a dev world, and every cell of the nightly
  `table.mjs` (one cell every 6 to 13 minutes, and a cell's warm boot right after its cold one). The nightly world now
  runs with `HOLD_MS=1000`; bench worlds should too (`HOLD_MS=1000 node scripts/dev.mjs ...`).
- The J430 board passed both slots on stills (07:22); the judge asked for a moving check of the cadence. Every 7th
  frame of a 1.2 rad/s pan and a walk, the frame as drawn against the same instant with every cascade fresh (both at
  dt 0; a repeat control differs by 0 px): the stagger on main errs on p90 0.002% of pixels, worst 0.18%; one map a
  frame p90 0.008%, worst 2.8% (a one-frame shadow pop). `debug.shadowOneMap` stays off; water AO is on.

## The route's long frames on desktop native, and DF8's program slots (2026-11-23, 09:00)

- The quick desktop table (dock, beach, village; engine 9f506700c): desktop-high 106 fps, p50 9.3, p95 11.9, worst at the
  dock; desktop-native 199 fps, p95 7.9, missing only on frames over 50 ms (beach 35 s: 120 ms; village 67 s: 97, 71 ms).
- A route CPU profile (`tmp/mini-dwfps/routeprof.mjs`: measure.mjs's own capture with the profiler on its page and a marker
  at control) named the 67 s frames: 41 ms of `getProgramParameter` under `renderBufferDirect`, the first draw of two
  `family:pbr` programs (full maps, one flat-shaded) for the grid cell's `props.merged` meshes, built after the boot's
  warm-up. 71 more programs link in the dock's first seconds.
- DF8's three program slots (`debug.programReuse`, `debug.programFold`, `debug.bootRoadPrograms`, on at phone Low) on
  desktop: links after control 73 → 2, the village frames gone, spikes 3 → 1, fps and p95 within noise. They now default
  on for desktop as well.
- The beach frame at 35 s stays: 118 ms of `(program)` before the frame's callback (render start 113–120 ms into it),
  native work a CPU profile cannot name.
