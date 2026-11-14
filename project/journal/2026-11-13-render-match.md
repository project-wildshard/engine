# 2026-11-13: render match (meta SHARD-SOURCE M4, opus-mossrender)

- Format 0.5.2: the engine follows 0.5's renames (product to shardfileAssets and friends) by import path only; nothing
  behaves differently.
- Jake ("the cleanroom looks way better then in engine"): the Mossgate cleanroom's look needed hosts a shard could not ask
  for. Added, generic for any shard: planar pool mirrors (desktop; sky water on phones), shadow strength / radius / bias,
  ACES, the look's exposure (it was parsed and never applied), vignette and bloom radius, lamp decay / halos / flicker,
  motes, and a procedural PBR detail layer (J338: no texture bytes). Phones now gate field by field instead of dropping
  the whole look-light row.
- The render hosts' tests: test/look-light.test.ts (phone gating, flicker), test/look-render.test.ts.
- Review MUST (claude -p): a grid cell never runs compose, so ACES and the exposure ride the cell's own display (AcesToneEffect), as Neutral does. Halos dispose their instance buffer.
- CI: lookRender's halos on the model contract's effect list; the wire lockfile entry kept as main writes it.
- M4.8 (opus-mossrender2): the PBR family passes format 0.5.3's `emissive` (sRGB) and `emissiveIntensity` to MeshStandardMaterial, so lit lamp glass can glow while the sun still lights it. Brazier flames need no engine host: the Template draws layered additive emissive tongues.
