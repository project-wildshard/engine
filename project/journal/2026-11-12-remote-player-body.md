# The remote player's body (REMOTE-PLAYERS RP2)

- Jake, 17:43: "Jimmy doesn't have a character model". Other players were the practice dummy scaled to 1.8 m. They are now
  the castaway (`models/castawayBody.ts`), coloured from the fp arms' own vertex colours (`fp-arms.glb`: skin #b47149, linen
  #e9dfc9), a step brighter for the lit world: hair, stubble, linen shirt with rolled sleeves, rope belt, canvas trousers
  rolled at the shin, bare feet. Built in code, no new asset: no rigged humanoid GLB exists (Pine Hollow's NPCs have no skin).
- One skinned mesh, every part bound whole to one bone, the bones on the practice rig's contract and axes (each bone's +y to
  its child, +z kept forward), so `pose()` drives it unchanged. Note for RP4: under those axes `pose()`'s walk bends the
  knees forward (a shin's +angle swings its foot forward); the saddle's `-SEAT` shin is the right sign.
- Shared: every body is a SkeletonUtils clone of one template. `drop()` skips `userData.shared` geometry and materials and
  now frees each body's own skeleton bone texture, blade and board geometry (it leaked them with the dummy too).
- Rig slots for later rows: `CASTAWAY_RIG` (engine/anim) with `idle` (a real clip: breath and a slow look), `walk`, `run`,
  `attack` and `fly.jump` (ClipName has no `jump`) declared procedural, sockets `hand.R` / `hand.L`.
- Proof `scripts/remote-body-proof.mjs`: three pages, Jimmy 4 m from Jake on the pier, 1.80 m, soles at the row, contact disc,
  front, side and back captures, Ana in view too; the two bodies cost 0.08 ms a frame (render + finish, shown vs hidden).
