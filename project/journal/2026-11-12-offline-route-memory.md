# 2026-11-12: a slow link keeps the device's route

- QA-FEEDBACK 2026-11-12 row 36 (meta): Jake on bad LTE, prod v0.1.13,
  Driftwood cached, sat 34 s on LOAD step 7 / 31 "Read audio 7 / 91".
  The offline audits (`~/.cache/wildshard/plan-artifacts/offline/`) found
  the cause: the world check (3 s) missed its deadline, so the page took
  the one-shard route, whose 91 per-file audio reads online play never
  fetched.
- `oneWayIn.ts` now keeps the last world answer per device and release
  (`device/gridRoute`) and uses it when the check has no answer in time.
  The read runs on for 10 s so a link that always answers late still
  fills it for the next launch.
- `sw.js` serves `/programs/` and `/shardfiles/` network first into the
  build's shell cache, answering from it offline.
- Boot audio reads go through `readContent`: retry once, then RETRY naming
  the file; `missingThrows` keeps a 404's synth fallback. `retried` fails
  at once offline, and the chunk check's `/version.json` read gets 5 s.
- At START the card is still the boot shell and nothing painted a wait's
  RETRY (the Open Plots audit: START sat on 30 / 31 for good); the
  shell's own button now shows, with the failed file on its foot line.
- Left for PAGE-SIZE: per-file audio, server packs and horizon strips in
  the precache, and a shell cache that survives a build change.
