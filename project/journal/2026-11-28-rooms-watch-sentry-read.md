# 2026-11-28: rooms-watch's Sentry half reads, and says when it can't

- Meta QA 11-25 row 32. rooms-watch's Sentry half (open outage-category issues, which would have caught
  WILDSHARD-GAME-86 two minutes in) was off for want of a token; Jake saved a read-only one at
  `~/.config/wildshard/sentry-auth-token` on 11-26. The poller already read that file, but any failed read (no token,
  HTTP 401, a bad answer) returned nothing and the half went quietly off again with no line anywhere.
- Fix: `readOutages` returns the issues and a read status (`ok`, or why: never the token). `step` keeps the last status
  and writes `NOTE RED builder: rooms-watch cannot read Sentry outage issues: <why>` once when reads start failing and
  `rooms-watch reads Sentry outage issues again` once when they recover.
- `--check` prints one read and writes nothing: both rooms hosts, the Sentry read, the open outage issues and the last
  14 days' outage issues of any status. Live on the MacBook: both hosts 200, Sentry read ok, 0 open, WILDSHARD-GAME-86
  resolved; with a bad token, `Sentry read: HTTP 401`.
- Tests: `test/rooms-watch.test.ts` (red once and back once; the token goes only in the header; each failure named).
