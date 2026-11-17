import { parse } from 'valibot';
import { Vector3 } from 'three';
import { CreatureSensesSchema, type CreatureSenses } from '@wildshard/format/creatureLayers';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import { lineOfSight } from '@wildshard/engine/physics/query';

type Player = ReturnType<SimHost['nearestPlayer']>;
type Origin = Readonly<{ x: number; y: number; z: number }>;
/** Authored perception is executable authority. Omitted sensing keeps the
 * released adapter roster; a new sensed save cannot restore without its source. */
export function installCreatureSensesContract(host: SimHost, rows: ShardRows, spawns: ShardCreatures['spawns']): void {
  const species = new Map(rows.species.map(row => [row.id, row.senses]));
  const bindings = spawns.flatMap(spawn => {
    const input = species.get(spawn.species);
    return input === undefined ? [] : [{ actor: spawn.id, species: spawn.species, senses: parse(CreatureSensesSchema, input) }];
  }).sort((a, b) => a.actor.localeCompare(b.actor));
  if (bindings.length === 0) return;
  const id = 'creatures.senses', contract = JSON.stringify({ version: 1, bindings });
  if (host.adapters.has(id)) throw new Error('Creature senses already installed');
  const adapter = { snapshot: () => contract, restore: (saved: unknown) => {
    if (saved !== contract) throw new Error('Incompatible creature senses continuation');
  } };
  host.adapters.set(id, adapter);
  host.scope.onDispose(() => { if (host.adapters.get(id) === adapter) host.adapters.delete(id); });
}
/** Actual host observations only: no controller, body, random stream or mutable clock. */
export function bindCreatureSenses(host: SimHost, actor: AnimalSim, input?: CreatureSenses, origin: Origin = actor.position): {
  notices: (player: Player) => boolean; nearest: () => Player | undefined;
} {
  const senses = input === undefined ? undefined : parse(CreatureSensesSchema, input);
  const eye = new Vector3(), chest = new Vector3(), cone = senses?.sight === undefined ? 0 : Math.cos(senses.sight.cone);
  const notices = (player: Player): boolean => {
    if (host.players.get(player.id) !== player || !player.health.alive || host.parked.has(player.id)) return false;
    if (senses === undefined) return true;
    const dx = player.position.x - origin.x, dy = player.position.y - origin.y, dz = player.position.z - origin.z;
    const distance = dx * dx + dy * dy + dz * dz;
    if (senses.reveal !== undefined && distance <= senses.reveal * senses.reveal) return true;
    const sight = senses.sight;
    if (sight === undefined) {
      if (distance <= senses.notice * senses.notice) return true;
    } else {
      const range = actor.state === 'graze' ? sight.graze ?? sight.range : sight.range;
      if (distance <= range * range
      && dx * Math.sin(actor.yaw) + dz * Math.cos(actor.yaw) >= Math.hypot(dx, dz) * cone) {
        eye.set(origin.x, origin.y + actor.dims.bodyY * actor.scale, origin.z);
        chest.copy(player.position); chest.y += 1.2;
        if (lineOfSight(host.physics, eye, chest)) return true;
      }
    }
    const hearing = senses.hearing;
    if (hearing === undefined) return false;
    const speed = Math.hypot(player.velocity.x, player.velocity.z);
    const radius = speed < 0.4 ? hearing.still : speed < 2.6 ? hearing.crouch : speed < 5.2 ? hearing.walk : hearing.sprint;
    return distance <= radius * radius;
  };
  return { notices, nearest: () => {
    if (senses === undefined) return host.nearestPlayer(origin);
    let nearest: Player | undefined, best = Infinity;
    for (const player of host.players.values()) {
      if (!notices(player)) continue;
      const point = player.position, d = (point.x - origin.x) ** 2 + (point.y - origin.y) ** 2 + (point.z - origin.z) ** 2;
      if (d < best) { nearest = player; best = d; }
    }
    return nearest;
  } };
}
