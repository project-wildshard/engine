# Rounds chip tap on touch (TE-ENG5)

- opus-teeng5: opus-bm8's phone run found the Rounds strip's RELOAD
  chip dead on touch. The touch layer cancels touchstart / touchend
  (E46, so no double-tap zoom or long-press lift), which also means a
  tap never synthesises a click, and the chip (HUD.mountBar) listened
  only for click. `ui/reloadChip.ts` now wires it with `listenTap`
  (pointerup, plus keyboard clicks, no double press), the same way
  the layer's pills already answer on pointerup. Its pointerdown
  still stops at the chip, so the look layer never sees the tap.
  Other tappable things in the layer already act on pointer events
  (pills, discs, the playground restart); the chip was the one.
- Codex review: no MUST; two SHOULDs, applied. A release now presses
  only when the same pointer went down on the chip and lifts over it
  (a touch keeps implicit capture on the chip, so a drag off it used
  to reload), and the test no longer claims Space (InputService
  takes Space for the game). Phone proof, headless WebKit iPhone and
  Chromium mobile at 402x874 on Brasscap: a chip tap feeds 4 / 6 to
  6 / 6 (reserve 30 to 28); stick, look drags, USE and FIRE pass.
