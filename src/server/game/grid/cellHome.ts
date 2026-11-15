import type { Actor } from '@wildshard/engine/combat/pipeline';
import { gridZone } from '../../../shared/game/grid/rules';
import type { SimHost } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { CELL_ABOVE, CELL_BELOW, CHUNK_HALF } from '@wildshard/engine/core/config';
import { gridCreatureConstraint, installGridBorders } from '@wildshard/engine/physics/gridBorders';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';

/** A late controller may already have moved a driven boss before its own body step.
 * Start the physics query inside the home; this port has no hidden continuation. */
function bindHome(host: SimHost, actor: AnimalSim, mounted: readonly AnimalSim[]): void {
  const previous = actor.motionConstraint, radius = actor.dims.bodyRadius * actor.scale, limit = Math.max(0, CHUNK_HALF - radius - .001);
  const constrain = gridCreatureConstraint(() => host.physics, radius), start = { x: 0, y: 0, z: 0 };
  actor.motionConstraint = (from, to) => {
    previous?.(from, to);
    if (mounted.includes(actor)) return;
    start.x = Math.max(-limit, Math.min(limit, from.x)); start.z = Math.max(-limit, Math.min(limit, from.z));
    start.y = Math.max(-CELL_BELOW + radius + .001, Math.min(CELL_ABOVE - radius - .001, from.y));
    constrain(start, to);
  };
}
/** MP5.1: one cell's unmounted creatures stay home. Players and their mounted traveller remain free to cross. */
export function installCellHome(host: SimHost): void {
  const bound = new WeakSet<AnimalSim>(), mounted: AnimalSim[] = [];
  // Resolve the live object on every request: ids repeat between cells, and
  // seats and creatures can join or leave after installation.
  const interior = (actor: Actor): boolean => {
    const player = host.players.get(actor.id);
    if (player?.health === actor) return gridZone(player.position) === 'shard';
    const creature = host.entities.get(actor.id);
    return creature?.combatActor() === actor && gridZone(creature.position) === 'shard';
  };
  host.events.answer('damage.admit', request => request !== null && interior(request.target)
    && (request.source === 'env' || interior(request.source)) ? request : null, host.scope);
  const sync = (): void => {
    mounted.length = 0;
    for (const player of host.players.values()) { const ride = mountedPlayerOf(host, player.id); if (ride?.mounted === true && ride.horse !== null) mounted.push(ride.horse); }
    for (const actor of host.entities.values()) if (!bound.has(actor)) { bindHome(host, actor, mounted); bound.add(actor); }
  };
  // A dismount or a controller can put a capsule outside before its move.
  // Rapier then keeps it on the wall's outside face; repair that invalid start
  // after body resolution, while ordinary in-home movement needs no reset.
  const repair = (): void => {
    for (const actor of host.entities.values()) {
      if (mounted.includes(actor)) continue;
      const limit = Math.max(0, CHUNK_HALF - actor.dims.bodyRadius * actor.scale - .001);
      const x = Math.max(-limit, Math.min(limit, actor.position.x)), z = Math.max(-limit, Math.min(limit, actor.position.z));
      if (x === actor.position.x && z === actor.position.z) continue;
      actor.position.x = x; actor.position.z = z;
      if (actor.motor instanceof CharacterMotor) actor.motor.resetAt(actor.position);
    }
  };
  installGridBorders(host.physics, host.scope); sync(); repair();
  host.onStep('grid.home', sync, { joined: true, snapshot: () => null, restore: value => { if (value !== null) throw new Error('Invalid cell home continuation'); },
    physicsRestored: () => { installGridBorders(host.physics, host.scope); sync(); repair(); } });
  host.onStep('grid.home.poses', repair, undefined, 'afterBodies');
}
