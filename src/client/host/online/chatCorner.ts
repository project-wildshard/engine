// QA row 43 (Jake, 2026-11-10): "All this chat stuff bottom left is definitely chaotic … Let's just have chat and the little
// microphone button … chat messages should fade in and out for 5 seconds after they're written, and they should disappear.
// And when you press the chat box for typing, we should open some form of chat overlay that takes up way more space … you can
// click away or close that. It's kind of like a modal, but it's not a modal. It just expands it."
// The corner's two rules, apart from the DOM (chatLines.ts draws them).

/** A line stays this long in the calm corner, then fades. */
export const CHAT_FRESH_MS = 5000;
/** The fade itself; then the line is gone from the corner (the open chat still lists it). */
export const CHAT_FADE_MS = 600;
/** Lines the open chat keeps, newest last. */
export const CHAT_KEPT = 50;

/** How a line looks in the calm corner `now` ms after it was said. */
export type LineLook = 'fresh' | 'fading' | 'gone';
export function lineLook(saidAt: number, now: number): LineLook {
  const age = now - saidAt;
  return age < CHAT_FRESH_MS ? 'fresh' : age < CHAT_FRESH_MS + CHAT_FADE_MS ? 'fading' : 'gone';
}

/** What happens to the corner. `focus`: the input took focus. `inside`: a tap in the open chat. `outside`: a tap anywhere
 *  else. `close`: its × or Escape. `sent`: a line went out. `empty`: Enter on an empty input. */
export type CornerEvent = 'focus' | 'inside' | 'outside' | 'close' | 'sent' | 'empty';
/** Whether the chat is open after `event`. Only focusing the input opens it; sending keeps chatting mode open, as a tap
 *  inside does; a tap anywhere else, the ×, Escape or an empty Enter closes it. Nothing about it pauses or blocks the game. */
export function cornerOpen(open: boolean, event: CornerEvent): boolean {
  if (event === 'focus') return true;
  return (event === 'inside' || event === 'sent') && open;
}

// QA 2026-11-11 (Jake, iPhone, ~21:06 Cancún: "lol don't show microphone and chat on the loading screen"): the mic, the input and
// the mic tip stood over the loading card's READY rows and its SETTINGS button. The corner is for players in the world, so it
// shows only in play, decided from the page's own state marks on <html> (this module is outside the game's bundle):
// `data-ws-state` (App.setState), `data-ws-menu` (a menu or panel over the world) and `data-ws-covered` (the loading card,
// src/client/engine/ui/layers.ts). The state turns `play` while the card still holds its READY / PLAY, so the cover counts too.

/** The app states that stand in the world. Boot, title, loading, paused, error and a capture do not. */
const IN_WORLD: ReadonlySet<string> = new Set(['play', 'explore', 'practice', 'playground', 'dead']);
/** The page's marks on <html> the corner reads (`document.documentElement.dataset`). */
export interface PageMarks { readonly wsState?: string; readonly wsMenu?: string; readonly wsCovered?: string }
/** Whether the chat corner (its input, the mic and the mic's tip) shows: in the world, with no menu over it and no loading card. */
export function cornerShown(marks: PageMarks): boolean {
  return marks.wsState !== undefined && IN_WORLD.has(marks.wsState) && marks.wsMenu === undefined && marks.wsCovered === undefined;
}
/** The marks `cornerShown` reads, as attribute names, for a MutationObserver. */
export const CORNER_MARKS: readonly string[] = ['data-ws-state', 'data-ws-menu', 'data-ws-covered'];
