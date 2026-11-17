# MMO-PLAN GO5: a disagreeing hint enters the server's cell in place (opus-mmo1)

- A grid page boots the cell its hint names; when the door's `resume` names another cell, GO4 sent the page through `travel` again
  (a fresh document and a fresh socket). On a page with the app's same-page entry the shell now asks `regridInPage` first: the
  running session marks its link handed over (as at a gate's 0, ZE10d2), the page enters the server's cell in place, and the next
  session adopts the link (`rehome`) and says `ready`, so the door seats the body there on the same socket. No same-page entry, a
  cell the build can't open, or the re-entry bound reached: GO4's path as before.
- A held seat (a reload inside J114's 30 s, frames with no `resume`) still re-enters by GO4's reload: its body is already in the
  room and nothing waits for a `ready`.
- `scripts/regrid-in-page-proof.mjs` proves it on the local rig in Chromium and WebKit.

## GO5b: a `resume` that arrives mid-boot (opus-mmo2, 2026-11-17)

- opus-mmo1's in-page path ran only after control, and the common disagreement comes during the boot: the door's `resume` reaches
  the shell before the session can hand its link over and before the app's same-page entry is installed (`app/entry.ts` installs it
  at control), so the page still reloaded (the rig proof: two documents).
- `grid/regridLater.ts` holds that `resume` until both exist, then enters the seat's cell in place; the boot still reaches control,
  since its card waits for the server's first rows only `FIRST_ROWS_MS`. `travel.ts` `whenEntersInPage` says when the entry is in
  place. No way in place within 45 s, a session that refuses (a cell this build can't open, re-entries spent), or a page with no
  in-place entry at all: GO4's reload, as before.
- Red first: `regridLater.test.ts` (7 cases), and the rig proof's "one document after the title".
- Rig proof (`scripts/regrid-in-page-proof.mjs`), Chromium and WebKit: one document after the title, the in-place path ran, one seat
  link still open (the grid gate's world-word probe pings once and closes in a few ms), the player walks in Signal Dunes, no page
  errors. Was two documents. The proof now runs on one page: WebKit's pages in one context shared no localStorage here, so its third
  page had lost the name and the hint.
- Review MUSTs: an ask goes with the boot that made it (`ask` answers a cancel the session's scope runs, so a page sent back to the
  title mid-load never re-enters 45 s later), and a redial's `resume` between the hand-over and the next session's `adopt` names the
  cell the page is already entering, which the session now counts as done instead of spending a re-entry. Once GO4's reload has
  started, a later `resume` starts nothing more. Both proofs pass again on the rebuilt dist.
