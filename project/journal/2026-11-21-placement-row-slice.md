# Placement rows share the loading slice

Nine's hosted nightly boot kept failing NB6: props sat ~1.2 s of a 1.5 s window
idle with no named wait, always in the last ~1.8 s of props. A local profile
with timer logging found it: every scene placement row ended with `buildYield`,
which on the loading screen is a `setTimeout(0)` turn. 310 of them in props, each
paying the 4 ms nested-timer clamp, 1.36 s of pure idle.

Rows now end through `placementRowCheckpoint`: the shared 50 ms construction
slice while loading, the original build turn in play and Node. Local Metal props
idle went from 1.01 s to 0.12 s and props from 2.34 s to 1.14 s.
