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
