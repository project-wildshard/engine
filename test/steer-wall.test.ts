// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers, type MoverData } from '@wildshard/format/movers';
import type { ShardProps } from '@wildshard/format/props';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';
import { steerGround, steerReach } from '@wildshard/engine/sim/moverMotion';
import { expect, test } from 'vitest';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { MoverScriptDriver, type MoverRuntime } from '../src/server/game/plugin/mover';
import { FollowedMovers } from '../src/client/game/plugin/followedMovers';
import { Scope } from '../src/shared/engine/app/scope';
import { Physics } from '../src/shared/engine/physics/Physics';
import { groups } from '../src/shared/engine/physics/groups';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { vehicleHulls } from '@wildshard/format/vehicleHulls';
import { emptyShardfile } from '../src/shared/host/author';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// SHARD-SOURCE SS-GP5c: on staging a land-sail driven into one of Mirror Salt's race cubes (2.5 m) ended on its top, out of
// every walker's reach: its ground probe started inside the cube and stood it there, and the next probe found the top. A
// ground-following steer vehicle now climbs at most a step and stops at anything taller, as a walker does.
const steer = { kind: 'steer', speed: 8, turn: 1, boost: 1.5, accel: 40, ground: true } as const;
const trigger = { kind: 'interact', permission: 0 } as const;
const carry = {
  seat: 0.8, landings: [[2, 0, 0], [-2, 0, 0]], yaw: 0,
  surface: { level: 0, bankRamp: 0, bob: [0, 0], pitch: [0, 0], roll: [0, 0, 0] },
  prompts: [{ at: [0, 1, 0], radius: 3.8, label: 'Board' }, { at: [0, 2, 0], radius: 2, label: 'Leave' }],
};
const at = { x: 0, y: 0, z: -6 };
function sailRow(): MoverData[number] {
  const euler = { x: 0, y: 0, z: 0 }, lowered = lowerMoverMotion({ trigger, driver: steer }, { at, euler });
  const [row] = parseMovers([{ id: 'salt.sail', entity: 7, module: lowered.module, execution: 'native', kind: 'channel', at, euler,
    enabled: true, boxes: [], trigger, driver: steer, carry, input: lowered.input }]);
  if (row === undefined) throw new Error('Missing land-sail'); return row;
}
/** The sail's hull, as Mirror Salt's: 3.6 m long, so its bow stands 1.8 m ahead of its centre. */
const hullProps = { version: 1, family: 'pbr', overhang: 0, tiles: [], panels: [{ id: 'salt.sail', file: 'a'.repeat(64), visible: true }],
  models: [], far: null, textures: [], colliders: [
    { id: 'salt.sail', panel: 'salt.sail', initialActive: false, shapes: [{ kind: 'box', x: at.x, y: 0.7, z: at.z, hx: 0.6, hy: 0.125, hz: 1.8 }] },
  ] } as unknown as ShardProps;
const level = { ...SIM_LEVEL, entities: [] };
const BOW = 1.8, FACE = -12;

async function drive(box: { readonly top: number; readonly depth: number }, ticks: number): Promise<{ x: number; y: number; z: number }> {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host: SimHost = createSimHost(level, { rapier }), row = sailRow();
  try {
    const { R, world } = host.physics;
    // a block whose near face stands at z -12, across the sail's path
    world.createCollider(R.ColliderDesc.cuboid(1.8, box.top / 2, box.depth / 2).setTranslation(0, box.top / 2, FACE - box.depth / 2).setCollisionGroups(groups('WORLD')));
    const source = emptyShardfile({ slug: 'wall-test', name: 'Wall', author: 'Test', revision: 1, seed: 3 });
    const motion: MoverRuntime = new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(), rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } },
      { id: 'wall-test', drive: true, hulls: vehicleHulls({ movers: [row], props: hullProps }) });
    const walk = (n: number, moveZ: number): void => { for (let i = 0; i < n; i++) host.step(leadCommands(host, { moveX: 0, moveZ, yaw: 0 })); };
    walk(180, -1); // to the stern, in reach of the board prompt
    motion.command(row.id, 1); walk(1, 0);
    expect(motion.riding(row.id)).toBe(true);
    walk(ticks, -1);
    const { x, y, z } = motion.pose(row.id).position;
    return { x, y, z };
  } finally { host.dispose(); }
}

test('a land-sail driven into a 2.5 m block stops at its face, at ground height (SS-GP5c)', async () => {
  const stopped = await drive({ top: 2.5, depth: 3.6 }, 150); // 8 m/s for 2.5 s: 20 m of road, the face 4.2 m off its bow
  expect(stopped.y).toBeLessThan(0.05);
  expect(stopped.z - BOW).toBeGreaterThan(FACE - 0.05); // its bow is not inside the block
  expect(stopped.z - BOW).toBeLessThan(FACE + 0.6); // and it drove up to it
}, 30_000);

test('a land-sail driven onto a 0.3 m step climbs it (SS-GP5c)', async () => {
  const climbed = await drive({ top: 0.3, depth: 10 }, 90); // 8 m/s for 1.5 s ends on the step
  expect(climbed.z).toBeLessThan(FACE - 1);
  expect(climbed.y).toBeCloseTo(0.3, 2);
}, 30_000);

test('the probe stands no vehicle on a floor more than a step over it, and names a wall at its bow (SS-GP5c)', () => {
  // a 2.5 m block from z -12 on: the floor is 2.5 there and 0 elsewhere; a probe from inside it hits at its start
  const floor = (_x: number, z: number, fromY: number): number | undefined => z <= FACE ? Math.min(2.5, fromY) : 0;
  const reach = steerReach([{ z: 0, hz: 1.8 }]);
  expect(reach).toBeCloseTo(1.8, 6);
  expect(steerGround(floor, { x: 0, y: 0, z: -9 }, 0, reach)).toEqual({ ground: 0, blocked: false });
  expect(steerGround(floor, { x: 0, y: 0, z: FACE + 1.7 }, 0, reach)).toEqual({ ground: 0, blocked: true });
  // already over it (the staging sail): its centre's floor is 2 m up, past a step, so it keeps its height
  expect(steerGround(floor, { x: 0, y: 0, z: FACE - 0.5 }, 0, reach).ground).toBeUndefined();
});

test('the rider\'s page stops its predicted sail at the same face (SS-GP5c)', async () => {
  const physics = new Physics(await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')))), scope = new Scope('steer-wall');
  const row = sailRow(), { R, world } = physics;
  world.createCollider(R.ColliderDesc.cuboid(1.8, 1.25, 1.8).setTranslation(0, 1.25, FACE - 1.8).setCollisionGroups(groups('WORLD')));
  world.createCollider(R.ColliderDesc.cuboid(30, 0.5, 30).setTranslation(0, -0.5, 0).setCollisionGroups(groups('WORLD')));
  const movers = new FollowedMovers([row], { physics, scope, restoreFlags: new Set(), hulls: vehicleHulls({ movers: [row], props: hullProps }) });
  try {
    let pose = movers.pose(row.id);
    for (let i = 0; i < 150; i++) { physics.step(); pose = movers.predict(row.id, { throttle: 1, turn: 0, boost: false }, null, 0); }
    expect(pose.position.y).toBeLessThan(0.05);
    expect(pose.position.z - BOW).toBeGreaterThan(FACE - 0.05);
    expect(pose.position.z - BOW).toBeLessThan(FACE + 0.6);
  } finally { scope.dispose(); physics.dispose(); }
});
