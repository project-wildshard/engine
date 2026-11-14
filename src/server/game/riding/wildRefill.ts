import type { HerdBrain } from '@wildshard/engine/ai/herd';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { CreatureRefill, syncRefillState } from '@wildshard/engine/entities/creatureRefill';
import type { SimHost } from '@wildshard/engine/sim';
import type { SimSnapshot } from '@wildshard/engine/sim/snapshot';
import type { BondedMountRoster } from './roster';

/**
 * J108, J109 on a bonded-mount world: the place a tamed stallion left in a room's wild fills again on the refill's timer,
 * sooner with more players near it and never in front of one. The body that left the wild is the one that returns: it
 * stands hidden for the whole wait, so a return costs the shard's budget nothing.
 *
 * It sweeps the hidden stallions rather than listening for `creature.tamed`, so a horse tamed alone still comes back once a
 * second player joins and that player has a wild one to tame. One player's pasture stays empty and their save never gains
 * this row.
 */
export function installWildRefill(host: SimHost, mounts: BondedMountRoster, herds: () => readonly HerdBrain<AnimalSim>[],
  id: string, saved?: Readonly<Omit<SimSnapshot, 'physics'>>): (dt: number) => void {
  const state = `${id}.refill`;
  const herdOf = (actor: AnimalSim): HerdBrain<AnimalSim> | undefined => herds().find(row => row.members.includes(actor)) ?? herds()[0];
  const refill = new CreatureRefill({ players: () => [...host.players.values()], room: () => mounts.hidden.size, served: () => host.respawn.served,
    random: () => host.rng.stream('spawn').next(), spawn: ({ from, x, z }, yaw) => {
      const actor = host.entities.get(from), herd = actor === undefined ? undefined : herdOf(actor);
      if (actor === undefined || herd === undefined) return;
      mounts.reveal(from, x, z, yaw);
      herd.adoptStallion(actor); herd.addTrust(-100);
    } });
  host.events.on('world.slept', ({ seconds }) => { refill.slept(seconds); }, host.scope);
  if (saved?.adapters.some(row => row.id === state) === true) host.adapters.set(state, refill.state);
  return dt => {
    if (host.players.size > 1 || host.respawn.served) for (const hidden of mounts.hidden) {
      if (refill.pending.some(entry => entry.from === hidden)) continue;
      const actor = host.entities.get(hidden), herd = actor === undefined ? undefined : herdOf(actor);
      if (actor !== undefined && herd !== undefined) refill.left({ kind: actor.kind, variant: actor.variant, herd: actor.herd, x: herd.cx, z: herd.cz, from: hidden });
    }
    refill.step(dt); syncRefillState(host.adapters, state, refill);
  };
}
