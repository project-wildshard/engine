import type { SimCommand } from '../../../server/engine/sim';
import type { PlayerSim } from '../../../server/engine/sim/playerSim';

/**
 * The host's first player: what a save, a tape or a page's own view means by "the player". A system serving a room reads
 * every player instead (P1-E5.2a); the uses are a ratchet.
 */
export function leadPlayer<P = PlayerSim>(host: { readonly players: ReadonlyMap<string, P> }): P {
  const first = host.players.values().next();
  if (first.done === true) throw new Error('Simulation host has no player');
  return first.value;
}
/** One tick's commands for a host driven as one player. */
export function leadCommands(host: { readonly players: ReadonlyMap<string, { readonly id: string }> }, command: SimCommand | undefined): ReadonlyMap<string, SimCommand> | undefined {
  return command === undefined ? undefined : new Map([[leadPlayer(host).id, command]]);
}
