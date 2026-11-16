# Replay released saves against their actual inputs

TC44/EG-31: the boundaries report installed Ring 1's frozen Blender
hall while the released-save fixture names today's changed level.
Its native cases also eagerly read client GLBs absent from server
slices, failing before restore. Use the resident's server asset class
and run released saves in their own scheduled/manual job against the
current immutable pins. Preserve every save byte and assertion.

All nine cases pass on current full pins in 6.29 seconds (maximum
case 2.443 seconds). All six native saves also pass on the actual
server slices in 2.27 seconds; no missing client GLB reads. Compiler,
focused typed lint and actionlint pass. Epoch-wipe, two-build browser
upgrade and VPS grace remain separate open TC44 criteria.
