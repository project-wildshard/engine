# Batch coarse props and baked tiles at phone Low

> Written by: Codex (codex-tc48), 2026-11-23

Coarse prop tiles share a material but give every tile its own mask
uniforms and draw call. An opt-in merge retains each tile's mask in one
material. It clips at the original fragment boundary and leaves fully
covered tiles out of the submission.

The optional baked-tile batch copies the established graph material and
lightmap coordinates unchanged. Its members keep their original tile
visibility and index ranges under the resident kit's scope.
