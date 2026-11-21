# Program fold (DF8, mini-df8b)

- `debug.programFold` (off): variants that draw the same pixels share one program. Every lit material had two, one
  with the cell's PMREM and one without (the road, where a grid page has no environment); with the slot a scene with no
  environment draws and compiles with an all-zero cube-UV atlas of the page's latest cube height
  (`render/programFold.ts`). Same-frame A/B on desktop WebKit as the iPhone 13, nine views: max difference 1.2e-7 in
  linear float, none over 1e-3.
- With it: a batch with no copy left to draw is refused before its program lookup (`drawGuards.ts`), a kit batch's
  members are not warmed for programs they never draw, a prop merge's member warms its merged mesh's program, a
  re-entered cell's static merges join before its warm-up, the far ring warms each batch's program before the batch
  replaces its proxies, and a creature card shot keeps one material.
- Driftwood route end: 229 programs with no slots -> 114 with programReuse+programFold (-50%); farBatch+kitBatch+
  programReuse 190 -> 130 to 133 (257 with no slots, -48%); links in
  play 58 -> 17 to 20, draw-time 11 -> 1 to 3 (no slots: 109 in play, 11 at draw; reuse+fold: 11 and 2).
- Left: the first creature card shot and its card material (~36 s), and one kit-rock batch variant without the region
  look as the player leaves the cell (~183 s).

## The last two draw-time links (mini-df8c)

- The card programs link under the loader: the warm rigs' stage shoots each model once (one 4 px view, the real shot
  path) and parks one card in the hidden warm group, which the first frame's parked draws draw. The shot scene is exempt
  from the environment fold (`FOLD_EXEMPT`): folded, its key depended on whether the page had a cube height yet, so the
  boot warm and the first shot in play were two programs.
- A kit batch whose material lost the cell's `region.look` patch it was built with draws nothing again: as Driftwood
  left, its members showed for one frame mid-teardown and the batch (no cell guard refuses it) linked a no-look program.
