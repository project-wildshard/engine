import type { Scope } from '../../../shared/engine/app/scope';
/** Keep overlay gestures local even when their target resumes play during the same event. */
export function containMenuInput(root: EventTarget, scope: Scope): void {
  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click']) {
    scope.listen(root, type, (event) => { event.stopPropagation(); });
  }
}
