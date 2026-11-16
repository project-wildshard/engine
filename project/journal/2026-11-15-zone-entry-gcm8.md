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
- ZE13: `grid-zone-tour.mjs` enters every cell by the gate facing the current home, one after another in one tab, and
  `grid-zone-report.mjs` writes the cells × measures page and exits 1 past `test/grid-zone-ratchet.json` (seeded loose:
  24 cells, 60 s count to control, 55 s loading, 1200 MB; tighten from the first preview tour).
- ZE10b in-page: the first `--fire` run arrived at Nalati's save (0, 232), not its west entryway: the in-page server opens the
  chosen cell where its save stood and the server wins over the page's handoff `arrive`. The grid intent now carries the arrival
  pose to `chosenArrival()`, `startStandalone` posts it as `enter`, and `gridServer.ts` seats the body there after `grid.enter`.
  The dedicated world's half is ZE9's `enter` control (Codex), not a URL param: a `?gate=` dial needs Jake's OK (no-url-switch).
- ZE3a: the drive's one real long frame at the step-out (67 to 83 ms, every run) was the page's first gesture building its
  AudioContext (`unlock.ts` `newContext`, G325/SF67: kept out of the boot on purpose): the harness pose skips every press a player
  makes before the road, so `KeyW` was the first. The proof now presses ScrollLock (no binding) first; a 1-segment run at load 25
  then has 0 frames over 50 ms, worst 16.8 ms. Everything from segment 37 on in the quiet-start drive had the page thread idle.
- Land review (claude -p, 2026-11-16): MUST, the grid intent's optional `arrive` changed a saved shape at version 1
  (`saves-lock.test.ts`): both keys are version 2 with a pass-through migrate. SHOULDs: the zone tour now waits for the count
  in the target's own buffer and awaits the navigation before polling; the gate proof's no-read residency is null, not 0.
