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
let tappedAt = -Infinity, tappedX = 0, tappedY = 0;
/** A pointer click that only follows a tap already answered on its pointerup, on this element or any other. */
export function followsTap(event: MouseEvent): boolean {
  return event.detail > 0 && event.timeStamp - tappedAt < 500 && Math.abs(event.clientX - tappedX) <= 10 && Math.abs(event.clientY - tappedY) <= 10;
}
/** Answer an iOS tap before its cancellable synthesized click; keyboard clicks
 * remain active. Both listeners retire with the widget scope. */
export function listenTap(scope: Scope, target: HTMLElement, fn: () => void): void {
  listenDom(scope, target, 'pointerup', (event) => {
    if (event.button !== 0 || (target instanceof HTMLButtonElement && target.disabled)) return;
    event.stopPropagation(); tappedAt = event.timeStamp; tappedX = event.clientX; tappedY = event.clientY; fn();
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
