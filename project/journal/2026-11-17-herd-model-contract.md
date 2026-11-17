# Herd LOD draws in the model contract

> Written by: Codex
> **State:** fixed on engine main, 2026-11-17 (J249).

Hosted run 44185630654, tests (4), found two undeclared draws in
`bakedHerd.ts` and `herdSprites.ts`. Each helper draws one batch of
creatures that already belong to the model catalogue. Declare the two
draws by file with a ceiling of one each.
