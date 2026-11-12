# SS13b: every player's own kill feats

- In a room only the lead got Pine's kill feats (`pine.feat.deer5` and the rest, and the thrall event): the death rows fed
  the native quest's one counter, so every death in the room paid the lead and a second player never earned one.
- The page's one player counts every death. A room's kill now counts for the player who landed it (`landedBy` on the
  killing blow's `req`), on that seat's SS13 counter, filed as `<player>:<entity>` and saved in its `feats:` book part.
  A death no player dealt (a fall, a trap) counts for the lead, as alone.
- `host.damage` is not read: the killing blow names its player. Aside: the damage book keys a body by its combat actor id
  (`creature:0`), not its entity id, so `host.damage.dealt(entity.id, ...)` reads 0.
- Test: `test/net-pine-kill-feat.test.ts`, red first on the second player.
