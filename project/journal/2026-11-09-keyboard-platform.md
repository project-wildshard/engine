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

## The leave guard

Then Jake: "show 'leave the game' and confirm for command W. Same for
command T, command N, command Q". `ui/leaveGuard.ts` cancels
`beforeunload` while the player is in the world (play, dead, a practice
room) and this page has seen a keyboard key, so ⌘W, ⌘Q, Ctrl+W and
Alt+F4 get the browser's "Leave site?". The browser picks the words; a
page's own text has been ignored since 2016. Touch-only phones never
press a key, so they never arm it, and iOS ignores the dialog anyway.

RL6 still holds: a reload the player asks for never prompts. Every
navigation the game makes on purpose already calls markUnload or
markReload (the reload pill, error reloads, graphics recovery, shard
travel, a stale build), and lastEnd now keeps that moment in memory
for ten seconds. The guard also stands down for ⌘R, Ctrl+R and F5,
which reach the page before the browser reloads. Title, loading, pause
and error menus never ask, and the build pill shows only there.

⌘T and ⌘N unload nothing. ⌘T hides the tab, and ws:background already
paused. ⌘N only blurs the window, which paused only if pointer lock was
on. The HUD now pauses on blur too, and the held keys were already let
go, so the player comes back to the pause menu standing still.
Settings ▸ Key bindings says it in the platform's words: "While
playing, ⌘W and ⌘Q ask before leaving the game; ⌘T and ⌘N pause it."

## Review (J206, Codex one-shot)

Seven MUST-FIX items, all taken. A reload from the toolbar can't be
told from a close, so the guard stands down while the pointer is
outside the page. That covers the toolbar, the tab strip and the menu
bar. A pointer-locked player gets there only through Esc, which
pauses, so the guard still covers the keyboard slip. Menus and
overlays over the world (bag, journal, feedback) disarm it, and so
does the online seat redirect, which now calls markUnload. Only a
trusted, physical key typed into the page arms it, so a phone's soft
keyboard never does. The game takes keys only while the player is in
the world with nothing over it (`InputService.playing`). Alt chords
are taken whether their letter is bound or not. F4, F5, F11 and F12
are never taken, even when rebound. A blur into one of the page's own
frames doesn't pause. On Linux the Meta key is labelled Super.
