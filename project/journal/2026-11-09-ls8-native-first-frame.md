# LS8: native worlds' first frame on the bar

> Written by: Claude

LS8's native half (J188). Driftwood, Pine, Nalati and Nine still build their worlds in TypeScript, and their Load
rows had no measured weights: every row an equal share, so Driftwood's first frame, 47 s of a 77 s boot in headless
Chromium at 4x CPU (SwiftShader), was 1/31 of the Load bar and moved it 0.01 % a drawable. Its slices of up to eight
drawables took up to 4.9 s each.

- `loadingPaths.ts`: the native and hybrid path carries Driftwood's measured row seconds, the same proof and profile as
  the shardfile table (build d0f800b-mw9lffqd). The grid path stays equal until measured.
- `parkedDraws.ts` `narrow`: once one slice's pause outlasts `afterMs`, the slices not yet drawn are planned again
  under a smaller budget. `Game.firstFrame` narrows to one new material after a 400 ms fence (FIRST_DRAW_NARROW), and
  counts its world section by drawable, so narrowing changes no total and the bar never runs back. A fast GPU never
  trips it: WebKit's first frame stayed 695-730 ms over four runs, 83-84 units.

Driftwood, Chromium 4x CPU, loading-card-proof --throttle (before 4f31a1d, after this tree): longest stretch without
1 % 18.6 s -> 5.8 s; stalled time 51.8 s -> 41.0 s; stalls 5 -> 14 (they are shorter: twelve are 2.0-3.3 s); ready
76.8 -> 80.6 s, first frame 47.0 -> 48.7 s. WebKit stays at 0 stalls, ready 4.8-5.7 s.

Still red, and why: on SwiftShader one program's first draw is a single fenced unit of 1.6-1.8 s, and the first full
shadow map 2.7 s. Counted per drawable, slice or pipeline (all three were measured), such a unit earns under 1 % of
the bar, so the strict 2 s rule cannot pass there without splitting a draw call. Sky (2.4 s, the KTX2 transcoder
worker and the backdrop) and props (3.1-3.8 s) report no count inside themselves either.
