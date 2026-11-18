# MG8: the engine moves to shard-format 0.34.0

Lane mini-mg8, branch `plan/mg8-format-pin` (MEMORY-GATES MG8).

The engine pinned format 0.21.0 while the shard repos and api-server moved to 0.34.0, so
0.34 shard products (Nine's half-float light spill among them) could not reach a cook. The
breaks between the two versions, and what the engine does about each:

- `validateGraph`'s `trustedBudget` option is `declaredBudget` (0.27, OF15d): renamed at
  every call and test.
- Skin rows may name clips freely (0.27): the rig's `ClipName` also admits the format's
  `CreatureSkinClipName`. `bindRig` binds by name, so a named clip binds like a family clip.
- Memory categories carry the cold-boot breakdown `boot` (0.23): the developer warning
  lines list only the numeric categories.
- `actors/moves` admits `leap` (0.28, CC17a): the runner refuses it by name until CC17b.
- `@wildshard/wire-released` stays at `669d1fc`: `packages/wire` is unchanged.

The 0.34 check gate refuses the engine's pinned Driftwood, Nalati, Nine and Pine products
(`test/cook-built-shards.test.ts`): stale memory epoch 1 measurements and estimates over the
1.5 GB phone line. The branch lands only once those pins move to revisions that pass; the
test is not loosened.
