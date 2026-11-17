# 2026-11-17 grid cell scene life (opus-ss16r, SHARD-SOURCE SS-SHIPb)

Staging Mossgate's lanterns hung still and its yard drew no detail grass, while the devserver page swung and drew both.
A grid data cell never runs `ShardfileClient.world()`: the session's tile admission compiles the look materials (and
their swing uniforms) but nothing installed the detail layers, the swing field, the splash or the wind clock. A probe on
staging (bundle patched in the route) showed zero `SwingField`s and eight compiled swing shaders.

`grid/cellSceneLife.ts` installs them per admitted data cell beside `NeighbourLife`, stepped only while entered (G663).
Copies of one slug share one material set and so one swing uniform set, so a twice-placed slug keeps its swings still.

Review fixes (same day): the feet the cells read are home-frame scene metres (world feet minus the home origin, as the
border shimmer reads them), a second copy of a product stills the first before its field could rewrite the shared pivots,
each cell has its own scope, detail layers are built on first entry, and `SwingField.dispose` zeroes its state.
