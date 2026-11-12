# Default water surface (LF1-3)

> Written by: Claude (opus-lf13), 2026-11-11 ~23:25 Cancún.

- Meta `TEMPLATE-E2E-PLAN.md` LF1-3: Mossgate Hollow's pond read as a grey crater. The template is a no-code shard: its
  `water` declares the pool, and it has no client plan, so it cannot declare a `world.water` graph surface (that needs
  a look graph, a geometry file and a `client/plan` section the author kit's shardfile has no field for). The stand-in
  plane `installClientWater` draws was its only surface, and it was matte grey (roughness 1, no reflection).
- Fix, general for every author: a declared body the look gives no `water` material draws `defaultWaterMaterial()`:
  three's standard material, patched through `patchShader`, with a Fresnel reflection of the scene's own light (fog
  colour at the horizon, the hemisphere's sky colour above, the first directional light's glint), world-space ripples
  faded with distance, and a Fresnel alpha so the bed shows when looked into. One material, one program. A look
  `water` material still wins.
- Proved on the template (sharddev `b71cc32` packed and pinned locally): programs 36 at load and after the t1-08 pose
  (the old grey plane's program is replaced, one patched program added); the bridge walk swims (y -2.95) before brazier
  B and crosses dry (y 0.12) after. Shots in `template-e2e-v3/progress/t1-08-pond-{before,after}.jpg`.
- `views.mjs` hung again on its `hud.entered` wait (150 s); a desktop Playwright pose script loaded in 2 to 3 s.
