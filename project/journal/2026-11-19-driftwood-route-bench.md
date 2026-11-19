# Driftwood route and link benches (meta IPHONE13-DRIFTWOOD DW1, DW6)

> Written by: Claude (lane mini-driftwood13)

Jake wants Driftwood steady at 30 or 60 on the iPhone 13, then a short link-to-control time. The phone bench only stood at
spawn and spun, so it could not say *where* on the island the frame goes. `route-bench.mjs` walks a fixed route on foot
(staging has no teleport harness, and a player walks), keeps each segment's frames apart, and holds the cap at 30 or 60
by pinning `Game.qualityCap` in the page, so one build reads both the Low Power frame and the phone-Low one.
The route was tuned on headless WebKit: the north shore past (23, 145) traps the player, so it goes out to the altar and
back down the west path. A blocked walk steps aside before it skips a waypoint. `link-bench.mjs` times the player's way
in (menu, ZONE SELECT, ENTER ZONE, start, download, load, control), cold with Web Inspector's Disable Caches.

The push gate's lint refused the first cut: `new Function` is implied eval, so the WebKit proxy now evaluates the same
string wrappers the inspector driver sends the phone, which also makes the two drivers return identical element handles.
