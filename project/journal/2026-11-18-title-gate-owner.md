# 2026-11-18: the title keeps its deck while the world gate holds (SB49)

- opus-sb49: ENTER ZONE on staging sometimes ended on "Navigation shell
  requires a live owner"; a retry worked. The late catalogue owner in
  `app/entry.ts` awaited `menu.whenIdle()`, which waited only for the
  name prompt, then `refresh()` disposed the menu while the world gate
  still held the tap, so `go()` reached a dead deck.
- The deck reports `busy` while a gated tap or an entry is in flight;
  the menu's `whenIdle` waits for the name prompt, the MMO gate and the
  deck together, and never settles once the title entered a world (a
  refresh would cancel the navigation shell, a child of the deck).
