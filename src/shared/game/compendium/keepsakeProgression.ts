/** The keepsakes' progression law (Driftwood's sea glass charms), shared by the page (compendium/keepsakes.ts) and the room
 *  (server/game/loot/keepsakeProgression.ts, SERVER-PARITY SS3b): how many of the economy's progression flags a player holds
 *  picks one admitted state, and that state names everything earned so far. */

/** The admitted state for a player who holds `has`'s flags. A table with no state for that count is refused. */
export function progressionState<S>(progression: { readonly flags: readonly string[]; readonly states: readonly S[] }, has: (flag: string) => boolean): S {
  const state = progression.states[progression.flags.filter(has).length];
  if (state === undefined) throw new Error('Missing admitted reward state');
  return state;
}
