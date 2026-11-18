# ONE-FORMAT M3 and M4 (opus-of-m345)

- CC17b: `ActorMoveRunner` runs `leap`. The first step fixes the start and the landing (the target where it stood at
  take-off, or the world spot); each step places the body on the ballistic arc (lift `sqrt(2gh)`), the last lands
  exactly on the landing and fires move-done. A landing above the peak fails the move with no motion. The saved
  continuation keeps both ends, so a resumed leap never re-aims. `actor-leap.test.ts`: a 9 m leap peaks at 9 m.
- CC51b engine half: format 0.38.0's optional `phone` skin on a skin look is backported onto the 0.37.1 pin (the
  engine patch, beside the GPU caps backport; drop it when the pin moves past 0.38 with QA29). `loadClientSkins`
  takes the tier: the phone tier loads only the look's phone skin, same rig and clips; desktop keeps the full skin.
- CC23b: the serpent (format CC23a, backported onto the 0.37.1 pin) gets `TrailCreatureVolumes`: one volume a trail
  bone, laid along the path CC22's ring records on the 10 Hz sample ticks (a server `creatures.trails` step after the
  bodies, its rings saved state). A volume whose top is under the ground is `off` (new optional port on
  `CreatureVolumePose`): the server ray and closest skip it, the page's hitboxes disable it. A serpent is `motorless`:
  no walking capsule on either side and no ground follow, so moves own its height. Every reader of a body's skeleton
  now asks `bodyContract(body)` (a serpent's contract is built from its trail).
- CC17b follow-up: a leap on a real ground body was pulled 20% a tick toward the ground by the ground follow (peak
  about 7 m). `AnimalSim.airborne`, set by `ShardDecisions` while a leap flies, leaves its height to the move; the
  real-body test peaks at 9 m.
- CC23c: the serpent poser. `TrailCreatureVolumes.joint` lends the skin view every trail bone's local transform (the
  head against the view root, each bone against the one ahead, facing along the path), so a serpent skin draws on the
  same trail its volumes sit on (embedded hosts and neighbour cells read the bound pose). 20 serpents of 14 bones pose
  in 0.032 ms a frame (Node, loaded MacBook). A remote MMO page still needs its own ring fed from the wire's root.
