# Fur strands and the strike overshoot (ONE-FORMAT OF3c2, OF11b)

- Pinned shard-format 0.43.0 (0.42.0 held only word retirements).
- OF11b: `dataCreaturePorts` keeps a strike row's `overshoot` in the strike's motion, so Dunes' strider charge on the
  data host equals the program's strike in every field the runner reads (`test/data-host-dunes-strikes.test.ts`, failing
  first on main).
- OF3c2: a toon or PBR surface's `strands` draws the factory's own fur canvases (`entities/furCanvases.ts`, moved out of
  `AnimalFactory` with its three-buffer debt) through `render/families/strands.ts`, once per distinct set. Toon takes the
  albedo and relief; PBR fills only the maps the surface leaves empty.
- `bytes.generated.ts` loses a Driftwood `lm-ao.phone` stamp for a file that was never committed (the last land's gen
  saw it untracked in the worktree).
