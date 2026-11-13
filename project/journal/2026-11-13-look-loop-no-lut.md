# The look loop drops ΔE00 and the learned LUT (opus-lookaudit)

Jake, 2026-11-13 ~18:55 Cancún: "All the LUT fucking around sure
feels like a waste of time to me" (meta J337).

- Removed `scripts/look-loop/palette-delta.py`, `fit-lut.py` and
  `regions/` (five region files), and the CIEDE2000 and frame-glob
  Python tests that only covered them. `targets.py`, `views.mjs`,
  `cameras.mjs` and their tests stay.
- `docs/look-loop.md` loses steps 5 and 6 (ΔE00, the LUT fit); a new
  step 5 says colour comes from light, sky, fog and materials.
- The skill copy is repo-kit `796f9b6`'s bytes.
- Kept: the LUT runtime (`world/lut.ts`, `render/lut.ts`, `Grade.ts`)
  and `look.grade.lut`. Driftwood, Sky Reach, Nine Dragon and the
  Template (Mossgate, until meta TEMPLATES-CLEANROOM M2) ship LUTs.
