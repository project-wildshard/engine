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
