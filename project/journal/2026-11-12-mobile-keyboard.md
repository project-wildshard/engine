# 2026-11-12 mobile keyboard (meta MOBILE-KEYBOARD, J297)

- opus-kbchat: Jake (17:44 Cancún, iPhone 17 Pro, staging chat on Driftwood) wanted the chat just above the keyboard and
  the game fitted into what is left. `viewport.ts` now detects the keyboard from `visualViewport` (against the tallest
  page at this width: the iOS 26 Simulator shrinks `innerHeight` 714 -> 501 too, `visualViewport` 377, scrolled 213), only
  with a text field focused; marks `data-ws-keyboard`, `--ws-kb-top/bottom`; `viewportHeight()` is the band less the
  chat's `data-ws-kb-reserve`. Chat docks compact above it; touch HUD hides. claude -p review MUST (desktop window losing
  height) folded via the focus rule. Open: MK5 dismissal/rotation in the real online game, MK7 landscape, MK9 name prompt.
- opus-mk5 (MK5, real game: local production build + local room, Mobile Safari, iOS 26 Simulator, iPhone 17 Pro): after
  Done the open chat sizes to its lines (bottom kept, old height a ceiling), no empty top. Found in the real game: after
  Done iOS gives innerHeight back 503 -> 714 ~450 ms later with only visualViewport events, never a window resize, so
  the canvas stayed 503; `syncKeyboardView` now tells the game whenever its height moved on a look that is not a window
  resize, plus a 150 ms settle look. Rotation: phones are portrait-only (RotateGate pauses, chat closes, keyboard drops);
  back in portrait nothing is panned and the canvas is 714. The window-less Simulator rotates with a GraphicsServices
  purple event (type 50 | 0x20000, infoSize at record+48, orientation at +52, msgh_id 0x7B, 80 bytes) on its
  PurpleWorkspacePort. Shots: `~/.cache/wildshard/plan-artifacts/kbchat/real-*.png`.
