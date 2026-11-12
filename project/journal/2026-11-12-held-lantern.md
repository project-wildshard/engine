# 2026-11-12 held lantern stand-in (opus-greybox)

- The "grey 1 m box beside spawn" in every Template 1 first-person frame (TEMPLATE-E2E-PLAN LF1-6) was the held
  lantern: `tool.template-lantern`, `kit.lantern`, off-hand at (-0.3, -0.3, -0.55), drawn by `itemMesh` as a bare
  `BoxGeometry(0.12, 0.18, 0.12)` in the row's `#888888`. Found by walking the camera's children in a headless preview
  (`camera > viewmodel > Group > Mesh`, 0.58 m from the eye) and hiding that mesh.
- `lanternMesh` now builds a lantern (base, posts, top plate, pyramid roof, carry ring: one merged draw in the row's
  colour, plus a glass core). The lit glow becomes a core over the glass; an asset-backed row keeps the old band.
- Sharddev sets the row's colour to brass (`#b08a4a`) and drops the unrelated grey scatter cubes on the pond's banks.
