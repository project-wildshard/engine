# Brasscap gunfire: a shot you can see land

> Written by: Claude (opus-brasscap-combat). QA 11-19 rows 42 and 44.

Jake on his iPhone, staging v0.1.50 with Brasscap rev 9: "The reloading animation's trash ... there's no particle
effects ... There's no bullets", "Long rifle looks like dog shit", and on the Dust Wyrm "no feedback on what's a miss,
what's not a miss, what is not damageable zone". The lever-action family fired a round the server owns and showed
almost nothing on the page: a small flash sprite, no tracer, no dust where it landed, and the reload only tipped the gun.

What changed:

- `fx/gunfire.ts` is one pooled world-effects kit for every gun on the page: tracers (a hot streak that runs from the
  muzzle to where the round stops), world muzzle flashes, dust clouds on top of the `Impacts` bursts, and the camera
  kick and shake. `Gunfire.current()` lets a view reach it without a handle; creature guns use it next.
- The declared lever (`kit.lever`) now draws a three-card flash at the muzzle, a tracer from the muzzle empty to the
  first wall or body on the look ray, dust and a sand burst on terrain, and a camera kick per shot. A body hit waits for
  the server: a hit with damage makes sparks (or flesh on a headshot); a hit for nothing (an armoured plate) makes
  armour sparks and an "ARMOUR" float, so a shot into a plate reads differently from a miss and from a wound.
- The reload is a real hand: the gun rolls onto its left side across the body so the loading gate faces the eye, and the
  shard's `handRight` node goes to the pouch, brings a visible round to the gate and thumbs it in, once per round, in
  step with `RangedAction.Cycle`'s round events. The lever throws and the hammer falls and re-cocks from the GLB's own
  `lever` and `hammer` nodes. A GLB without those nodes keeps the old tip.
- `Combat` exposes `bodyOnRay` (the nearest row or source-cell body along a ray) and `combatFloat` for that.

The guns themselves are shard content (shard-brasscap `tools/rifle.ts`: three modelled guns with hands).
