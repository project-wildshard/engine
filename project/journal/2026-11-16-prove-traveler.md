# Author proof: the baseline takes the traveler (opus-ss16q, 2026-11-16)

- sharddev's Template failed every stand-still tape with `restored regional suffix diverged in entities.4.1.motion.yaw`
  (a few ulps). Its player is still falling from the spawn for the first ~60 ticks; the highway's five ticks while the
  region is out move it on (MU6), so the restored run's player was five ticks further down than the never-saved
  baseline's, and a creature that reads the player's pose turned differently.
- `proveAuthoredGrid` now plays the baseline to the checkpoint, gives its player the traveler's pose, motor and motion
  as the restore brought it back (`carryMotion`, the frame transfer's `syncTransfer`), then plays both suffixes.
  `test/author-proof-traveler.test.ts`: a hop just before the save and a watcher that reads the player's height (red
  before, `entities.0.1.motion.yaw`).
