# 2026-11-12 mobile keyboard (meta MOBILE-KEYBOARD, J297)

- opus-kbchat: Jake (17:44 Cancún, iPhone 17 Pro, staging chat on Driftwood) wanted the chat just above the keyboard and
  the game fitted into what is left. `viewport.ts` now detects the keyboard from `visualViewport` (against the tallest
  page at this width: the iOS 26 Simulator shrinks `innerHeight` 714 -> 501 too, `visualViewport` 377, scrolled 213), only
  with a text field focused; marks `data-ws-keyboard`, `--ws-kb-top/bottom`; `viewportHeight()` is the band less the
  chat's `data-ws-kb-reserve`. Chat docks compact above it; touch HUD hides. claude -p review MUST (desktop window losing
  height) folded via the focus rule. Open: MK5 dismissal/rotation in the real online game, MK7 landscape, MK9 name prompt.
