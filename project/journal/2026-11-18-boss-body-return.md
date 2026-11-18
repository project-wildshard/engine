# A respawned boss body is a fight again (meta STAGING-BUGBASH SB51)

- opus-sb50: on staging v0.1.44 Brasscap's Dust Wyrm stood again at hp 440 after a kill (its spawn row's `respawn: 300`,
  `dataRespawn.ts`) while its declared fight (`PhaseEncounter`, `ai/phases.ts`) stayed in `victory`, which refuses every hit
  and opens no gullet. Two clocks owned one boss: the body's row clock and SC5's empty-arena wait (`BossContenders`), which
  a newcomer standing in the arena reset every tick, and which `PhaseEncounter` never fed `world.slept`.
- Fix: the step a beaten fight's body stands again, the fight returns with it (`returnBeaten`, then `arm`), so a newcomer
  gets the intro and a fight it can win; `world.slept` now reaches its contenders as the other boss owners have it.
  Red first: `test/encounter-body-return.test.ts` (2).
