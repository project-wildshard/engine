# The unread art leaves engine git (SF13)

Lane opus-public, meta standalone shardfiles SF13 (J525). SF1's verdict
list put 29 files on `public-delete.json`: read by nothing. They go: the
`forest_leaves_02` and `roof_planks` texture sets, the stale
`baked/skin-fixture` copy (sharddev's skin bake writes its fixture into the
SDK's own `public/` now, `packages/sdk/scripts/bake/skins.mjs`, not
engine's), the two `qwantani` `.hdr` skies that have gain-mapped pairs,
and Driftwood's two engine copies of its `lm-ao` phone KTX2 (its
shardfile carries the one it reads). The trailers and the Crossroads rig
are QA 11-26 row 14's, not this row's.

The list is empty now, so SF12's check refuses any of them coming back,
and the verdict test fails if a listed file is still in engine git.
