# check-models is a gate again (TEST-COVERAGE row 11)

> Written by: Claude

`scripts/check-models.mjs` came over in the lift and nothing ran it on the tree: it failed with 39 broken rules and no
job noticed (meta AUDIT: "`check-models` fails, and CI doesn't call it"). Its vitest file only fed it made-up file maps.
`test/model-contract-paths.test.ts` now also runs it on the real tree and wants no violations, so a new hand-rolled
`InstancedMesh` / `mergeGeometries` / registry `add` with an `object`, or a stray `defineModel`, fails CI. (Pre-push runs only the Vitest files a change imports into, and this one reads files rather than importing
them, so CI's full suite is the gate.)

The 39 broke three ways. 19 were `*.test.ts` fixtures: the walk no longer reads tests, which are not shipped code. Four
were rule 9 asking for named-place lists in `src/shards/<slug>/`, which engine no longer has (J88): a shard's places are
checked in its own repo, so on the whole tree rule 9 skips a shard with no source here. A file map that names such a shard is still checked (Codex's
MUST: the first cut dropped it). The other 16 are real engine code the lift
brought or that came after it. The 13 draws are declared at its current count with its reason (`DONE`), and the three hosts that
define models from admitted shard data are listed by literal path (`DATA_MODEL_HOSTS`). One more draw in any of them
fails, as before.

Red first: the real-tree case failed with all 39. A planted `InstancedMesh` in `CoinMotion.ts` and a planted
`defineModel` in `Impacts.ts` each fail it.

It earned its keep at once: the land's rebase onto TE-ENG10 (`2a95dd80`) went red on the merge `skinPlayback.ts` added
for a GLB creature's primitives. That one is a creature's own skin, so it is declared too (14 draws now).
