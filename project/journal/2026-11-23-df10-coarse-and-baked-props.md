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

With the far copies and all four batches enabled, the complete Low
grid route measured 59 pooled draws and 394,793 pooled triangles at
p95 on `518e4f35d`. The road used 60 draws and 397,637 triangles at
p95. The independent J430 judge passed all 18 dock and road views.
The four slots now default on at phone Low and accept explicit opt-outs.

A fresh default boot reached 61 pooled draws, with the extra draws in
the village and quest fire views. Its kit census split the same flat
kit and still materials into four batches solely on whether a source
mesh had a normal attribute. Those layouts now share their material's
batch. The copies keep the normals the source provides.
