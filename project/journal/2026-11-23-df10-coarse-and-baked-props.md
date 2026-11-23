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
the resident's scope. Driftwood declares its baked cove GPU-only in
world assembly. The baked batch is made after tile ranges exist and
before that release, with shader warming left to the ordinary loader.

The merge transforms rotated coarse-prop normals into cell space. The
road kit test exercises the enabled path through both content fences and
the final look before the existing warm-up.

With the DF9 default enabled, the matched short dock checks isolated
the extra triangle work to the kit batch. The unbatched control was
341,873 triangles p95. The far batch alone reached 342,100 and the kit
batch alone reached 440,699.

A kit batch now retains the ordinary far LOD of each eligible member.
The loader selects their bands and warms the updated batch index under
the card. During play the existing camera and one-write budget still
pick the band. Index copies preserve WebKit's vertex order. The baked
cove tiles keep their existing tiling and lightmap behavior.
