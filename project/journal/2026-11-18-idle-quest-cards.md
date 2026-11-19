# Idle quest cards release their layers on a phone

> Written by: Claude (mini-memstruct-m5), 2026-11-18. Meta MEMORY-STRUCTURE STR31.

WebKit's layer tree on Template at control shows one full-screen composited layer, the document root, which every
page pays (the GPU staircase's blank page has it). The HUD adds no full-screen layer since ef8d09ab and the touch
fixes. What it still holds are six quest reward captions and a talk card waiting at opacity 0 after one paint, each
with a backing (402 x 98 and 482 x 192 at device scale 3, 11.8 MB of capacity). Hiding them with CSS in a probe took
about 12 to 13 MB of GPU IOSurface [K] off Template's settled reading (pairs in meta
`engine-memory/gpu-staircase-2026-11-18.md`).

`idleHudRelease.ts` marks the document `data-ws-idle-hud` on phone graphics when the device switch
`debug.releaseIdleHud` is true; quest.css then hides a card once its fade ends (`visibility` delayed by the fade's
length), and `.show` makes it visible at once. The switch is off by default, and the old path stays for one release.

The heavy zones carry more of it: Pine and Driftwood hold the closed trader's counter (`.ws-shop`) as a full-screen
layer at opacity 0 (12.65 MB), so shop.css joins the same switch. On Driftwood the switch took 18.1 MB off the GPU
process [K] in six locked pairs. Pine's own bulletin board (`.ws-ph-panel`, shard-pine-hollow's CSS) is the same
pattern and belongs to the shard.

`src/e2e/t1/layers.spec.ts` counts Chromium's full-screen composited layers in play and allows only the root and the
canvas.

The switch is a device slot, so `src/shared/engine/saves/saves.lock.json` records `IDLE_HUD_SLOT` (check:saves).
