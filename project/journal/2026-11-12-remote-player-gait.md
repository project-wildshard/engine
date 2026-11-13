# The remote player's walk and run (REMOTE-PLAYERS RP4)

- Jake, 17:43: "I need to see them walking, and I need walking animation". The castaway body (RP2) swung each thigh on a sine
  and bent the shin by a positive angle, which on the practice rig's axes threw the foot forward of the knee; a stance foot
  slid at almost the body's own speed, and the stride snapped at 5 m/s.
- `net/remoteGait.ts` is the rig's procedural `walk` and `run`: each foot is down for `stance` of a stride and goes back under
  the hip at exactly the body's speed, then swings forward on an arc; a two-bone solve puts each ankle there with the knee
  ahead of the hip-to-ankle line, so a knee only ever folds backwards. The hips ride as high as every planted foot reaches
  (the bob), a run's rise a little in the air; arms swing against the legs, elbows bend and the spine leans with speed.
- Cadence is matched to speed (the phase advances by distance over stride length). Standing to striding blends over 0.1 to
  0.7 m/s, walk to run over 4 to 6 m/s; the `gait` label still changes at 0.4 and 5. A rider's legs stand still.
- Test `net/remote-gait.test.ts` (red on the old pose: knees forward, foot slide, the snap). Proof `scripts/remote-gait-proof.mjs`:
  two pages, Jimmy walks then sprints across Jake's view on the beach, side-on, then stops; Jake reads idle, walk, run, idle,
  legs alternate, knees fold backwards; captures `rp4-*.png`.
