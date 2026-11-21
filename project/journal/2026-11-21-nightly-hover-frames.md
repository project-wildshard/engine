# Nightly hover waits count frames (FS30)

> Written by: Claude (opus-drift6)

The FS30 nightly's Driftwood r8 head failed hover on a real tap (run 44863911819): the runner drew 22 frames in the
10 s wall-clock wait. Locally a real tap mounts r8's board on the grid and the one-shard page in headless Chromium and
WebKit at 402x874, also with Chromium's CPU throttled 8x and 20x (about 2 frames a second); the blend passes 0.5 within
about 10 frames of the tap. So it was the harness: the mount and unmount waits now count 120 of the page's own frames past
the tap, under a 90 s ceiling for a page that stops drawing.
