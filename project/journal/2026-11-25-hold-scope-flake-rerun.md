# A HOLD binds only the red's files; a suspect-less flake reruns once (opus-velocity, meta QA 11-25 row 67)

- 11-25's engine HOLDs (17:29 to 17:52 and 18:57 to 19:58 UTC) stopped every lane, though most lands touched nothing near
  the red. `land-hold.mjs` now reads the red's files from the HOLD line and the span's `MAIN RED` / `NOTE RED` lines; a
  push disjoint from them lands with `HOLD open but this push is disjoint from <paths>; landing (J505)`. A HOLD naming no
  path, or `HOLD all lanes`, binds as before.
- Row 57's cook-worker-limits flake opened a HOLD each time until a lane reran it by hand. `main-watch.mjs` now reruns a
  first-attempt red with no suspect in its range once (`main flake rerun ...`), prompts nobody, and judges attempt 2.
