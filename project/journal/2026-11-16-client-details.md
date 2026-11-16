# A shard's detail layers on the page (SHARD-SOURCE AP32d1)

> Written by: Claude (opus-ss16i)
> State: built on `plan/ss16i`, 2026-11-16; lands with the plan.

- `game/shardfile/clientDetails.ts` turns each `look.details` row (format v0.7.0) into one `DetailLayer` under the shard's
  root, right after the shard's water: its card, mask and heights come from the charged library (`assets.retained`), its
  material from the compiled look catalogue, and a `late` system moves its ring with the viewer each frame.
- The format's tint is two sRGB multipliers; `instanceColor` is linear, so the page converts it (`linearTint`).
- A row whose files do not match its counts (`detailFileFaults`), whose file is not in the library, or whose material did
  not compile is refused with the layer's id: a meadow is never silently missing.
- `package.json` exports `world/detailLayer` and `world/detailRing` for the game layer (public index).
