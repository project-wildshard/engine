# P1: Driftwood's enemies invisible on staging (2026-11-22)

> Written by: Claude (opus-of-close2)

Jake, ~21:15 Cancún: every Driftwood enemy invisible on staging. v0.1.72 baked Driftwood r8's client product (it still carries `actors/species-programs`) beside the box's r9. `nativeDeclaresOwnSpecies` and client.ts `declaredNativePage` refused to declare whenever that section was present, and Driftwood's plan has no feature that reads it, so only kit boar and bear were registered and the page said "a row of 'crab' has no species on this page; not drawn". Now an unread programme section does not count. Local proof: `pnpm dev` with r8 pinned draws 11 creatures, no warning; `test/native-species-owner.test.ts` is red on the old code for Driftwood and Pine.
