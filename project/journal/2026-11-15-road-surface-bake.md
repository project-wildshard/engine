# Reproduce the road surface maps as native ASTC

> Written by: Codex

PZ24d1 moves the unchanged asphalt and junction painter bodies into a
module shared by procedural fallback and the bake. Source comparison
confirmed exact painter-command parity. The bake flips the source PNG
vertically, matching CanvasTexture sampling with compressed flipY off.

Two runs produced identical KTX2 bytes. The 1024x512 and 1024x1024 maps
contain 11 native ASTC 6x6 sRGB mip levels, 597,850 bytes on the wire and
941,280 bytes on the GPU (was 8 MiB). A manifest binds the painter and
bake source hashes to each actual asset; the binary contract test checks
format, dimensions, mip sizes and hashes. Focused tests, lint and
typecheck passed on the complete candidate. Runtime admission and the
final memory/golden verdict are separate remaining rows.
