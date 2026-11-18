import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim, prepareShardfileSimRestore, type ShardfileSimulation } from '../src/server/game/plugin/simulation';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import type { SimCommand } from '../src/server/engine/sim';

// ONE-FORMAT CC40b1: a plain-JSON creature with a `mount` row is ridden by the one riding primitive, with no shard code.
const GAITS = { walk: 2, gallop: 10 };
const look = { id: 'fixture.horse.look', species: 'fixture.horse', recipe: 'fixture.placeholder', material: null, parameters: {}, animation: { recipe: 'fixture.placeholder', parameters: {} } };
function horseShard(mount: object | null = { gaits: GAITS }) {
  const base = emptyShardfile({ slug: 'riding-fixture', name: 'Riding fixture', author: 'Test', revision: 1, seed: 11 });
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], strikes: [], looks: [look], species: [{
    id: 'fixture.horse', kind: 'horse', label: 'Horse', aggressive: false, lockable: true,
    dims: { bodyY: 1.4, bodyHalfLen: 1, bodyRadius: 0.4, headRadius: 0.25, legLen: 0.9, feet: [], halfWidth: 0.4 },
    variants: [{ id: 'bay', label: 'Bay', rarity: 'common', weight: 1, scale: [1, 1], hp: 60,
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } }],
    body: { size: 'large', scale: 1, look: 'fixture.horse.look' },
    temperament: { brain: 'pursue', reaction: 'passive', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
      tuning: { speed: 1.2, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 } },
    senses: { notice: 4 },
    ...(mount === null ? {} : { mount }),
  }] });
  const spawn: ShardCreatures['spawns'][number] = { id: 'fixture.horse:1', species: 'fixture.horse', variant: 'bay', brain: null, strike: null,
    at: [1.5, 0, 0], seed: 3, scale: 1, yaw: 0 };
  return { ...base, spawn: { x: 0, y: 0, z: 0, yaw: 0 }, rows, creatures: { brains: [], groups: [], spawns: [spawn] } };
}
/** A walk is the stick pushed a little; a gallop is GALLOP held. */
const reins = (stick: number, sprint: boolean): SimCommand => ({ commandVersion: 1, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: stick },
  sprint, moveX: 0, moveZ: 0, yaw: 0 });
function ride(sim: ShardfileSimulation, seconds: number, command: SimCommand): number {
  const player = sim.host.players.values().next().value;
  if (player === undefined) throw new Error('Missing player');
  const steps = Math.round(seconds * 60), horse = sim.host.entities.get('fixture.horse:1');
  if (horse === undefined) throw new Error('Missing horse');
  const commands = new Map([[player.id, command]]);
  let travelled = 0;
  for (let i = 0; i < steps; i++) {
    const { x, z } = horse.position; sim.host.step(commands);
    if (i >= steps - 60) travelled += Math.hypot(horse.position.x - x, horse.position.z - z);
  }
  return travelled; // metres in the last second
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));

test('CC40b1: a mount creature is mounted, walks and gallops at its row speeds, and dismounts', () => {
  const sim = createShardfileSim(horseShard(), new Map(), { rapier });
  try {
    const riding = sim.riding, player = sim.host.players.values().next().value, horse = sim.host.entities.get('fixture.horse:1');
    if (riding === null || player === undefined || horse === undefined) throw new Error('Missing riding fixture');
    expect(actRoutes(sim.host).mountable?.(horse.entityId)).toBe(true);
    actRoutes(sim.host).ride?.(player.id, 'mount');
    expect(riding.ridden(player.id)).toBe(horse);
    expect(horse.driven).toBe(true);
    expect(ride(sim, 3, reins(0.3, false))).toBeCloseTo(GAITS.walk, 0);
    expect(player.ridden).toBe(horse.entityId);
    const gallop = ride(sim, 6, reins(1, true));
    expect(Math.abs(gallop - GAITS.gallop) / GAITS.gallop).toBeLessThan(0.05);
    ride(sim, 4, reins(0, false));
    actRoutes(sim.host).ride?.(player.id, 'dismount');
    expect(riding.ridden(player.id)).toBe(null);
    expect(horse.driven).toBe(false);
    expect(Math.hypot(player.position.x - horse.position.x, player.position.z - horse.position.z)).toBeLessThan(3);
  } finally { sim.dispose(); }
});

test('CC40b1: a species without a mount row installs no riding primitive', () => {
  const plain = createShardfileSim(horseShard(null), new Map(), { rapier });
  try { expect(plain.riding).toBe(null); } finally { plain.dispose(); }
});

test('CC40b1: a save mid-ride restores the seat and the gait', () => {
  const shard = horseShard(), first = createShardfileSim(shard, new Map(), { rapier }), resumed = prepareShardfileSimRestore(shard, new Map(), { rapier });
  try {
    const player = first.host.players.values().next().value;
    if (player === undefined) throw new Error('Missing player');
    actRoutes(first.host).ride?.(player.id, 'mount');
    ride(first, 2, reins(1, true));
    resumed.restore(snapshotSimHost(first.host));
    const again = resumed.simulation;
    expect(again.riding?.ridden(player.id)?.entityId).toBe('fixture.horse:1');
    const a = ride(first, 1, reins(1, true)), b = ride(again, 1, reins(1, true));
    expect(b).toBeCloseTo(a, 3);
  } finally { first.dispose(); resumed.simulation.dispose(); }
});
