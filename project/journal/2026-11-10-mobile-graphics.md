# Mobile Low / High graphics (meta MOBILE-GRAPHICS-PLAN, J235)

Jake, 2026-11-10 ~12:55 Cancun, after his Low Power runs: "we have two
things for mobile. We have mobile low graphics and mobile high
graphics", and "with low, you can just do… 1 time and 1 time".

- MG2: `render/graphicsMode.ts` holds a phone's Low / High, saved per
  device. Low draws at 1 drawing pixel per CSS pixel, High at today's
  phone cap (2x). It rides the A15 path: `drawingPixelRatio` (a
  Developer pick still wins), one `ws:pixels` event, Game's next drawn
  frame. Main menu > Settings > Graphics shows Low / High on a phone;
  the finer render scale is Developer-only there now. Desktop keeps
  everything as it was.
- MG3: graphicsMode reads boot/lowPower.ts (the idle title's reading,
  QA 27): "likely" runs Low and refuses High with the plan's words;
  Game re-reads it when the page comes back into view.
- MG4: a notice under the title logo on phones while it reads likely.
- MG5: a phone's first PLAY (device mark firstPlayDone, engine
  boot/firstPlayMark.ts) enters the deck's first card, Driftwood (game
  code may not name a shard), and game/firstPlay.ts shows the card at
  control: Low / High live, the Low Power line, DONE.
- MG6: main menu > Settings > First-time setup: Replay.
- scripts/mobile-graphics-proof.mjs: headless WebKit 390x844, Low Power
  played as a 30 Hz rAF; MG3-MG6 pass with it on and off.
- J206 review (Codex, NO-GO) fixed: the first-play intent is bound to
  its shard and ten minutes, kept only when storage keeps it, dropped by
  any other entry, spent when the card shows; the deck's own activate
  decides the entry (activate returns the card); a shard already in
  control shows the card at once; Game compares the mode every 2 s and
  a page back in view counts its frames (faster than 30 Hz = Low Power
  off); phone eligibility frozen at boot; the card has its own scope;
  the proof's 30 Hz clock serves every loop and checks the shard.
- Verify review (Codex, NO-GO on 3/5/6): the first PLAY's exemption is
  one navigation's (cleared on its entry and when SHARD SELECT opens);
  Settings repaints while open; fast frames outrun only the reading they
  beat, a newer title reading holds again. Rebased on a0d8ce3 (the Low
  Power reading on main); proof green on and off.
