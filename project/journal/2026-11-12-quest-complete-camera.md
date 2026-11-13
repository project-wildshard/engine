# 2026-11-12: Quest complete keeps the camera

- Jake, Template on preview (build 243820b7, ~23:28 Cancún): "Whatever quest
  complete behavior is in template is freezing the camera / lagging the game
  a bunch". Lane opus-questfreeze.
- Cause: every declared quest (shardfile `quests.json`) gets
  `installQuestPresentation`'s default "Quest complete" beat, which names no
  pose. `QuestRewardController` still set `player.carried` and rewrote yaw,
  pitch and velocity from the start pose every frame for the 7 s hold, so the
  camera and walk ignored input for 420 frames, on every shard.
- Fix: only a posed beat (`at`, `yaw`, `pitch` or `phase`) takes the player.
  A pose-less beat shows its caption and sting and never touches carry.
  Driftwood's chapter reward and the cable reward are posed: unchanged.
- Not the cause: lighting a brazier / an objective step. Headless metal
  traces of braziers A, B and C: max frame 17 ms, no long task, no new shader
  program. The long frames an early probe saw were the CDP profiler starting
  and the first key's AudioContext (145 ms, the first gesture, not a quest).
- Proof: `scripts/quest-complete-proof.mjs` (desktop and 402x874): red on
  d6f24d8a (420 frozen frames), green with the fix.
