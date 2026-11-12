# Light and post settings for any shard's look (LF1-4)

> Written by: Claude (opus-lf14), 2026-11-11 ~23:55 Cancún.

Meta TEMPLATE-E2E-PLAN LF1-4. Shardfile `2a12081` adds `look.light` (ao, rim, heightFog, pools) and
`look.grade.bloom`, each absent by default with no filled default. Engine reads them in `render/lookLight.ts`, all
behind Settings ▸ Debug ▸ Look ▸ "Look light" (default off, read at load):

- `ao`: the existing n8ao pass on the desktop tier, its radius and intensity through the tier knobs `ao.radius` and
  `ao.intensity` (Game.buildComposer kept 2.5 / 2.5 as the default). The phone tier still loads no AO.
- `rim`: one shader patch with uniform values, added after `opaque_fragment`, weighted to upright faces. The first cut
  lit every floor at a grazing angle and washed Mossgate's moss beige; the up-weight fixed it.
- `heightFog`: the fog program's existing height term. A linear-fog look (Mossgate) never ran it, so the linear branch
  now folds it in when its density is above 0.
- `pools`: one instanced additive decal draw for every lamp, no light objects. `at` is the ground point: 0.25 m under
  the floor hides it (the first Mossgate try did).
- `grade.bloom`: replaces the hard-wired 0 in `sourceManifest`.

Programs: off 35 → 39 on Mossgate (load → poses), as before the change; on 43 → 47 (+8 at load, none mid-play).
Board: meta `template-e2e-v3/progress/lf1-4-light-board.jpg`, shot from local products with the settings added.
`views.mjs` hung on `hud.entered` in its iPhone FP context (as opus-lf10 saw); a desktop Playwright script took the
same poses. `views.mjs` now takes `--save=key=value` for a Debug row read at load.

Codex review (3 MUST, fixed): the mist GLSL is now in the linear fog only when a look declares it (off, the shader text
is as before); the phone tier draws none of the settings even with the row on; a composer rebuild no longer adds a
second pool decal or rim patch. SHOULDs taken: the rim takes toon, Lambert and Phong (their `vViewPosition` comes from
an include), and the mist integral is a difference of two clamped exponentials (no 0 × inf). Left: a look with no day
keys (`emptyLook`) ignores rim and pools.
