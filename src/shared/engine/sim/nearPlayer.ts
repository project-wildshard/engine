/** One player of a room, as the rules that pick a foe read it. */
interface NearPlayer {
  readonly position: { readonly x: number; readonly z: number };
  readonly health: { readonly alive: boolean };
}

/**
 * The living player nearest a ground point, else the nearest of the dead: who an encounter there deals with. Encounter
 * rules measure on the ground plane, as `SimHost.nearestPlayer` measures in space for a body. A lone player is always the
 * answer, unread, so one player runs exactly as it did.
 */
export function nearestOnGround<P extends NearPlayer>(players: ReadonlyMap<string, P>, x: number, z: number): P {
  let best: P | undefined, bestAlive = false, bestScore = Infinity;
  for (const player of players.values()) {
    if (players.size === 1) return player;
    const { position } = player, alive = player.health.alive, score = (position.x - x) ** 2 + (position.z - z) ** 2;
    if ((alive && !bestAlive) || (alive === bestAlive && score < bestScore)) { best = player; bestAlive = alive; bestScore = score; }
  }
  if (best === undefined) throw new Error('Simulation host has no player');
  return best;
}
