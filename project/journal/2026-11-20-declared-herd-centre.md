# Declared herds get their centre (opus-pine8, 2026-11-20)

- Pine's OF23c warden journey died at the den: the declared black bears wandered 30 m out onto
  the trail and charged the walker, where r8's roster bears stay within 10 m of home.
- Cause: a declared body keeps AnimalSim's `herd = 0`, and a layer hunt rolls no herds, so
  `HuntBrain.herdFor` read `herds[0]`, got nothing and never asked the `herdOf` port. Declared
  herds had no straggler pull, no herd alert and no centre easing.
- Fix: `herdFor` falls back to the port when the roster has no such herd.
  `test/hunt-declared-herd.test.ts` fails before it.
- Same lane: `test/ci/native-loadout.proof.mjs` (Pine r8 main red) aimed the King's head from a
  fixed post; it now stands before his chest and aims the chest lock point (`40655ea23`).
