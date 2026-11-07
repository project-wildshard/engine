import type { Scope } from '../app/scope';

/** Keep scripted combat actors on the frame-rate scheduler. */
const pinned = new WeakMap<object, number>();
export function pinBrain(actor: object, scope?: Scope): void {
  if (scope?.disposed === true) return;
  pinned.set(actor, (pinned.get(actor) ?? 0) + 1);
  scope?.onDispose(() => {
    const count = (pinned.get(actor) ?? 1) - 1;
    if (count === 0) pinned.delete(actor); else pinned.set(actor, count);
  });
}
export function brainPinned(actor: object): boolean { return pinned.has(actor); }
