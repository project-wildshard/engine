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
- CP21: the trailer's lone-zone shot (`singleZone: true`) now boots a one-cell world through `enterZone({ alone: true })`.
  Nobody answered the NOTE, and the trailer lanes had nothing in flight, so it went in as described.
- CP18: the drain-inbox, look-loop and mockup-to-model skills, `docs/look-loop.md` and `docs/trailer.md` now describe
  entering a zone by its tap (`zone-entry.mjs --init` or `enterZone`), and `cameras.json` gets a `zone` field. The
  look-loop skill changed the same way in repo-kit, and engine's `AGENTS.md` has the one-line rule.
- CP17: every measuring tool now enters its zone with `alone: true`, and the tools that show the game enter by the tap
  with the zone's neighbours. The Inspector and Simulator scripts write the tap and drop the chunk from `location.href`.
  The look loop's `cameras.json` gets a `zone` field.
  Pine Hollow's ledger on the one-cell world reads 244 MB at control, against 224 MB with `?chunk=`: textures are
  9 MB higher and buffers 7 MB lower. Its peak is 312 MB against 343 MB. Both sit under the budget line.
  The census times out at control both before and after this change, so that is an older problem. The Simulator and
  iPhone paths are unproven, because no agent may boot the Simulator.
