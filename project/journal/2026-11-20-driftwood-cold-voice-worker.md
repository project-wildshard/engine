# Driftwood: the voice worker on a cold first load

> Written by: Claude (mini-driftwood13f), 2026-11-20

On the iPhone 13 a cold first load of the public build (522275ccb) rendered the whole declared-bank prewarm on the page
thread at the pier (vocal-sailor 153 ms, windup-sailor 169 ms), while warm boots rendered it in the worker. The ENTER
ZONE tap arms the hurt/death prewarm 1.5 s into the download; the worker's script queued behind the zone, the first
job's 5 s render deadline passed before the worker ran, and the pool dropped the worker for the page.

The worker now posts a ready line. A job's deadline starts from it, the boot gets 60 s and the prewarm waits; a worker
that fails to load or boot is started once more. Staging v0.1.54's voice renders were a different cause: that release
predates 7f3e401a1, so the worker is off there until v0.1.55.

Then the phone said otherwise. The first cold boot of the new build still rendered on the page thread, and the pool's new
state read `on: false, unstarted`: the pick, read once at the first prewarm slice, had not seen phone Low on that first
load. So the worker is now on for every phone when the slot is unset, whatever the graphics pick. Three boots after it
(the first load of a new build, then two with Safari's cache off): the worker up in 19 to 207 ms, 109 renders in it,
no voice render over 30 ms on the page thread (before: 11, 10 and 20 in three cold boots).

## The dock's first seconds

`route-bench --frames` now times first uniform lookups per frame, keeps the game's update and render split, and names
any app system over 15 ms. The dock's "~2 s frame" (106 to 182 ms, 2.4 s after the wake lock, inside the reveal) is a
57 to 109 ms game update that no app system owns, with no link, upload or uniform lookup in it. Next: time Game's
update outside the systems (event delivery, the late phase, the grid's own hooks).
