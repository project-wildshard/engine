# Others' hits and hurts (REMOTE-PLAYERS RP10)

- Jake, 2026-11-12 17:43: "see the health bar going down as Jimmy is smacking it ... it's an MMO". Another player's blow on a
  creature drew no number on anyone else's page, and a `hit` whose target was another player's handle was dropped.
- Others' blows on a creature: `RowBodies.presentHit(own=false)` now calls `onOthersHit`, and `Combat.ts` draws its number
  in `.ws-combat-float.other`: 18 px (16 on a phone) against 26 (22), pale grey at 0.7 alpha, no glow, no HEADSHOT or KILL
  label, no MISS bookkeeping (`floatLook`).
- A hit on another player: `clientWorker.ts` routes it by target handle through `net/hurtOther.ts` to
  `OtherPlayers.hurt`; `net/remoteHurt.ts` flashes the body red (its own copy of the castaway material from its first hit,
  emissive, 0.3 s) and pops a red number beside its shoulder that rises 0.55 m and fades over 0.9 s, 22 px on screen at any
  distance. `__onlinePlayers()` reports `hurt: { hits, last, flash, numbers }`; `Symbol.for('wildshard.remoteHurt.pace')`
  = 0 holds flashes and numbers for a shot.
- Lives beside RP11's fade (`remoteDeath.ts`): no copy is taken while the fade wears its clone; a fade-in clone flashes too;
  `undress()` frees the copy even when the fade holds it off the mesh.
- Test `net/remote-hurt.test.ts` (red first). Proof `scripts/remote-hurt-proof.mjs` (`WS_RIG_PORTS=18870`): Jimmy runs to a
  bear and lands a 10; Jake, behind him, sees a pale 16 px "10"; the bear hits Jimmy for 20, and Jake's page reports the
  flash and "20" held, gone after release. Captures `~/.cache/wildshard/plan-artifacts/remote-players/rp10-*.png`.
