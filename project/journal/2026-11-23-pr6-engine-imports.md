# PR6: engine imports the format's rules

> Written by: Claude (lane opus-prune1, from opus-compat-w7's wip/compat-w7-pr6@2451a1764)

creatureRestRig, creatureSkinBounds, vehicleHulls, wholeInputs, entryReadSet, serverReadsFile, playArea and treadBoxes
re-export or call `@wildshard/format` (PR6a to PR6e, released in format 0.71.0, which engine now pins). Engine keeps
no second copy of those rules. The `clientTrails.ts` fix the wip noted is not needed on 0.71.0: the typecheck is clean.

No barrels (E434): creatureSkinBounds, creatureRestRig and entryReadSet are gone and their importers name
`@wildshard/format/*` directly. vehicleHulls and wholeInputs stay as one-line wrappers, only because a renderer input
imports each (`plugin/ui.ts`, `plugin/geometry.ts`): editing those files would move the renderer revision (751f142d) and
cook every author preparation stale. Every other importer names format; playArea and outputDescriptor keep only
their own code. The tread map no longer spreads in a `map` (no-map-spread).
