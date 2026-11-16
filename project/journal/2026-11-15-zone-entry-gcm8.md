# Zone entry, plan/gcm8 (opus-gcm12)

ZE7, the grey stand-ins seen from the turn-ins:

- Nine Dragon's "grey fog towers" were its haze band, not its placeholder: the band stands 18 m out in the strip, 13 m
  from a traveller at a turn-in, and the old 2 to 12 m camera fade left it whole across the entryway. The live cell
  read the same from the road. The band now clears within 16 m and is whole from 70 m (`hazeBand.ts`).
- Pastel Plain's near.glb carried `_template`'s colours (grey-green ground, 0.246 grey props) while its far proxy is
  lilac. Recoloured in place from its farLook and its rock graph's pink-to-peach height gradient; geometry untouched.
- `turn-in-shots.mjs --card --self` shoots any home's own turn-ins: the live target a placeholder is held to.
- ZE12's review note (GC13's loading limit has no caller): J352 builds one world at a time, so no world is ever prepared
  beside a kept one. `canPrepareAlongside`, `loadingEnvelope` and `pageLoadingBytes` are deleted with their tests.
- ZE10b: the gate's 0 hands `enterZone` an arrival pose (`arrivalPose`: the entryway's centre line, 14 m in, past the
  gate, facing the centre) and the reload form carries it in the travel handoff's `arrive`, which the target's spawn reads.
