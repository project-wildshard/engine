/** The keepsakes' law, shared by the page (compendium/keepsakes.ts) and the room (server/game/loot/keepsakeProgression.ts,
 *  SERVER-PARITY SS3b): how many of the economy's progression flags a player holds picks one admitted state, and that state
 *  names everything earned so far (Driftwood's sea glass charms). And whose book a taken pickup lands in (HS4). */
import { isCosmetic, type CosmeticId, type Owned, type OwnedId } from '../loot/Owned';

/** The admitted state for a player who holds `has`'s flags. A table with no state for that count is refused. */
export function progressionState<S>(progression: { readonly flags: readonly string[]; readonly states: readonly S[] }, has: (flag: string) => boolean): S {
  const state = progression.states[progression.flags.filter(has).length];
  if (state === undefined) throw new Error('Missing admitted reward state');
  return state;
}

/** What a page reads and asks of the room it plays in: whether the server's book has a cosmetic on, and a wear act to flip it. */
export interface KeepsakeRoom { readonly worn: (id: CosmeticId) => boolean; readonly wear: (id: CosmeticId) => void }

/**
 * A keepsake pickup the player took (Driftwood's trophies and the captain's hat). Off a room the page owns the book: it grants
 * the item and puts on what its drop wears. In a room the server granted it at the kill (personal loot, a filed item) and keeps
 * what is worn (SERVER-PARITY HS4), so the page grants nothing and asks the room to put a worn drop on, unless its book already has.
 */
export function takeKeepsake(owned: Owned, id: OwnedId, wear: boolean, room: KeepsakeRoom | null): void {
  if (room === null) { owned.grant(id); if (wear && isCosmetic(id)) owned.wear(id); return; }
  if (wear && isCosmetic(id) && !room.worn(id)) room.wear(id);
}
