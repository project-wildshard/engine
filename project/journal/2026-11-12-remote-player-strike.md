# Another player's attacks (REMOTE-PLAYERS RP7)

- Jake, 2026-11-12: "I need to see attack animation". Another player's swing showed nothing on anyone else's screen.
- `net/remoteStrike.ts` layers over the gait and air poses: a change of the row's `swing` count (RP6) plays a strike on the
  right arm and spine, on the first-person sword's clock (`STARTER_MELEE_PROFILE`): a tap slashes across (windup 0.07 s,
  slash to 0.235 s), a heavy chops from over the head (0.06 s, to 0.30 s); a bow in the left hand's mount draws and looses.
  The first count seen is a baseline, the count wraps at 255, a missing one is no data. It blends in from where the arms
  were (a combo swing winds up from the last swing's pose, not from rest) and back to the gait. Legs stay the gait's.
- `__onlinePlayers()` reports `attack`: `tap`, `heavy`, `draw` or ''.
- Found on the way: SweptMelee's heavy release press carried no heavy flag, so online the server swung a light at every
  heavy (`7763e1c2`).
- Test `net/remote-strike.test.ts` (red first). Proof `scripts/remote-strike-proof.mjs` (`WS_RIG_PORTS` lets it run beside
  another rig): Jimmy taps, then holds a heavy on the ATTACK disc; Jake's page reads each, holds the strike at 150 ms for
  the shot (remoteStrike's page `pace`), sword mid-arc in both, heavy arc 4.3 rad to the tap's 1.9; captures `rp7-*.png`.
