# 2026-11-16: Declared brains publish their mode (TC-NE24c)

> Written by: Claude (opus-brassgun14)

Meta TEMPLATE-E2E TC-NE24c, option (a) of buddy-engine's TC-NE24b diagnosis.
The platform `pursue` brain kept `pursue`/`attack`/`return` in its own
`mode`, and the `wander-ram` and `circle-challenge` grazer patterns kept
`threat`/`ram`/`notice`/`fight` in `phase`. Nothing wrote the body's
`state`, so the wire and the page read `idle` for a wyrmling ramming the
player: no chase count for the music, no lock-on tie-break. (The minimap's
hot dot and the page's fighting check also need the species' `aggressive`,
which Brasscap's wyrmling and brawler do not set: that is shard data.)

- `PlatformBrain.step` writes the body's state after each step: `pursue` is
  `stalk`, `attack` is `attack`, `wander` and `return` are `wander`, else
  `idle`.
- `GrazerBrain.act` does the same for the two declared patterns: `ram`, and
  `fight` while a strike winds up or lands, are `attack`; `threat`, `notice`
  and `fight` are `stalk`; else `idle`.
- Neither ever writes `charge`: the hunt's charge contact (`homeKeeper`,
  `roster`, `RowBodies`) reads it. `stalk` drives the hunt rosters' sight
  interrupts only for bodies those rosters own; declared-brain bodies are
  not in them, and 29 brain, replay, restore and determinism test files
  pass unchanged.
- `test/grazer-frame-input.test.ts` compared the body against the original
  grazer fixture field for field; it now compares every field but `state`
  and checks the state is the one the original brain's phase and strike
  name.
- Mossgate's ring digest (`test/pins/ring-digests.json`, darwin-arm64)
  moves: the grey blob now reads `wander` while it wanders. Re-recorded
  with `scripts/ring-step.ts --only template --update`; blender-template's
  stays the same.
- `test/brain-state-published.test.ts`: Mossgate's grey blob, Brasscap's
  wyrmling and its brawler each read `stalk` or `attack` with the player
  6 m off, and never `charge`. Without this change all three read `idle`.
