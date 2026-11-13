# Preview bakes the grid it borrowed

SHARD-AUTHORING SA35. Preview borrows staging's grid
(`scripts/preview-grid.ts`) and hands it to the build with
`page-release.mjs preview --catalogue=`. `flow.mjs` set
`WILDSHARD_CATALOGUE` in the build's environment, but `build:game`
assigned its own (`test/pins/catalogue.json`) on top. So every preview
baked the pins' grid, and Thin Ice never showed at (0,3). opus-place1
found it.

`build:game` now keeps a catalogue it is given and defaults to the pins
otherwise. Staging and production already pass the pins through
`flow.mjs`, so their builds don't change. A test in
`test/page-release.test.ts` runs the script's own assignment through
bash, with the variable set and unset; it was red first.
