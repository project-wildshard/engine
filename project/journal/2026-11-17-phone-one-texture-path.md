# 2026-11-17 — the phone has one texture path (ENGINE-MEMORY EM26)

> Written by: Claude (lane mini-em4)

EM26 asked that shard textures on the phone tier load as KTX2 only, with the images-first route (decoded RGBA) kept
for desktop and Developer mode. `texModeWhy` (`boot/gpuFiles.ts`) already picked KTX2 automatically for a shard with a
KTX2 set, but a level's tier texture policy came first, and Nine Dragon's discovery says `phone: textures: "img"`. On
the phone tier a shard with a KTX2 set now loads it whatever its tier policy says. A harness pin still wins, and the
GPU veto after it still turns a GPU that samples the transcoder's targets wrong back to images. Desktop keeps its policy.

Nine at phone Low (headless Chromium on the mini, after two forced collections, ledger [L]): `gpu:texture` 94.5 → 58.9 MB,
`ram:image-bitmap` 14.7 → 0 MB; decoded image uploads over 1 MB 7 (26.5 MB) → 1 (2.1 MB). Ready time 5.7 → 6.1 s, one
pair; the look at phone Low is unchanged (screenshots side by side).

`scripts/memory/uploadRecorder.mjs` is the check: it wraps `texImage2D` and `texSubImage2D` and logs each level-0
upload from a decoded image (ImageBitmap or `<img>`) over 1 MiB at four bytes a texel. Render targets, canvases and data
textures the engine generates are not shard texture files and are not counted. T1's phone world (Template) installs it,
and `phone.spec.ts` asserts no row. What it still finds elsewhere is content without a phone KTX2 twin (a PNG on Nine,
blob webps on Pine, Far Reach's model atlases); those are a sharddev row, not an engine path.
