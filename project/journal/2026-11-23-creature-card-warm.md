# Creature cards warm on every card tier (QA 2026-11-22 row 8, opus-qa1)

- Sky Reach's Chromium phone walk drew one 67 to 133 ms frame every run. A headless trace and a program
  census in the net-lag proof put it in `GetProgramiv` under `AnimalHerdView.lodViews`: the storm roc came
  within the phone's 300 m card range 10 s into the walk, so its card shot (a fresh plain material) and the
  card's ShaderMaterial linked in that frame.
- DF8 already warmed both under the loader (kept shot material, one parked card) but only under phone Low's
  program fold. `warmCreatureCards()` now turns it on for every tier whose cards draw. Local proof: before,
  4 of 4 runs linked 2 programs at z -46.5; after, 3 of 3 linked none in play, B1 max 33.5 ms.
