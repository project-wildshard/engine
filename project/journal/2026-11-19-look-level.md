# Look level read first (ONE-FORMAT OF9b2)

- 2026-11-19, opus-of9b2: format 0.51.0 gives the level look a home in
  `look/look` (`look.level`: the manifest's sky, atmosphere, grade and
  horizon, same schemas, byte for byte). The engine pins it and reads
  the look first.
- `declaredLevel` (shardfile/declaredLook.ts): a declared page and a
  grid cell holding a declared product (`regionalWorld`) take
  `look.level`; a product built before OF9b2 has none, and its
  `ui/level` manifest fields are lifted at the door (format
  `levelLook`); with neither, the discovery manifest's, as before. OF7's
  height fog and desktop bloom still lay over it on a declared page.
- Discovery stays the pre-admission copy: the SDK writes the level look
  into discovery too, so the grid page's shell (`gridPageShell`), which
  reads the home's level before its product admits, is unchanged. A
  discovery with none stands on `PLAIN_LEVEL_LOOK` until the product
  admits. OF9b5 trims discovery and must move that reader first.
- Parity is by construction (the same values reach `toLevelSpec`); the
  staging before/after shots are on the OF9b2 board.
