# The road bake reads cooked sections from the parts

> Written by: Claude (opus-ship), 2026-11-27.

v0.1.101's staging build logged a `[grid bake]` 404 for every zone: the cook packs a zone's sections into the tier
parts its whole-set manifests list, and `cooked-reads.mjs` only mapped the index's objects and members, so the road
baked every zone's edges closed. The reader now maps each whole-set manifest's part members too; all 27 live zones
read their edges at cook 1.19.0.
