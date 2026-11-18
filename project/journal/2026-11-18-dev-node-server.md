# 2026-11-18: `pnpm dev` runs the game server as a local Node process

MEMORY-STRUCTURE STR2 and STR3 (J414, J419). Jake: the in-page server worker belongs only to the deployed, offline-friendly
preview. Dev now builds a devserver client and starts the dedicated server (the rig's path) on loopback, with saves on disk
in PGlite under `tmp/dev-world/`. The page port stamps each document with `__WS_WORLD__` on the way out instead of baking
it into the build, so any build joins and the stamp never couples a build to a port.

Measured on the mini: first `pnpm dev` (pins, gen, build) about 15 s to the URL; a server edit restarts the world in about
1.5 s and the T1 page is seated again inside 10 s; a client edit is about 12 s (19 s when it touches admission source and
the pins revalidate).

## STR4: the dev control channel

The in-page server took the harness verbs and the dev hook over its harness port; the Node server takes them on
`POST /__dev/control` beside its socket, from a loopback peer, for one seated device, and the worker that holds the cell
applies them (`dedicated/devControl.ts`). It is compiled only with `build-server.mjs --dev` (`__DEVSERVER__`), which dev
uses; the box's bundle has none of it (a bundle test greps both), and `--dev --tar` is refused. A DEVSERVER page's online
shell posts its verbs there. Not carried: the AP19 soft restart (a Node dev server restarts as a process instead, STR6) and
a harness bot's second client (`join`), which stays on the preview's in-page server.

## STR9: left to the armed-zone policy

STR9's draft booted every native reading online. Main's J426 armed-zone enforcement (`8aca05fa`) already boots armed,
placed zones online (`armed.mjs` `footprintBootFor`) and installs the pins the local server reads, so this branch keeps
main's `scripts/memory/ci.mjs` and `ci.yml` as they are. STR9 stays open on that policy: the baselines re-pinned with
`boot: online` and the preview's standalone reading printed beside them.
