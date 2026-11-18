import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import type { SimCommand } from '../src/server/engine/sim';

// ONE-FORMAT OF37b (Q-S10: a separate patrol primitive, shard-format OF37a): a `creatures.patrols` row walks its members
// round the route at its speed, in step. A player within `engage` metres of any member draws the patrol into the fight;
// once every member is more than `leash` metres from the route it gives up and walks back to where it left the route,
// then walks on.
const WOLVES = ['fixture.wolf:1', 'fixture.wolf:2', 'fixture.wolf:3'];
const ROUTE: [number, number, number][] = [[20, 0, 0], [20, 0, 30], [40, 0, 30]];
const ENGAGE = 5, LEASH = 10, SPEED = 3;
function patrolShard() {
  const base = emptyShardfile({ slug: 'patrol-fixture', name: 'Patrol fixture', author: 'Test', revision: 1, seed: 7 });
  const looks = [{ id: 'fixture.wolf.look', species: 'fixture.wolf', recipe: 'fixture.placeholder', material: null, parameters: {},
    animation: { recipe: 'fixture.placeholder', parameters: {} } }];
  const species = [{
    id: 'fixture.wolf', kind: 'blob', label: 'wolf', aggressive: false, lockable: true,
    dims: { bodyY: 0.5, bodyHalfLen: 0.5, bodyRadius: 0.5, headRadius: 0.2, legLen: 0.1, feet: [], halfWidth: 0.5 },
    variants: [{ id: 'grey', label: 'Grey', rarity: 'common', weight: 1, scale: [1, 1], hp: 60,
      mods: { speed: 1, chargeDist: 1, damageTaken: 1, chargeDamage: 0, relentless: false } }],
    body: { size: 'small', scale: 1, look: 'fixture.wolf.look' },
    temperament: { brain: 'pursue', reaction: 'passive', leash: 35, assist: 0, home: { speed: 2, stop: 1 },
      tuning: { speed: 1, turnRate: 4, thinkDivisor: 3, attackCooldownTicks: 60, wanderRadius: 0, wanderEveryTicks: 420 } },
    senses: { notice: 4 },
  }];
  const rows = parseRows({ weather: [], days: [], compendiums: [], loot: [], strikes: [], looks, species });
  const spawns: ShardCreatures['spawns'] = WOLVES.map((id, i) => ({ id, species: 'fixture.wolf', variant: 'grey', brain: null, strike: null,
    at: [19 + i, 0, -1], seed: i + 1, scale: 1, yaw: 0 }));
  const patrols = [{ id: 'fixture.patrol', members: WOLVES, route: ROUTE, speed: SPEED, engage: ENGAGE, leash: LEASH }];
  return { ...base, spawn: { x: -60, y: 0, z: -60, yaw: 0 }, rows, creatures: { brains: [], groups: [], patrols, spawns } };
}
const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const still: SimCommand = { moveX: 0, moveZ: 0, yaw: 0 };

test('OF37b: a three-wolf patrol walks its route, engages and walks back', () => {
  const sim = createShardfileSim(patrolShard(), new Map(), { rapier });
  try {
    const player = sim.host.players.values().next().value;
    const wolves = WOLVES.map(id => sim.host.entities.get(id));
    if (player === undefined || wolves.some(w => w === undefined)) throw new Error('Missing player or wolves');
    const pack = wolves.flatMap(w => w === undefined ? [] : [w]);
    const tick = (count = 1): void => { for (let i = 0; i < count; i++) sim.host.step(new Map([[player.id, still]])); };
    const centre = () => ({ x: pack.reduce((s, w) => s + w.position.x, 0) / pack.length, z: pack.reduce((s, w) => s + w.position.z, 0) / pack.length });
    const stand = (x: number, z: number): void => { player.position.set(x, 0, z); player.motor.resetAt(player.position); };
    // walks: from the first stop towards the second, in step
    tick(60 * 6);
    const walked = centre();
    expect(walked.z, 'the patrol walks towards its second stop').toBeGreaterThan(8);
    expect(Math.abs(walked.x - 20), 'it keeps to the route').toBeLessThan(3);
    for (const w of pack) expect(Math.hypot(w.position.x - walked.x, w.position.z - walked.z), 'in step').toBeLessThan(4);
    // engages: a player within reach draws every member towards it (west, away from every leg of the closed route)
    const left = centre();
    stand(left.x - ENGAGE + 1, left.z);
    tick(30);
    const near = pack.map(w => Math.hypot(w.position.x - player.position.x, w.position.z - player.position.z));
    stand(left.x - 40, left.z);
    tick(60 * 3);
    for (const w of pack) expect(w.position.x, 'members chase the player off the route').toBeLessThan(left.x - 2);
    expect(near.every(d => d < ENGAGE + 3)).toBe(true);
    // gives up past the leash and walks back to where it left the route
    tick(60 * 10);
    const back = centre();
    expect(Math.abs(back.x - 20), 'back on the route').toBeLessThan(3);
    // then walks on
    const resumed = centre().z;
    stand(-60, -60);
    tick(60 * 4);
    expect(centre().z).toBeGreaterThan(resumed + 4);
  } finally { sim.dispose(); }
});
