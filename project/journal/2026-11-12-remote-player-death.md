# Others see a player die and return (REMOTE-PLAYERS RP11)

- Jake, 2026-11-12 17:43: "it's an MMO ... everything, right?". The server respawns a fallen player in the tick he dies
  (`health.ts` `update`, then `roomRespawn.ts` `resetPose`): his row's hp comes back up and his row jumps to his checkpoint
  together, so others saw his body slide across the map in two interpolated frames and never fall. A row at hp 0 is rare.
- `net/remoteDeath.ts`, layered last over the pose: on a death the body holds where it fell, falls on its back (0.6 s), lies
  2 s with its Name at 0.4 opacity, fades out (0.6 s, on per-body clones of the shared castaway and contact materials, freed
  once whole), is gone, then snaps to its row and fades in (0.5 s). `__onlinePlayers()` reports `death`: `fall`, `lie`,
  `fade`, `gone`, `rise` or `''`.
- A death is the killing `hit`'s `killed` bit (RP10's `hurtOther` now passes it to `OtherPlayers.hurt`), else a row at hp 0
  after an alive one, else a jump across the ground (over 40 m/s, horizontal only, so a long fall is no jump) that lands with
  10+ more hp. A jump with less is a teleport and only snaps. A death while rising is a death again. One `claude -p` review:
  its four MUSTs (one-hit death from full hp, false deaths after a stalled frame, fast falls, deaths during the rise) fixed.
- Test `net/remote-death.test.ts` (red first). Proof `scripts/remote-death-proof.mjs` (`WS_RIG_PORTS=18880`): a bear kills
  Jimmy; Jake's page reads fall, lie (about 2 s), fade, gone, rise, alive; no frame draws him between the two places and
  no speed passes 20 m/s. Captures `~/.cache/wildshard/plan-artifacts/remote-players/rp11-*.png`.
