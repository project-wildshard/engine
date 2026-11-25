# The dev world's server bakes its client build's catalogue

> Written by: Claude (opus-ma2), 2026-11-25, meta QA 11-24 row 45 (MA15).

MA15's multiplayer half needed proof-stranger in a room. J453 keeps a proof slug off the staging grid, so it ran on a local
`pnpm dev` world instead: a devserver client built with `WILDSHARD_CATALOGUE` naming a catalogue that places the slug on a
free ring-3 cell (`measure.mjs --place`), then `dev.mjs --shard proof-stranger --dist <that build>`.

The page loaded the shard, sent its hello and then left for Pine Hollow ("online seat elsewhere (pine-hollow)"). The server
bundle of a non-staging dev world was built on the in-tree catalogue, where proof-stranger has no cell, so `cellFrame` sent
it as frame 1 (the unplaced frame). The page numbers frames by its own baked catalogue, where frame 1 is the first grid
cell, Pine Hollow. Moving the slug's cell to the front of the build's catalogue made the page enter, which named the cause.

The fix: `devServerBuildArgs` always passes the client build's `catalogue.json` to `build-server.mjs` (staging mode already
did), so the server and the page number cells from one document. `test/dev-world.test.ts` pins the arguments.
