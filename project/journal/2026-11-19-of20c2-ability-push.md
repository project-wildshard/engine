# OF20c2: declared strikes apply an ability's impulse and aim (opus-of-close)

- Format 0.49.0 (OF20c1) gives a species ability row `effect: 'impulse'` (`strength` m/s along the strike's facing,
  `lift` m/s up) and `aimHeight`. `shardfile/abilityPush.ts` maps a row onto `StrikeSpec.impulse`/`aimHeight` for both
  declared paths (`decisions.ts` `abilityStrikes`, `brainRuntime.ts`).
- `SimHost` aims a strike at the target's feet plus `aimHeight` (start and every update) and, on a landed hit, throws a
  struck player with `addImpulse` along the runner's yaw, as the borrowed row's `strikeEffects` did through `shove`.
- Why: Sky Reach's Storm Roc moves onto the declared path (OF20c); its gale wall's 14 m/s shove with lift 2 and its
  stoop's 1.2 m chest aim were only on the borrowed host. Proof `test/creature-ability-push.test.ts`.
- OF27c: `test/skin-hull-parts.test.ts` loads sharddev's thrall build (hull plus `parts`, `parts.glow`) on the skin
  path: three groups, each part vertex rigid on one bone with its own colour. No engine change was needed.
