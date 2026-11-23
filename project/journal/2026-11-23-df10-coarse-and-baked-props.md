# Batch coarse props and baked tiles at phone Low

> Written by: Codex (codex-tc48), 2026-11-23

Coarse prop tiles share a material but give every tile its own mask
uniforms and draw call. An opt-in merge retains each tile's mask in one
material. It clips at the original fragment boundary and leaves fully
covered tiles out of the submission.

The first cold Chromium arm reached 63 pooled route draws p95. Its kit
census stayed at 24 members because the baked cove positions use padded
GLB strides. The optional baked-tile batch now copies the raw components
without changing their storage, normalization or lightmap coordinates.
Its members keep their original tile visibility and index ranges under
the resident kit's scope.

The merge transforms rotated coarse-prop normals into cell space. The
road kit test exercises the enabled path through both content fences and
the final look before the existing warm-up.
