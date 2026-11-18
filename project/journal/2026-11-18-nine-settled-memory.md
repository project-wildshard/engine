# Nine's playing (settled) memory on WebKit (mini-ninesteady, MEMORY-GATES MG10, 2026-11-18)

Nine Dragon, phone Low, Playwright WebKit headless on the Mac mini. [K] kernel footprint and `footprint -j` categories,
[L] the engine ledger, [X] Metal System Trace (allocation stacks; nominal resource sizes), [J] JavaScriptCore heap
snapshot after GC. "Settled" is `measure.mjs` (control, two GCs, 2 s idle); "walking" is the median of kernel reads 30-40
s into NB1's street route with no forced GC (`tmp/mini-ninesteady/steady.mjs`).

## The settled budget, engine 86a533d0 (4 cold runs)

| Process / item | MB | Instrument | Owner |
| --- | ---: | --- | --- |
| **WebContent settled** | 900 | [K] | |
| Web Inspector Network response retention | ~170 | [K], same-tab `Network.disable` delta | the harness (Playwright keeps the Network domain on); not on a phone |
| JSC heap: live objects, strings, closures | ~150 | [J] class sums | engine and game JS |
| JSC code blocks | ~30 | [J] | JSC |
| JSC GC block capacity and other bmalloc | ~300 | [K] WebKit Malloc remainder | JSC / WebCore |
| ArrayBuffer contents (`WebAssembly Memory` tag) | ~89 | [K]; [L] array-buffer 26-32, audio 18.7 | geometry CPU copies (paifang k0 slab 20 [L]), audio, ~40 unlabelled |
| JS JIT code | 49 | [K] | JSC |
| Untagged | 20 | [K] | WebKit |
| **GPU process settled** | 577 | [K] | |
| IOAccelerator (graphics) | ~206 | [K]; [L] WebGL buffers 124 | WebGL buffers (ANGLE `BufferManager`) |
| Owned unmapped (graphics) | ~126 | [K]; [L] textures 47, render targets ~10 | WebGL textures and targets |
| Owned unmapped | ~122 | [K], freed by `loseContext` | the WebGL context (unnamed) |
| IOSurface | ~136 | [K]; [X] CoreAnimation `iosurface-destination` | HUD layer backing stores at DSF 3, WebGL display buffers |
| Malloc Small | 17 | [K] | GPU process |

Walking adds 150-550 MB of WebContent garbage over settled (JSC collects on its own schedule); Chromium allocation
sampling while walking reads 12.7 MB/s, the largest site the culler's resident filter (`worldScenePlacement.ts`
`residentCopies`, 3.6 MB/s).

## Findings

- ANGLE's small-buffer sizes in the Metal trace are nominal: 824 WebGL buffers read 131,072 bytes each [X], but 1,000
  buffers of 1 KB on a blank WebKit page cost +2 MB [K]. The GL buffers' physical cost is close to the ledger.
- The provoking-vertex rewrite pool (136 MB [X] while walking on 3f2cdb6a: the two largest slabs' indexes rewritten after
  rotation drew in the last-vertex convention) is gone since 08f3d688 (mini-ninemem6).
- Uint16 index offsets that are not 4-byte aligned are 0.4% of slab ranges; aligning them moved nothing.

## Cut 1: hidden overlays (this commit)

Five overlays sat at opacity 0 but displayed for the whole play, so WebKit kept their composited layers: the pause menu
(backdrop blur and glass sheet), the water line and its two animated caustic layers (1.5x the screen), the dash speed
streaks and dodge smear, and the damage flash after its animation. They are now `visibility: hidden` while transparent.
4 alternating cold runs each: settled GPU process 577 -> 520 MB, WebContent 900 -> 896 (noise), EM11 playing 1.087 ->
1.065 GB (upper 1.19 -> 1.14); walking GPU 600 -> 547, IOSurface 136 -> 82. Spawn shots match (rain and weapon sway only).

## Cut 2: HUD containers paint nothing (mini-ninesteady2)

WebKit's LayerTree (Web Inspector) named the remaining full-screen backing stores, each 402 x 874 at DSF 3 = 12.6 MB: the
document, `#hud` and `.ws-touch`. `.ws-touch` repainted 160-230 times in a 40 s probe (disc class and style churn), so its
store was double- or triple-buffered in IOSurface. On the phone every child of `#hud.touch` and of `.ws-touch` now has
`will-change: opacity`: each control draws in its own small layer and the two full-screen containers paint nothing, so
they get no backing store. The full-screen effects (speed streaks, smear, damage flash, menu) opt out. Without the
opt-out they gained 28 MB of stores while hidden. Layer memory went from 39.4 to 19.5 MB.
Engine 50092092 vs cut, 4 alternating cold runs each: settled GPU process 524 -> 502 MB, IOSurface 81 -> 35, walking GPU
570 -> 535, WebContent 765 -> 755 (noise); EM11 playing 1.032 -> 1.013 GB, upper 1.159 -> 1.134. A frozen-frame
shot with and without the CSS differs only in the developer fps pill (0.10% of pixels).

