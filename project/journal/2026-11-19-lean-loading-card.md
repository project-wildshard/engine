# The lean loading card (meta IPHONE13-REAL-TEST IP33)

> Written by: Claude (lane mini-loadcard), 2026-11-19

IP32 found about 100 MB of loading-card layers in WebKit's GPU process on Nine's phone boot. Two full-screen layers
(the root and `.ws-load`) and the glass panel (its own layer, for the backdrop blur) were repainted about 30 times a
second, so every layer kept a front and a back buffer. WebKit's layer tree shows why the rate was so high. The 100 ms
clock and the 200 ms facts did not cause it alone. Each bar write started a 0.1 s width transition, which is six more
paints, and the panel and the card always painted together.

Behind the device slot `debug.leanCard`, the card:

- paints the clock and the facts in one tick every 250 ms;
- holds a download event's text and bars for that tick;
- steps the bars without a transition;
- drops the panel's backdrop blur, so the panel paints into the card's one layer.

On Nine, `.ws-load` painted 37 times per boot instead of 189, and the panel's 6.2 MB layer is gone. In locked WebKit
phone-Low pairs, the GPU process's loading peak fell 24 to 35 MB on every one of the 15 pairs (Nine and Pine, alone and
stacked with `debug.phoneBudget` and `debug.loadGc`). Time to control was no slower.

The go line was Nine's worst boot −40 MB, with 3 of 3 pairs lower:

- Stacked, the go line was met: −61 MB, 3 of 3 lower.
- Alone, it was missed. Two sets each had 2 of 3 pairs lower, because WebContent's ±100 MB boot-to-boot noise swamps a
  30 MB cut.

So the switch ships off (`LEAN_CARD_DEFAULT`). A blind Opus judge found no visible change at three progress points. The
two bars it saw lagging their numbers were the old card's transition.
