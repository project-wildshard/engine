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
