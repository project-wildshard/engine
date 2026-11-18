# 2026-11-18: `pnpm dev` runs the game server as a local Node process

MEMORY-STRUCTURE STR2 and STR3 (J414, J419). Jake: the in-page server worker belongs only to the deployed, offline-friendly
preview. Dev now builds a devserver client and starts the dedicated server (the rig's path) on loopback, with saves on disk
in PGlite under `tmp/dev-world/`. The page port stamps each document with `__WS_WORLD__` on the way out instead of baking
it into the build, so any build joins and the stamp never couples a build to a port.

Measured on the mini: first `pnpm dev` (pins, gen, build) about 15 s to the URL; a server edit restarts the world in about
1.5 s and the T1 page is seated again inside 10 s; a client edit is about 12 s (19 s when it touches admission source and
the pins revalidate).
