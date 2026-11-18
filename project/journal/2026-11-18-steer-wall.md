# A land-sail climbs no wall (SHARD-SOURCE SS-GP5c)

- On staging v0.1.45 a land-sail driven into a Mirror Salt race cube (2.5 m) ended on its top. Its ground probe
  starts 2 m above it, inside the cube, so a solid ray hit at its start and stood it at 2 m; the next probe, from 4 m,
  found the top. In a sim the sail drove over the cube and dropped off the far side.
- `steerGround` (shared, server and rider's page): a floor more than `STEER_STEP` (0.5 m) above the vehicle is not
  its ground, and a rise past a step just past its bow (`steerReach`, off its hull) is a wall that zeroes its speed.
  It still turns, so a rider can steer away. `test/steer-wall.test.ts` drives it at a 2.5 m block and a 0.3 m step.
