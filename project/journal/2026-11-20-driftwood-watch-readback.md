# Move the desktop world-watch readback off the frame thread

The single-lock Driftwood dock pairs reproduced the native stalls.
The draw-check slot removed the framebuffer queries. The world watch
still spent up to 178 ms in a Canvas2D pixel read.

With `debug.worldWatchDrawCheck` on, transfer the existing 48 px
thumbnail to a worker and read its pixels there. The staged trial's
bitmap creation and transfer calls each took at most 0.1 ms. The
game drew 23–25 frames during the worker round trips. The dock
still had four long frames in each arm.

A watch owns the worker only until the reply, timeout or scope
disposal. An unavailable worker falls back to the canvas read
while the watch can still judge the world. Pixel classification,
the default-off setting and the existing capture remain in use.

The next native desktop trace pinned the thumbnail hitch to Blink's
`DidTerminateWorkerThread`. The JavaScript terminate call returned
within 0.1 ms. Blink then waited for the worker's GPU commands while
retiring it. Asking the worker to close itself still hit the same
path. The grid road-sign painter produced a separate teardown hitch.

Keep one worker and its 2D canvas in the existing opt-in watch for
the level's lifetime. Each look uses the same thumbnail dimensions
and pixel classifier. The worker closes each transferred bitmap,
and the level scope retires the reader. A failed transfer or a
deadline retires that worker and permits the canvas fallback.

A locked staging dock pair at 1496 × 717 and DPR 2 moved four
raw gaps over 50 ms to one. The remaining 159.4 ms gap followed
the road-sign worker's reply, while all three watch samples returned
pixels without a hitch at their old times.
