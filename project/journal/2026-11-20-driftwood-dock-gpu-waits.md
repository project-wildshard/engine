# Driftwood dock: the long frames' GPU waits, named (2026-11-20)

> Written by: Claude (lane mini-driftwood13i)

On the iPhone 13 at cap 30, `route-bench --frames` now names the page's own GPU waits and long timers beside each frame
over 50 ms. The world watch's four looks after control cost 11 to 22 ms each (a 48 px copy of the canvas, then
getImageData), and DrawCheck's two pixel reads 4 to 24 ms. The dock's update spikes are one-offs, not steady work:
game.grid.session ran over 15 ms once in 2,800 runs. The Web Inspector Timeline is not usable on the phone: its records
flooded the proxy and every route evaluation timed out.
