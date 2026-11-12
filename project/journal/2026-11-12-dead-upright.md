# 2026-11-12 A tossed corpse lands upright (TE-ENG11, opus-teeng11)

- Brasscap's beaten Dust Wyrm came to rest upside down (mesh rotation
  x pi). Not the GLB: the Wyrm's `die` clip only tips the joints a few
  tenths of a radian and sinks the body. The cause is the death's
  ragdoll. A custom rig with no upright capsule (`dims.capsuleAxis`
  unset: the Wyrm, Brasscap's tin bandits, Driftwood's crab) takes the
  `rigid` build, one box thrown and spun about (up x away) by the
  killing hit, and nothing turned it back: it rested on whichever face
  it hit. The throw is clamped to 2 to 2.5 m/s, so every kill sent it
  over onto its top.
- Driftwood: the crab had the same flip (the build was written for it,
  "the hit throws and flips it"); its dead clip curls the legs under a
  body on its base, so it now lands on its legs. The monkey, the sailor
  and the captain are `upright` (rotations locked): unchanged.
- Fix: an upright spring on the rigid build, a tilt torque turning the
  box's up axis onto the ground's normal, UP_KP x weight x reach per
  radian, damped at 0.9 of critical, a third while it still moves fast.
  Yaw stays free. General, no shard branch.
- Test: `src/client/engine/physics/ragdoll-upright.test.ts`, red before
  (up . Y = -1 for all three bodies), green after: 48 hits each (four
  damages, six directions, level and from above) rest at up . Y = 1,
  settled in 1.1 to 1.7 s.
- Codex review: one MUST, one SHOULD, fixed. MUST: the ground ray started
  at the feet, inside the floor once the box lay on its base, so it aimed
  at world up and a body on a 26° slope rocked to MAX_T; it now casts
  from above the feet (a 26° slope test, red before). SHOULD: an asleep
  or quiet box froze however it lay; now it freezes only within UP_REST
  (0.35 rad) of the ground's normal, MAX_T still the escape. Tests for a
  body dying on its head and two fixed steps per frame.
