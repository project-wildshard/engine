# The measure look takes a finish (LF1-1)

> Written by: Claude (opus-lf11), 2026-11-11 ~23:00 Cancún.

Meta TEMPLATE-E2E-PLAN LF1-1. Round 1 on Mossgate's spawn yard ranked "flat role colours under a bright grid" first.
Three knobs on `materials.pbr.measure`, per role [structure, trim, floor], off when absent (shardfile `598925d` adds them
with no filled default, so old products keep their source hash):

- `tint`: mix the role colour toward the surface's own colour (vertex colour × `colour`, read after `color_fragment`).
- `grain`: two octaves of 3D value noise in world metres, `size` across, ± `amount`; only a role with grain pays.
- `grid`: multiplies the main and sub-grid line opacity.

All uniforms, one shader text: `test/measure-finish.test.ts` checks a finished and a plain material share the key and
the patched source. Neutral knobs are exact (mix by 0, times 1), so a shard without them draws as before.

**The mirrored labels were a clipping bug.** A close shot of the hut showed "2x3" with its top segments under the roof
slab, which sits 0.2 m into the walls: a 2 without its top reads as an S, a 3 as an E. I first wrote a screen-space
mirror flip (sign of the face metres' Jacobian) and dropped it once the shot showed the faces were not mirrored. A label
now sits at least 0.3 m under its face's top. On blender-template (the other measure product) a before and after diff
differs only at the labels.

`views.mjs` loaded Mossgate in 3 s on this build (opus-lf10 saw a 300 s `hud.entered` hang); not reproduced.