## Lead: coarse_1_1_0's aMisc buffer pins ~96 MB of owned unmapped memory (not cut)

With rendering paused, deleting the single GL buffer behind `coarse_1_1_0`'s `aMisc` attribute (f32x4, 985,216 bytes,
feeding the flat varying `wsV5_no` of the nine-architecture program) frees ~96 MB of the GPU process's "Owned physical
footprint (unmapped)". This reproduced twice. Deleting `aFace` or `aPat`, hiding the coarse meshes and
`geometry.dispose()` do not free it. A blank page replaying the same geometry and program does not reproduce it, and
Template's owned unmapped is 26 MB. The mechanism is open: a Metal trace of the delete is the next step.

**Closed (mini-ninesteady3): not a cut.** On 5a556859 the same delete (draws frozen, `coarse_1_1_0`'s aMisc, aFace, aPat
and position buffers one at a time, 4 s apart, both orders, plus a no-delete control) moved no category: a buffer a VAO
still binds stays alive in ANGLE, and that buffer draws only in the loading frames. The ~96 MB was the GPU process's
"Owned physical footprint (unmapped) (graphics)" transient: +50-60 MB appears for a few seconds after the draws stop
and goes again by itself (seen in all three runs, the control included).

## Cut 3: no Metal pass bins more than 400 k vertices (mini-ninesteady3)

The GPU process's other ~100 MB of "Owned physical footprint (unmapped)" (a blank WebGL page holds 8) is not a GL object:
deleting every program, VAO, buffer, texture and framebuffer of the context left it in place (buffers freed 10 of their
117 MB of IOAccelerator; ANGLE keeps freed Metal buffers). It appears in `firstFrame`/`readyFrame` (19 -> 68 -> 113 MB
within 0.9 s) and never shrinks. On a blank page it grows with the vertex outputs one command buffer carries and with
their varyings: 1.25 M points a frame +10.5 MB with no varyings, +34 with 4 vec4, +50 with 8 (mediump and flat change
nothing); 6.25 M points in one frame +58; the same drawn one buffer a frame +0; a `finish()` between draws +0, a
`flush()` +10. That is the TBDR parameter buffer (transformed vertices and varyings binned before shading), sized to the
heaviest pass and kept. Nine's play frame is ~1.17 M vertex invocations (index count x instances) through programs with
~14 live varyings (`WEBGL_debug_shaders`); its hidden loading frames reach ~1.6 M; skipping every loading draw left 99 MB.

`render/passSplit.ts` wraps the context's draws (WebKit only) and calls `flush()` before the draw that would carry the
pass past 400 k invocations; a draw framebuffer change restarts the count. A flush ends ANGLE's encoder and commits, the
next draw loads the attachments, so the pixels are GL's. Split points: 200 k 69 MB, 400 k 68, 600 k 70, 800 k 89, none 113.

Engine 5a556859 vs cut, 6 alternating cold WebKit runs each (instrument minimal): settled GPU process 507 (506-508) -> 459
(455-460) MB, WebContent 761 -> 761; GPU peak 660 -> 607, WebContent peak 1,197 -> 1,162 (noise); EM11 playing 1.019 ->
0.994 GB (upper 1.148 -> 1.109), loading 1.532 -> 1.467 (upper 1.700 -> 1.675). NB1's street route at boost, 4
alternating cold runs each (kernel reads 30-40 s in): walking GPU 525-529 -> 469-471 MB, WebContent 732-818 -> 721-834
(garbage, noise); rAF frames over the 40 s walk p50 17 / p95 18-19 / p99 19 -> 19-20 ms, worst frame 22-35 -> 22-26 ms,
no frame over 50 ms in either. WebKit spawn shots at four headings: base vs cut differ in 16.2-18.9% of pixels, base vs
base 17.4-18.5% (rain, crowd, weapon sway).

Simulator (`nine-sim-memory.mjs`, play/fly 10 s, 3 rounds): loading native 0.783-0.788 -> 0.788-0.813 GB, play 0.809-0.815
-> 0.796-0.801, GPU process 0.225-0.231 -> 0.207-0.216 (its Metal memory is in SimMetalHost, so the cut cannot show).
**Watch item:** at the explorer's end point the Simulator read 30 fps with 78-84 calls / 0.83-0.95 M tris on the cut (400 k
and 600 k) against 60 fps with 37 calls / 0.48 M on base, in all 3 pairs. The same flight in Playwright WebKit on the Mac
(Apple GPU, ANGLE Metal, as the phone) reads 60 fps and 45 calls / 0.61 M tris on both, frames p99 19 / 19-31 ms (one cut
run had a 101 ms frame, with WebContent unsettled at 1.33 GB). The Simulator's Metal goes through SimMetalHost, where a
command-buffer commit is costly; a phone frame-rate read of the explorer is the check that settles it.

