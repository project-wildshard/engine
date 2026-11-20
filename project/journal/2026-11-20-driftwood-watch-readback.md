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
