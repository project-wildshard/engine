# Keys in each platform's own words, and a guard against a slipped ⌘W

Jake was playing on his Mac, holding W to walk. The hint said "Alt to
dodge". A Mac has no key printed Alt, so he pressed the key beside the
space bar, which is ⌘. With W already down, that was ⌘W, and the tab
closed. His words: "Alt is not a thing ... the keyboard shortcuts need
to be showing, you know, Mac, Windows, Linux ... you can't have a
closed tab." Plan: meta repo `docs/plans/KEYBOARD-PLATFORM-PLAN.md`.

A page can't stop ⌘W. Chrome reserves close-tab, new-tab, new-window
and quit, and runs them before the page sees the key. Only in tab
fullscreen does the page get them first. What the page can do is ask.
A cancelled `beforeunload` makes the browser show its own "Leave site?"
dialog, but only after the page has had a gesture.

So the keys now read the way the player's keyboard does. `platform.ts`
reads client hints, then `navigator.platform`, then the UA. `keycap()`
says ⌥ Option, ⌘ Cmd and ⌃ Ctrl on a Mac, and Alt, Win and Ctrl
elsewhere. The desktop first hints stopped hard-coding their keys. They
read the player's own bindings, so a Mac shows "V / ⌥ Option to dodge"
and a rebound dodge shows its new key. Dodge keeps V and Alt/Option,
so Jake's hands don't have to relearn it. Explore's fly-down moves off
Ctrl, because Ctrl+W closes a Windows tab.

In play, a key the game owns does nothing in the browser. Alt+← no
longer goes Back, Alt+F no longer opens Chrome's menu, and the arrows
don't scroll. Text fields and focused buttons keep their keys. There
is no stopPropagation: the browser's default follows preventDefault,
and stopping propagation would starve the game's own listeners.
