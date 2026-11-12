# LF1-2: emissive prop surfaces (TEMPLATE-E2E, opus-lf12)

- `props.materials` already let a props GLB material name bind to any `look.materials` entry, emissive included (SF55).
  The gap: the family variant set `vertexColors` from the mesh, so an emissive lamp baked with grey vertex colours drew
  amber × grey. An unlit (MeshBasic, the emissive family) base now takes vertex colours only when it declares them.
  No pinned shard binds a prop material to emissive, so nothing changes for any shipped look.
- Draw cost: the format's GLB cost already charges each primitive (×2 with a shadow), so a lamp is +1 draw per tile it
  sits in, +2 if it casts a shadow. The test pins it.
- Found: a shardfile shard's grade has bloom hard-wired off (`plugin/context.ts`, `bloomIntensity: 0`). The emissive
  output is HDR and bloom-ready, but a shard can't declare bloom until `look.grade` grows a bloom field (shardfile).
- Proof: `~/.cache/wildshard/plan-artifacts/look-loop/lf1-2-glow.jpg` (before, emissive without bloom, with bloom).
