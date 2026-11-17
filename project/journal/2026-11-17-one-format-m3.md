# ONE-FORMAT M3: the phone (opus-of-m3)

- CC53: `scripts/creature-bench.mjs` + `scripts/creature-bench/` draw 30 of Pine's
  phone deer (`deer-hind.phone.rigged.glb`, 3k tris, 20 bones, one material) on the
  iPhone 17 Pro viewport at the phone pixel ratio, 4x CPU, rAF-capped. Skinned rigs:
  27-31 draws, render CPU p95 1.4-1.9 ms, GPU ~0.3 ms (M5 Max) at 20/60/120 m. The
  cost is the draws (~35-50 us each at 4x, over the 30 us phone rule), not the pose.
