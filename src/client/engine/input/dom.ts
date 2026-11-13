import type { Scope } from '../../../shared/engine/app/scope';

type DomEvent<K extends string> = K extends keyof (GlobalEventHandlersEventMap & WindowEventMap) ? (GlobalEventHandlersEventMap & WindowEventMap)[K] : Event;
/** Scoped widget gestures keep DOM event typing and dispose with their owner. Gameplay uses actions. */
export function listenDom<K extends string>(scope: Scope, target: EventTarget | null | undefined, type: K, fn: (event: DomEvent<K>) => void, options?: boolean | AddEventListenerOptions): void {
  if (target === null || target === undefined) return;
  scope.listen(target, type, (event) => { fn(event); }, typeof options === 'boolean' ? { capture: options } : options);
}
// When the last tap was answered on its pointerup, page-wide: iOS hit-tests the click that follows a touch again after
// that answer ran, so a tap that swaps a screen also clicks whatever the new screen put under the finger (QC2: title
// SHARD SELECT clicked the picker's ENTER WORLD and loaded Driftwood).
// The click is that same touch, so it lands where the tap was; a new tap or click elsewhere in the same half second is its
// own gesture and acts.
// QA 28 (Jake, 2026-11-10, preview on an iPhone: "pressing shard select loads me instantly into driftwood"): the half second
// was too short. That click comes after the tap's own answer has run, and on a busy page (the deck and its hero art built in
// that answer) it came later than 500 ms. At 402 px ENTER WORLD sits under SHARD SELECT's lower quarter, so it entered
// the selected shard. A new gesture always starts with a press, so the rule is now: a pointer click where the last answered
// tap was, with no press anywhere since, is that tap's. The time bound stays only as a backstop.
let tappedAt = -Infinity, tappedX = 0, tappedY = 0, pressedSinceTap = true;
const FOLLOW_MS = 5000;
const watching = new WeakSet<Scope>();
/** every press on the page while a tap target lives (once per owning scope): a new gesture is never a follow-through */
function watchPresses(scope: Scope): void {
  if (watching.has(scope) || typeof document === 'undefined') return;
  watching.add(scope);
  listenPage(scope, 'pointerdown', () => { pressedSinceTap = true; }, { capture: true, passive: true, on: 'document' });
}
/** A pointer click that only follows a tap already answered on its pointerup, on this element or any other. */
export function followsTap(event: MouseEvent): boolean {
  return event.detail > 0 && !pressedSinceTap && event.timeStamp - tappedAt < FOLLOW_MS
    && Math.abs(event.clientX - tappedX) <= 10 && Math.abs(event.clientY - tappedY) <= 10;
}
/** Answer an iOS tap before its cancellable synthesized click; keyboard clicks
 * remain active. Both listeners retire with the widget scope. */
export function listenTap(scope: Scope, target: HTMLElement, fn: () => void): void {
  watchPresses(scope);
  listenDom(scope, target, 'pointerup', (event) => {
    if (event.button !== 0 || (target instanceof HTMLButtonElement && target.disabled)) return;
    event.stopPropagation(); tappedAt = event.timeStamp; tappedX = event.clientX; tappedY = event.clientY; pressedSinceTap = false; fn();
  });
  listenDom(scope, target, 'click', (event) => {
    event.stopPropagation();
    if (followsTap(event)) return;
    fn();
  });
}
export function mountDom(scope: Scope, parent: HTMLElement, ...nodes: HTMLElement[]): void {
  parent.append(...nodes);
  for (const node of nodes) scope.ownNode(node);
}
/** the input events a page-wide listener may take (the set `wildshard/no-raw-input` guards) */
export type PageInputEvent = 'keydown' | 'keyup' | 'pointerdown' | 'pointerup' | 'pointermove' | 'pointercancel';
/**
 * A page-wide input listener (E362 AG18): a drag that leaves its widget, "a touch anywhere" that dismisses or skips,
 * a key a panel takes before the game does. The input layer owns every listener on the window or the document; code
 * outside it asks here, so `wildshard/no-raw-input` can refuse the raw form. `on` keeps the old target, because a
 * capture listener on the document runs after the window's.
 */
export function listenPage<K extends PageInputEvent>(scope: Scope, type: K, fn: (event: DomEvent<K>) => void, options?: AddEventListenerOptions & { on?: 'window' | 'document' }): void {
  const { on = 'window', ...rest } = options ?? {};
  scope.listen(on === 'document' ? document : window, type, fn, rest);
}

/**
 * Capture a pointer on an element (its moves and lift follow it anywhere). A pointer that is already gone throws:
 * Chrome on Android raises `InvalidStateError` when the touch was handed to the browser (a scroll, a system gesture)
 * before the pointerdown handler ran, and `NotFoundError` for an id it never knew. That touch's pointerup or
 * pointercancel is on its way, so the control runs uncaptured; the throw used to escape the handler, skip the rest of
 * the press and raise "A glitch was reported" (QA-FEEDBACK-2026-11-13 row 6, Sentry WILDSHARD-GAME-2M).
 * Every capture in the client goes through here (test/pointer-capture.test.ts). Returns whether the capture took.
 */
export function capturePointer(el: Element, pointerId: number): boolean {
  try { el.setPointerCapture(pointerId); return true; } catch { return false; }
}
