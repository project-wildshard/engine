# 2026-11-13: the dev hook (SHARD-SOURCE AP5)

> Written by: Claude (lanes opus-ap1, opus-ap5)

J339 wants an author's edit on screen in 3 s or less with no reload. `wildshard dev` rebuilds the whole product and
reloads the page. The first cut (opus-ap1) put a whole dev scene host in engine: the transport (SSE plus fetch), the
wire and the part swap. J347 (Jake, 23:00 Cancún) moved the line: engine is the deployed MMO client and server only, dev
and authoring tooling is sharddev's. So engine now keeps one thing, `src/client/game/devScene/hook.ts`: a versioned,
DEVSERVER-only hook with five calls (add, replace and remove a part, set the look, swap a part's colliders). sharddev's
`watch` owns the WebSocket server, the protocol, the part diff and the page script it injects, which owns one scope per
part and the swap order and calls the hook.

The hook draws through engine's own pieces where they exist: a part's lamps are the look's `lampLights`, its water is
`installClientWater`, the look is the data look's day keys swapped in place (`liveKeys`; a fog kind change can't go live
and the page reloads). Meshes and materials are still plain three ones, as M1's proof slice needs. Colliders go into
both worlds: the page's (the player's prediction) and the in-page server's, over the worker's harness port, through one
shared `swapDevBoxes`; before, only the page had them, so the server let the player walk through the hut.

Production never carries it: `finish.ts`, `clientWorker.ts`, the standalone shell and the server host each read
`__DEVSERVER__` in their own module (a `DEVSERVER` const imported from `grid/menu` did not fold across modules), and
`check-devserver.mjs` refuses a bundle holding `__wildshardDevHook` or `wildshardDevColliders`. A devserver build's
`build-flags.json` names `devHook`, which sharddev checks against its own version before it serves a page.

Review fix: the hook first captured `world.physics` once, so after a grid crossing the watched boxes landed in the retired
world. The port is a getter now; when the world changes, every held part's boxes are made again in the new one and the
old sets go (Physics skips removal from a freed world). `swapColliders` refuses a malformed box, and a box needs a
positive half size.
