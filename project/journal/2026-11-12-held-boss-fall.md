# Held boss fall (SERVER-PARITY HS3)

- The Storm Roc is a held boss, so it is one of the keeper's homes, and
  Far Reach's home kill plane (killY 6) killed it when it fell off the
  crown. Its fight then paid the victory, the Ledger fact and 25 coins
  for a death no player dealt (shard-sky-reach 636d12e, SKY-2).
- The keeper takes a `held` id list: the plane never kills one; one
  under it goes back to its home's anchor, alive, and the fight goes on.
- The held boss row pays only for a blow, never a fall. It wraps the
  body's combat actor `applyDamage` (sync, after every rule) to see
  whether the killing request carried `env.fall`. `actor.died` is
  queued, so it can land after the brain's victory: the first try with
  it paid anyway. The review caught a worse first guess: `source ===
  'env'` would have refused player melee too (Melee.contact sends `env`
  tagged `actor.player`). A claim row's reward is gated the same way.
- `test/net-held-boss-fall.test.ts`: red on 128511a2 (the plane killed it,
  fact + 25 coins), green after.