Next, by owner: the parameter buffer still holds ~60 MB at the split floor; fewer live varyings in the graph programs
shrink it further (the fog chunk's `vFogWorldPos` and the graph's `wsVFogWorld` carry the same `modelMatrix * transformed`
in every fogged graph program; `regionLook.ts` rewrites `vFogWorldPos`, so check it first). IOAccelerator ~200 MB is the
GL buffers (117 [L], led by Nine's aMisc f32x4 15 MB, positions 14, aSpill 12, aOff 7.5, f16 aPat/aFace 7.4 each),
textures 47 and programs 26. "Owned (graphics)" 128 is mostly the browser's: a blank WebGL page holds 108.
Read back from the GPU (`getBufferSubData`), aMisc, position, aSpill and aOff are not float16-exact (14.5, 14.1, 11.3
and 7.0 MB inexact); only the float32 aFace/aPat/aMat/aUv copies (~6 MB) are, so a lossless half repack saves ~3 MB.
A Metal pipeline (a new program, vertex layout or blend state) costs ~0.13 MB of IOAccelerator on a blank page.

## Cut 4: three-byte vertex channels at stride 4; and what else the GPU process holds (mini-ninesteady4)

Engine 89652d01, Nine at control (WebKit [K], `footprint -j` categories). GPU process 452 MB = IOAccelerator (graphics) 201,
owned unmapped (graphics) 128, owned unmapped 57, IOSurface 33, Malloc Small 17.

- **Owned unmapped (graphics) is the active WebGL context, not Nine.** A blank page with one WebGL2 context that clears
  every rAF holds 91-108 MB there (64x64 or 1206x2622 canvas, any context attribute; two contexts 120); it goes ~1-2 s
  after drawing stops. Nine's 128 survives `loseContext`, deleting every GL object, hiding all DOM and WebKit's
  `org.WebKit.lowMemory` (-3 MB). Programs (25 of Nine's, compiled and drawn on a blank page) add none of it.
- **The parameter buffer (owned unmapped, 57) drops to 4 after ~15 s with no frames** (rAF stopped); while playing it
  stays. Split at 100 k: 40 MB, but IOAccelerator +23 (ANGLE's per-command-buffer pools), so no net gain over 400 k.
- **Varying dedupe is not a memory lever.** Metal strips vertex outputs the fragment never reads (blank page, 1.25 M
  big triangles: 8 vec4 written, 1 read = 463 MB; all 8 read = 1,148; 8 identical values read = 1,148). Aliasing Nine's
  read duplicates through a shaderSource hook (`vFogWorldPos`/`wsVFogWorld`/`wsVPositionWorld` are one world position;
  facade's `wsV7`/`wsV8` are both `aMisc`) linked all 65 programs and moved owned unmapped 56-58 -> 55: noise.
- No GL buffer duplicates by content (1,270 buffers, 112.8 MB, 0.3 MB repeated). WebKit's root layer is 12.65 MB in
  every page setup (transparent, hidden root, canvas background): not removable.
- GL buffers by channel [L via vertexAttribPointer]: slab aMisc f32x4 19.0 MB, aSpill f32x3 15.0, aOff f32x2 9.5,
  aPat/aFace f16x4 9.4 each, position i16x4 9.2, normal i8x3 3.7, colour u8x3 3.5. aMisc.w is a bit field (decoded
  with floor and powers of two, ints to 24,335) and xyz hold 15-22 distinct values; aSpill is a 0-5 light spill where
  half precision is far under one 8-bit step. Both are bake-format leads (sharddev: aSpill half, aMisc.w apart as uint16,
  ~15 MB), not engine cuts.
- Textures ~49 MB real (deleting them freed 49 of IOAccelerator): the 9-layer 512² RGBA8 paint array 12.6, light
  volumes 5.6 + 0.6, three sign atlases 2.8 each, render targets 10.5 (three 402x874 RGBA16F).

**Cut 4.** Metal reads a vertex attribute only at a 4-byte stride, so ANGLE keeps a tight three-byte channel (stride 3)
as given and builds a stride-4 copy beside it: on a blank page 4 M vertices hold 28.1 MB (12 + 16) against 16 MB padded.
`render/byteTriples.ts` (WebKit only): `gpuOnlyAttributes` marks each released tight Int8/Uint8 itemSize-3 array, the
context uploads it padded to 4 bytes a vertex and reads it at stride 4; sub-range writes are padded and read-backs come
back tight, so the attribute's CPU shape does not change. Nine's slab normals and colours (8.6 MB padded) now carry no
converted copy. 6 alternating cold WebKit [K] pairs (machine load 8-25 from other lanes): settled GPU 451-455 (median
454) -> 445-449 (447) MB, WebContent 752 -> 749, GPU peak median 612 -> 594, WebContent peak 1,192 -> 1,152 (noise);
EM11 playing 0.98 -> 0.97 GB (upper 1.10 -> 1.09), loading 1.49 -> 1.44 (upper 1.68 -> 1.67). Spawn shots differ in 3.3%
of pixels (rain, crowd).
