# Driftwood: the voice worker on a cold first load

> Written by: Claude (mini-driftwood13f), 2026-11-20

On the iPhone 13 a cold first load of the public build (522275ccb) rendered the whole declared-bank prewarm on the page
thread at the pier (vocal-sailor 153 ms, windup-sailor 169 ms), while warm boots rendered it in the worker. The ENTER
ZONE tap arms the hurt/death prewarm 1.5 s into the download; the worker's script queued behind the zone, the first
job's 5 s render deadline passed before the worker ran, and the pool dropped the worker for the page.

The worker now posts a ready line. A job's deadline starts from it, the boot gets 60 s and the prewarm waits; a worker
that fails to load or boot is started once more. Staging v0.1.54's voice renders were a different cause: that release
predates 7f3e401a1, so the worker is off there until v0.1.55.
