# The Bag's A sheet is its own class (MAP-NEXT MN15, MN16)

buddy-engine, 2026-11-19. Rides v0.1.54.

QA 11-19 row 59. At ~17:22 Jake asked: *"lets also update all the other in game bag menus and stuff with the new
layout"*. At ~17:24 he added: *"You touched the layout for everything lol"*. So: the Bag's tabs only, and the pause
menu and Settings stay as they were.

Row 58 (436d6ebf3) and MN11/MN12 (b67ce93b0) keyed the A rules on `.ws-gmenu:not(.pause)`:

- the short CLOSE and title header;
- the phone's full width;
- the bottom band above the home bar.

PAUSE was safe. But the title's Settings (`BootSettings.ts`) builds the same `.ws-gmenu` sheet with no `.pause`
class, so it took the Bag's layout too. Measured in WebKit at 402x874, its sheet went from 382 pt inset 10 (at
436d6ebf3's parent) to 402 pt full-bleed on main. 436d6ebf3 is in the v0.1.53 cut, so v0.1.53 ships that until v0.1.54.

The fix: `Menu.ts` puts `play` on the root whenever the group is not PAUSE (the group's own name: engine code may not
say "bag"), and every A rule in `gmenu.css` keys on `.ws-gmenu.play`. A Bag panel's padding is now 12px 7px 10px, so
GEAR, FINDS and PACK span 386 pt, the map's width. Before they were 368 pt (348 before row 58). The map's own padding
rule still wins on MAP. (The measured build named the class `bag`; the rename changes nothing else.)

Measured (WebKit 402x874, Bag standalone with `--ws-home` 34px and a 62 pt top inset stood in, Driftwood and Pine
Hollow):

- every Bag tab: header 37 + tabs 50, inner width 386, nothing past the panel's side;
- the lowest control: 821 pt (the map's zoom chips) in Driftwood, 795 pt (FINDS stickers) in Pine Hollow, both at or
  above 824;
- the title's Settings and PAUSE: identical to the pre-leak build (sheet 10+382, panel 380).

FEATS isn't on screen in either zone. Driftwood's manifest leaves it out of the Bag, and Pine Hollow has no feat rows
when the Bag is built. Its rows are full-width flex rows, so the shared panel rule covers them; `bag-sheet.test.ts`
opens it with the others. MN17 shoots it on a shard that shows it.

The tab hints ("TAP A WEAPON TO HOLD IT" and the rest) still sit under the content. They are text, not controls; only
the map dropped its hint line (row 58).

Tests (`bag-sheet.test.ts`, red on the old code first):

- every Bag tab has `play` and one header bar, and PAUSE has neither;
- `gmenu.css` has no `:not(.pause)` and keys the A rules on `.play`.

Shots: `~/.cache/wildshard/plan-artifacts/map-next/mn15/` (preleak, before, after, after-pine).
