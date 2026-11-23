# NB2 seat hold, proven locally (opus-compat-w3, 2026-11-22)

J490 moved NB2's staging proof to a local build. `scripts/seat-hold-proof.mjs`
opens the online rig (signed grid world on loopback, this checkout's client
and server) with Sunscar Dunes beside Driftwood, then two headless Chromium
clients: a desktop page that stays in Driftwood and a phone page (402x874,
pixel density 3, touch). The phone's fresh Driftwood pick inside its Dunes
hold lands in Driftwood and the desktop sees it there; closed, its body is
still held at 240 s and the phone returns where it left; closed again, the
body leaves at 301 s. A grid page reports its cell through the grid's
`inside`, not the level id (`platform.grid`).
