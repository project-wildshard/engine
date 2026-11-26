# CHUNK-PARAM, opus-chunk3: Explore's zone link, and the tests that dialled ?chunk=

> Written by: Claude (opus-chunk3), 2026-11-25 evening Cancún.

- CP6's code was already on main (bfd256937); what was owed was proof that Explore's `/pine-hollow` opens its hub
  without the address ever naming the zone. The Explore spec now has that test. Ring 1 pins only Brasscap Mesa and
  Sunscar Dunes, so the hosted run opens `/brasscap-mesa`; `WS_T1_EXPLORE_ZONE=pine-hollow` against a full-pins Explore
  build opened Pine's hub in 41 s, with no `chunk=` in any navigation.
- Gotcha: `t1-e2e.mjs` installs ring-1 pins into the worktree's `out/`, which strips every other zone. The dedicated
  tests then fail with "No shard source and no pinned product". `node scripts/pins.ts install` puts them back.
- CP14: the bots now ask for their cell with RoomBot's goto word (CP5) instead of a socket address.
- CP15: three edits had to go back. `leave-saved-paths`, `inline-save-epoch` and the `/slug/...?sw=0` worker case all
  depend on the param (or on `sw=0` switching the worker off), so they move with CP22, when the code stops reading it.
