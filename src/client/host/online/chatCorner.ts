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

/** J473 (grill wave 2): on a phone the closed chat peeks only its newest line, beside the chat icon, for this long; then the
 *  badge alone says there is more. No peek in a fight (`data-ws-fight`) or a talk (the corner is away then). */
export const PEEK_MS = 4000;

/** How a line looks in the calm corner `now` ms after it was said (`fresh`: how long it stays fresh there). */
export type LineLook = 'fresh' | 'fading' | 'gone';
export function lineLook(saidAt: number, now: number, fresh: number = CHAT_FRESH_MS): LineLook {
  const age = now - saidAt;
  return age < fresh ? 'fresh' : age < fresh + CHAT_FADE_MS ? 'fading' : 'gone';
}

// J473 (Jake, 2026-11-19 ~17:12 Cancún: "I do like the idea of them being icons and not a say something input box that takes up a lot
// of space, a chat icon with a badge is nice"): on a phone the closed corner is two icons stacked above MOVE, the mic over the chat
// icon, and the chat icon counts the lines others said since the chat was last open.

/** The chat icon's badge for `unread` lines: none at 0, the count up to 9, then 9+. */
export function badgeText(unread: number): string {
  return unread <= 0 ? '' : unread > 9 ? '9+' : String(unread);
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
export interface PageMarks { readonly wsState?: string; readonly wsMenu?: string; readonly wsCovered?: string; readonly wsTalk?: string }
/** Whether the chat corner (its input, the mic and the mic's tip) shows: in the world, with no menu over it, no loading card
 *  and no NPC dialogue open (J457, Jake 2026-11-19: "if you do start talking to NPCs, we hide the chat UI and we hide the
 *  microphone button"; `data-ws-talk`, src/client/engine/ui/layers.ts). Voice itself stays on while the corner is away. */
export function cornerShown(marks: PageMarks): boolean {
  return marks.wsState !== undefined && IN_WORLD.has(marks.wsState) && marks.wsMenu === undefined && marks.wsCovered === undefined
    && marks.wsTalk === undefined;
}
/** The marks `cornerShown` reads, as attribute names, for a MutationObserver. */
/** `data-ws-hurt` is not a show rule: a hit taken closes an open chat (J473 row 3). */
export const CORNER_MARKS: readonly string[] = ['data-ws-state', 'data-ws-menu', 'data-ws-covered', 'data-ws-talk', 'data-ws-hurt'];
