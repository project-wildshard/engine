# ONE-FORMAT M3 and M4 (opus-of-m345)

- CC17b: `ActorMoveRunner` runs `leap`. The first step fixes the start and the landing (the target where it stood at
  take-off, or the world spot); each step places the body on the ballistic arc (lift `sqrt(2gh)`), the last lands
  exactly on the landing and fires move-done. A landing above the peak fails the move with no motion. The saved
  continuation keeps both ends, so a resumed leap never re-aims. `actor-leap.test.ts`: a 9 m leap peaks at 9 m.
- CC51b engine half: format 0.38.0's optional `phone` skin on a skin look is backported onto the 0.37.1 pin (the
  engine patch, beside the GPU caps backport; drop it when the pin moves past 0.38 with QA29). `loadClientSkins`
  takes the tier: the phone tier loads only the look's phone skin, same rig and clips; desktop keeps the full skin.
