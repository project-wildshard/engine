# Others see a player swing and jump (REMOTE-PLAYERS RP6)

- The player row for others carried position, facing, board, swim, hp and held only; swing, tap or heavy and
  airborne went to the owner alone, so RP7 (attacks) and RP9 (jumps) had nothing to animate from.
- Wire pinned at shardfile `203e4fa`: `swing` (55, u8 count, wraps), `heavy` (56), `air` (57), send `others`.
  Additive under WIRE-STABILITY 5.5; rows read by the sender's table, so old and new peers skip or default.
- Every swing or shot start now calls `PlayerSim.swung(seq, heavy)`: swept, held arsenal, ranged shots, native
  melee, and (from the review) kit items, the kit lever and `startStrike`; the last three pass seq 0 so the
  owner's confirming seq is unchanged. The count is never saved: a restore starts it again, so RP7 takes the
  first value it sees as a baseline and animates on any change. The spear still counts a refused press.
- `air` is off the ground under its own motion: `!grounded`, not swimming, not carried, not stunned
  (`moveLocked`), and some vertical speed (a boat deck sets `grounded` false with none). A hover jump counts.
- `maxHp` stays owner-only: no row draws a bar over another player, and a released id keeps its `send`.
- `test/net-remote-actions.test.ts`: two seats in a Driftwood dedicated room; B taps, holds a heavy, jumps;
  A reads the count, heavy and air. Red before the pin, green after. The schema hash pin and the
  room-frame-bytes digests are re-taken for the wider row.
