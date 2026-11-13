// REMOTE-PLAYERS RP10: where a page sends a `hit` on another player. Kept apart from the body code (remoteHurt.ts) so the page's
// event loop routes it without loading any of that until a body is drawn.
import type { NetCombatEvent } from '../../../shared/engine/net/messages';

/** Another player's body a page can hurt, by its handle (OtherPlayers). */
export interface Hurtable { readonly hurt: (handle: number, amount: number, killed?: boolean) => boolean }

/** A `hit` on another player this page draws goes to that body; true when it did. This page's own and a creature's are not its. */
export function hurtOther(event: NetCombatEvent, own: number | undefined, others: Hurtable | null): boolean {
  if (event.kind !== 'hit' || others === null || event.target === own) return false;
  return others.hurt(event.target, event.amount, event.killed); // RP11: a killing blow lays the body down
}
