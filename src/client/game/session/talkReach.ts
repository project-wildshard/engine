import type { Scope } from '@wildshard/engine/app/scope';

/** The input stack calls this module needs (InputService). */
export interface TalkReachInput {
  readonly top: string;
  hasContext: (id: string) => boolean;
  readonly contexts: readonly string[];
  push: (id: string, scope: Scope) => void;
  pop: (id: string) => void;
}

/**
 * QA-FEEDBACK-2026-11-24 row 37 (Jake, ~15:10 Cancún: "talking to the sherfiff in brasscap shoot the gun instead"). The `talk`
 * input context (src/client/game/inputContexts.ts: the left mouse button talks and fires nothing) is on the stack while a person's
 * talk is the nearest prompt with nothing over the world, or while a talk is open. A weapon equipped meanwhile pushes its own
 * context over it, so the talk context goes back on top; a menu or the talk box over it stays over it. Called every frame.
 */
export function syncTalkReach(input: TalkReachInput, scope: Scope, inReach: boolean): void {
  if (!input.hasContext('talk')) return;
  if (!inReach) { input.pop('talk'); return; }
  if (!input.contexts.includes('talk')) { input.push('talk', scope); return; }
  if (input.top.startsWith('weapon.')) { input.pop('talk'); input.push('talk', scope); }
}
