# Staging proofs over rooms, and the lead seat's voice

> Written by: Claude (opus-proofs), 2026-11-11

opus-ship19 passed v0.1.9 only with hand-made copies of the staging proofs. Three things broke engine's own scripts:

- **D7 health lines.** On rooms-staging the page's own fetch of `/health` is a 404 with no CORS header, so Chromium and
  WebKit log it. `scripts/staging-proof-lines.mjs` now lists exactly those lines and fails on everything else. A line
  matches by address: the URL it names, or the URL the browser attributes it to. WebKit splits one refusal into two lines,
  and the first names no URL, so that one is excused only when the next line from the same page is its partner about the
  rooms health. ship19's copies excused any bare `net::ERR_FAILED` or 404 line, which was too broad.
- **Tagged Names (MP2.4).** Live play waited for `Name` and got `Name#1234`.
- **Voice both ways.** ship19 put the failure down to a distance-fade spawn gap. The new `e7-voice-staging-proof.mjs`
  measured the two bodies 1.0 m apart, and B still showed A as too far. The real cause is the room's first seat. It stands
  in the lead body (`actor.player`), but the door named that player's voice seat by the device body id. No page draws
  that id, so `voiceNear` found no body and silenced them. This bug is live in v0.1.9. Whoever joins an empty cell first
  can't be heard by anyone. The world now renames the voice seat when its cell posts `seated`. The voice proof stays
  strict and passes only once a staging server carries this fix.

The proofs commit adds `test/staging-proof-lines.test.ts` for the line and Name rules. Phone contexts in the voice proof
seed `firstPlayDone` (MG5), so a phone plays as a returning player.
