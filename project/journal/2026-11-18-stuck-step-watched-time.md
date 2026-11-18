# The stuck-step watchdog counts only the seconds it saw

The hosted ledger ratchet went live in 19e00075. On its first push run
(44276449981), Driftwood's reading never reached control. The game's
own watchdog opened the fatal modal: `The game stopped loading at step
"props" (no progress for 61 s)`.

It is the same blind spot as the tile fence an hour earlier (see
2026-11-18-tile-fence-watched-time.md). On hosted SwiftShader the
page's main thread blocks for many seconds at a time; Nine's boot
timeline shows one 23 s block with no page row at all. The watchdog
ticks once a second and compared plain elapsed time. Its first tick
after a block counted the whole block as a stalled step, although
nothing could move while the page was blocked.

`watchStuckStep` now adds at most two ticks (2 s) per gap between
ticks, and reports the time it counted. A boot that really stops, with
ticks every second and an unchanged card, still trips at the bound. The
existing tests still hold.

The new test blocks the page for 55 s with no tick, then lets the card
move: the old clock read exactly "61 s", like the hosted run, and the
new one keeps waiting.

What blocks the hosted page that long is still open (the mini lanes'
NOTE).
