# SS13: every player's own flag feats

- In a room only the lead got Pine's flag feats (`pine.feat.secrets` and the rest): the native quest's one
  `AchievementCounterBook` synced `host.flags`. Each other seat now gets its own book over its own `QuestBook`
  flags, counted in the quest step and filed as `<player>:<entity>` so `ledgerFilings` pays that player.
- Saved as a `feats:<step>` book part on every book, the lead's too: without the lead's, a doc saved from a
  second seat threw in `QuestBook.restore` when that player later took the lead seat (claude -p review MUST).
- Surprise: the islet secret was a world flag (the canoe's arrival set `host.flags`), so a lead's paddle
  counted for everyone. The arrival now lands in the rider's book and is claimed.
- Test: `test/net-pine-secret-feat.test.ts`, red first on the second player.
