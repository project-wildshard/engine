# LD5: the server boots beside the frame steps

On Jake's iPhone the Worker boot step was the last 5.1 s of Load, after the first frame and both
program-link steps, though the server runs on its own thread. `finish.ts` now starts the standalone
server (its page-side modules, the page save carry into IndexedDB, the worker and its world boot)
right after the home region and road steps, once the player and saves are placed; the Worker boot
step adopts that boot and counts the reads it already answered. A one-shard page of a build with a
world still joins at its step. A level left before adoption saves and stops the early server, as an
adopted one does; a server started for another world is stopped and waited for. Plan: meta
`docs/plans/LOADING-DIAGNOSTICS-PLAN.md` LD5 (J208).
