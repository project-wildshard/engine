# OF38d4a: Nalati's arsenal stands from its files

> Written by: Claude (opus-nalati3)

Nalati's plan was the last to name `held.arms`: a step, `held/slots.json`, the sprint speed, the storm's wind rows and four
script inputs. Each is already in the product or the engine. `held/slots.json` declares the blade with its passes, the bow and
the polearm, and names the arsenal (`nalati.arsenal`); the engine owns the sprint speed (7.2, the number Nalati wrote); the
weather owner the cooked files stand (`weather.native`) reads the same storm rows.

- `withSectionArms` stands the `held.arms` row where a plan names no held host and the slots declare that arsenal, at the held
  hosts' place (before the patrol and the open arena). Its names come from the slots id's namespace: the step and save owner
  `nalati.weapons`, the inputs `nalati.weapon.attack` and so on, exactly what r6 wrote, so an r6 save restores into r7 and
  the headless proofs keep their inputs. (The first cut used the slots id itself; the follow-up keeps r6's names.)
- `prepareSectionMelee` and `prepareSectionRanged` now see the stood host, so a cut Nalati plan never doubles its kit.
- r6 still names the host and runs as before. `test/native-held-arms-section.test.ts`: the cut plan runs tick for tick with
  the r6 plan as shipped, in a room: the bow draws and looses, the sabre swings, the spear thrusts, and either
  world's save restores into the cut world.

The runtime stays one arsenal (one seat, one save, one equip order): the bow and melee halves share the swap order, the
mounted state and the stealth hook, so splitting `nativeHeld.ts` would change the save for no player-visible gain. The plan
row is what ONE-FORMAT retires; Nalati r7 drops it (OF38d4b).
