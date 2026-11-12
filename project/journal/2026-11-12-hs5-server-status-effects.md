# HS5: status effects on the room server

- After the flip the page's EffectService was the only status owner, so a room landed the template whip's heavy (30) and
  dropped its poison. `EffectService.ts` and `types.ts` move from `src/client/engine/combat/effects/` to
  `src/shared/engine/combat/effects/` (the `@wildshard/engine/combat/effects/*` export keys stay); the starter rows parse
  moves to `src/shared/game/systems/effects/starterEffects.ts`. The `effect.applied`/`effect.removed` event entries now sit
  in `client/engine/events/maps.ts` itself instead of a module augmentation.
- `src/server/game/shardfile/statusEffects.ts`: one service per host, installed by `declaredKitItems` before its own step,
  so poison ticks 3 at 1 s, 2 s, ... 6 s after the blow and expires on the sixth. Damage goes through `host.combat.hit`
  with the page player binding's tags. A player's statuses go out as `status.<name>` owned lines (tenths of a second left).
- Surprise: the page never damaged a poisoned creature (only `bindPlayerEffects` ticked damage, for its own player). HS5's
  done-when asks for the row's damage on the target, so the server ticks it for creatures too.
- Left: no page reads `status.*` lines yet; stun/slow modifiers land on the actor but no server motor reads them; a save
  holds no running status.
- Test: `test/net-status-effects.test.ts`, red first at "its poison takes".
