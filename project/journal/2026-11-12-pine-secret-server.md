# 2026-11-12 Pine's hollow-log secret runs on the server (SS5, opus-ss5)

- Why: the page asked `pine.life` for the `secret` signal every half second and its
  `accept` raised `secret:log` in the page's flags only. In a room nothing set it, so
  "Find the 3 secrets" never finished (meta SERVER-PARITY row SS5, inventory row 3).
- Change: `nativeSecret.ts` reads the page's own rows (client plan `quest.views` ->
  `secret`, its `quest.composition` chapter program, `quests/story.json` decision) and
  the native quest composition asks the same program on the same beat for every seat.
  The observed flag is claimed, so each player's find is their own. Toasts stay the
  page's. No shard bytes change: no re-upload.
- Red first: `test/net-pine-secrets.test.ts` failed on main, passes now.
- Left: a non-lead's flag feats (`pine.feat.secrets` and the others) still count only the
  world's flags, for every secret, not just this one. shardfile `87b0ee1` still refuses
  Pine's `page.life` binding of a `sim` row; that needs Pine's `page.life` on a `view` row
  (a re-upload) or the refusal relaxed for a server-hosted row.
