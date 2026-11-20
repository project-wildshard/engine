# Zone Select gets its tabs and Jake's carousel

> Written by: Claude (opus-zs-look), 2026-11-19 ~21:58 Cancún

Meta ZONE-SELECT-SERVED ZS10. J461 asked for Featured, Popular and New tabs across the top; J468 is Jake's pick from the
variants board (https://claude.ai/artifact/FDzM6sgRKvnRnx9xCcV2c9): "a combo of full screen full bleed swipe. and today
cleaned ... name and one line description ... count feats still ... 4 hero images the small ones at the bottom like 09 ...
Like 04 we want 1/8 and the little blue thing with the gray little stripes"; J469 adds a Developer-only ALL laid out as
board 03 ("so i can infinitely scroll and click to find it without swiping for days").

The deck (`titleDeck.ts`) takes `tabs` and refills its track and dots per tab, keeping its swipe and ENTER ZONE wiring.
`strip: 4` turns the dots into four mini heroes in a window that slides once past the second ([0] 1 2 3, 0 [1] 2 3,
1 [2] 3 4); every dot stays in the row and the row scrolls, so the proof scripts that tap `.ws-menu-dots i` by index keep
working. The card's line carries the zone's feats; the old two-line summary is gone from Zone Select (the slug page keeps
it). The menu (`mainMenu.ts` `zoneTabs`) orders each tab by the room list; FEATURED falls back to the build's cards so it
never empties.

Calls made with Jake away: feats read "0 FEATS" for an unvisited zone rather than NOT VISITED (the blind judge read
NOT VISITED as a missing count); drafts appear only on ALL; the build pill drops under the tab row on Zone Select.
