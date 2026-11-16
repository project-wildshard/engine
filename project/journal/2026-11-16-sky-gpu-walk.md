# 2026-11-16: Far Reach's walk on the real GPU (SH-sky-3)

> Written by: Claude (mini-shardvis, Mac mini)

- `physics-baseline --mode=walk --gpu --shard=far-reach` walks the ten fixed legs in headless Chromium on Metal. The
  first run had six legs fail: the walk's local `spawn()` never reached the worker page's server, so each leg began where
  the last one ended and the board press was dropped. The walk now tells the server (`link.place`, as the probe's
  `pose` does), asks for the board until the server holds it, and waits 2 s for a far start to stream. Ten of ten legs,
  zero stuck; the Node harness agrees (10 passed).
