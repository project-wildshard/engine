# 2026-11-17 MMO failure modes, save status (opus-mfm2, plan/mfm2)

- FM8s modes 30, 30b, 31: the server already sent each player `save-confirmed` / `save-failed`
  (FM7b3) and nothing showed them. `online/saveScreens.ts` does now: a failure is Saving ·
  retrying at once, the card after 10 s of failing, and no confirmed save for 75 s (the room's
  60 s checkpoint, now `SAVE_CHECKPOINT_MS` in `persistenceWord.ts`, plus 15 s) is the late
  chip. No fact heard means an old server or memory store: nothing shows, ever.
- Leave the world is held through a cancelable `ws:leave-world` event that HUD.exitToMenu
  dispatches: online.js is its own bundle, so a module-level gate in lastEnd would be a second
  copy. Reloads are not held (R3/R4 keep their bounds).
- FM8s proof: the rig had no breakable database (no Postgres binary here). `pglite:` saves run
  PGlite in the proof's process on a Unix socket behind `databaseFront` (rig-listeners.mjs) on
  the rig's database port. `hold` lets a connection start (through its first ReadyForQuery) and
  then keeps every query, so a write is late and never fails (pg's 3 s connect timeout would
  otherwise turn a held new connection into a failure); `refuse` drops every connection.
- FM5b1-3 mode 24: `retentionWatch.ts` reads the signed `/code-retention.json` against a fresh
  verified release at boot and on each `ws-live-build` (the 5-minute/foreground poll); only a
  verified matching file says retired, and a 404, failed read or bad signature never undoes one.
  `tooOldScreens.ts`: a banner in play (countdown only from a signed `retireAt`, else "at the
  next load"; it never navigates), and the `too-old` page at the next zone entry, reconnect or
  before the first seat. Update is the Play-here reload, once.
- FM4 leftover, a focus trap in cards: linkScreens' cards had one since 3c20f8e9a; the other
  cards that stop play did not (the version-skew new-build page, download-failed, doctor-http).
  The trap is `ui/focusTrap.ts` now and all four use it; the new-build page is aria-modal and
  takes focus on its Reload.
