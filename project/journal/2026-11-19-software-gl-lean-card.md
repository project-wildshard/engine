# Software GL paints the lean loading card

TR-4b. Hosted T1 boots of Brasscap took 55 to 65 seconds on SwiftShader, so every suite with two boots (G, H, J, K) ran past its 120-second budget. A trace of a SwiftShader boot showed the GPU process's main thread busy most of the time rastering the full loading card: the 10 Hz clock, the 5 Hz facts and each bar's width transition repainted it, and with software raster each repaint costs about 16 ms in the same queue as the world's GL work. One synchronous `getExtension` sat 1.3 seconds behind it, and each fenced first-frame unit waited a painted frame.

The lean card (IP33, behind `debug.leanCard`) paints at 4 Hz with stepped bars and no blur. Two alternating desktop pairs on SwiftShader: the full card took 40.6 and 33.7 seconds to control, the lean card 26.6 and 24.8 seconds; the first frame fell from 22.4 and 18.9 seconds to 13.4 and 12.5. So a page whose WebGL renderer is a software rasterizer turns its card lean from the renderer step on. A real GPU never takes this path, and the debug slot still decides for everyone else.

The second-world stall is the same queue: a second live world beside the worker's world on SwiftShader never left its shaders or road-grain wait while the first world drew. Navigating the first world away resumed the second within about two seconds and it reached play. That is starvation of the one software GPU process, not a lock or a lost wakeup, so G's `about:blank` release stays the fix.

## Hosted I and K still over the line (opus-tr4b, later)

On run 44525927591 (7a156e7b4) hosted I and K were killed by the runner's
130 s deadline (receipts 132.2 s and 130.2 s); K had passed at 119.7 s on
320e5897d, so both sit right on the line and hosted noise tips them over.
Locally on SwiftShader K passes in 45 to 60 s. Each Brasscap entry now
prints a `[t1-boot]` line (time to play plus the level.world, assembly,
home, shaders and firstFrame steps) so the next hosted run says which
step eats the budget instead of only "killed".

## B's gate walk and the full boot line (opus-tr4b2)

Hosted B (run 44527365455) went red with the canyon gate still shut 5 s
after its fixed 500 ms walk and E press: on software GL the walk and the
press were tied to a slow frame rate. `openGate` now holds W until the
HUD shows the gate's prompt, then presses E, as a player does. The
`[t1-boot]` line now lists every loader stage of 0.5 s or more with its
start: locally on SwiftShader `firstFrame` is 12.6 to 13.5 s of a 24 to
28 s boot, while hosted boots run 35 to 76 s (run 44529532710), so two
boots plus their waits overrun B's and H's 120 s.

## The first frame's binding fence on software GL (opus-tr4b3)

A first frame that starts narrow (only a software rasterizer does, by
`slowShaderGpu`) kept FIRST_DRAW_NARROW's one new binding a slice, so
Brasscap's 770 parked drawables, nearly all first-use bindings over
programs the shaders step had linked, drew as 770 one-frame slices.
SwiftShader now slices by 32 drawables and 32 new bindings, still one
new program a slice: local SwiftShader `firstFrame` 12.6 s became 6.3 s
(A, load 7 to 9), and 128 a slice measured no better (6.8 s). Metal
never starts narrow: A's `firstFrame` stayed 0.5 s (two runs). The
`[t1-boot]` line also names `control` and each of inPlay's waits, so a
hosted run says where the time after the loader goes.

## K's release read moves to boot start (opus-tr4b3)

K's 503 page showed only once the whole grid boot reached the server
step, because `startOnline` was the release file's only reader: 19.6 s
locally on SwiftShader, about 49 s hosted, and never when the boot
stalled at `home` first. The boot's data step now begins the same read
(`readOnlineReleaseEarly`), with its pages and retry ladder, and
`startOnline` dials what it heard. Locally the page shows after 6.2 s.
The 503 load still boots the grid (no word: J300) and reshards to the
one-shard page once the healed read lets the server step hear the
world, so K is still two boots.

## The GPU's part of a frame paces software GL (opus-tr4b4)

After control every hosted boot still spent 16 to 26 s: five game
frames, then 30 worker frames, at about 3 fps (run 44542508555's D:
2.8 and 3.0 fps with a p95 main-thread frame of 5 to 6 ms). A rAF
trace on local SwiftShader showed why: the main thread's part of a
frame is 4 ms, and the next animation frame comes 83 to 100 ms after
a drawn one, held back by the GPU process rastering it. RT3's pacing
measured only the main thread, so its render scale never left 1.
The gap after a drawn frame now counts as that frame's cost, and the
scale settles at 0.5 (local fps 10 to 14.5; 0.5 alone measured 18.5
against 8 to 12 at 1). Seen once beside a load of 32: A's boot sat in
`home` for 112 s with no network after 6 s, the K stall's shape.
