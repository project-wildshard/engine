// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers, type MoverData } from '@wildshard/format/movers';
import type { ShardProps } from '@wildshard/format/props';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { expect, test } from 'vitest';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { MoverScriptDriver, type MoverRuntime } from '../src/server/game/plugin/mover';
import { FollowedMovers } from '../src/client/game/plugin/followedMovers';
import { Scope } from '../src/shared/engine/app/scope';
import { Physics } from '../src/shared/engine/physics/Physics';
import { floorBelow } from '../src/shared/engine/physics/query';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { vehicleHulls } from '@wildshard/format/vehicleHulls';
import { emptyShardfile } from '../src/shared/host/author';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// SHARD-SOURCE SS-GP5: a parked steer vehicle (Mirror Salt's land-sail) had no hull, so a player walked through it. The format
// keeps a carry `channel` box-free, so its hull is its panel's collider row (the sdk writes it inactive, so an engine before this
// leaves it off): that row rides the vehicle as a kinematic body, stops a walker, and never blocks its rider or its own ground.
const steer = { kind: 'steer', speed: 8, turn: 1, boost: 1.5, accel: 40, ground: true } as const;
const trigger = { kind: 'interact', permission: 0 } as const;
const carry = {
  seat: 0.8, landings: [[2, 0, 0], [-2, 0, 0]], yaw: 0,
  surface: { level: 0, bankRamp: 0, bob: [0, 0], pitch: [0, 0], roll: [0, 0, 0] },
  prompts: [{ at: [0, 1, 0], radius: 3.8, label: 'Board' }, { at: [0, 2, 0], radius: 2, label: 'Leave' }],
};
function sailRow(at: { x: number; y: number; z: number }, yaw: number): MoverData[number] {
  const euler = { x: 0, y: yaw, z: 0 }, lowered = lowerMoverMotion({ trigger, driver: steer }, { at, euler });
  const [row] = parseMovers([{ id: 'salt.sail', entity: 7, module: lowered.module, execution: 'native', kind: 'channel', at, euler,
    enabled: true, boxes: [], trigger, driver: steer, carry, input: lowered.input }]);
  if (row === undefined) throw new Error('Missing land-sail'); return row;
}
/** The hull as the sdk writes it: the panel's collider row, in world space at the vehicle's rest, inactive. */
const hullProps = (x: number, z: number, yaw = 0): ShardProps => ({ version: 1, family: 'pbr', overhang: 0, tiles: [], panels: [{ id: 'salt.sail', file: 'a'.repeat(64), visible: true }],
  models: [], far: null, textures: [], colliders: [
    { id: 'salt.sail', panel: 'salt.sail', initialActive: false, shapes: [{ kind: 'box', x, y: 0.7, z, hx: 0.6, hy: 0.125, hz: 1.8, ...(yaw === 0 ? {} : { yaw }) }] },
    { id: 'scene.post', panel: null, initialActive: true, shapes: [{ kind: 'box', x: 9, y: 1, z: 9, hx: 0.1, hy: 1, hz: 0.1 }] },
  ] } as unknown as ShardProps);
const level = { ...SIM_LEVEL, entities: [] };
function install(host: SimHost, row: MoverData[number], props: ShardProps | null): MoverRuntime {
  const source = emptyShardfile({ slug: 'hull-test', name: 'Hull', author: 'Test', revision: 1, seed: 3 });
  return new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(), rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } },
    { id: 'hull-test', drive: true, hulls: vehicleHulls({ movers: [row], props }) });
}
const walk = (host: SimHost, ticks: number, moveX: number, moveZ: number): void => {
  for (let i = 0; i < ticks; i++) host.step(leadCommands(host, { moveX, moveZ, yaw: 0 }));
};

test('a steer vehicle\'s panel collider is its hull, in its own frame; another panel\'s is not', () => {
  const turned = sailRow({ x: 4, y: 0, z: -6 }, Math.PI / 2);
  const hulls = vehicleHulls({ movers: [turned], props: hullProps(4, -6, Math.PI / 2) });
  expect([...hulls.keys()]).toEqual(['salt.sail']);
  const [box] = hulls.get('salt.sail') ?? [];
  // built turned a quarter: in its own frame the box lies along its heading, unturned
  expect(box?.x).toBeCloseTo(0, 6); expect(box?.y).toBeCloseTo(0.7, 6); expect(box?.z).toBeCloseTo(0, 6);
  expect(Math.abs(box?.rot.w ?? 0)).toBeCloseTo(1, 6);
  expect(vehicleHulls({ movers: [turned], props: null }).size).toBe(0);
});

test('a walker is stopped by a parked hull; its rider boards and drives it, and its own hull never lifts it (SS-GP5)', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const row = sailRow({ x: 0, y: 0, z: -6 }, 0);
  // without the hull (an engine before SS-GP5, or no solid) the walker passes straight through the parked sail
  const open = createSimHost(level, { rapier });
  try { install(open, row, null); walk(open, 180, 0, -1); expect(leadPlayer(open).position.z).toBeLessThan(-8); } finally { open.dispose(); }

  const host = createSimHost(level, { rapier }), motion = install(host, row, hullProps(0, -6));
  try {
    walk(host, 180, 0, -1); // 3 m/s for 3 s toward the hull's stern at z -4.2
    const stopped = leadPlayer(host).position;
    expect(stopped.z).toBeGreaterThan(-4.2); expect(stopped.z).toBeLessThan(-3.2);
    const [board] = motion.ridePrompts(); // the board prompt still reaches the player stopped at the stern
    expect(Math.hypot(stopped.x - (board?.position.x ?? 0), stopped.z - (board?.position.z ?? 0))).toBeLessThan(board?.radius ?? 0);

    motion.command(row.id, 1); walk(host, 1, 0, 0);
    expect(motion.riding(row.id)).toBe(true);
    walk(host, 60, 0, -1); // forward is -z: the rider sits in the hull's box and is not stopped by it
    const driven = motion.pose(row.id).position;
    expect(driven.z).toBeLessThan(-10);
    expect(Math.abs(driven.y)).toBeLessThan(0.05); // ground follow finds the floor, not its own hull's top
    expect(leadPlayer(host).position.distanceTo({ x: driven.x, y: driven.y + carry.seat, z: driven.z } as never)).toBeLessThan(0.2);
    // the hull went with it: its top stands where it is now, and the parked spot is open ground
    expect(floorBelow(host.physics, driven.x, driven.z, 5, 10)).toBeCloseTo(driven.y + 0.825, 2);
    expect(floorBelow(host.physics, 0, -6, 5, 10)).toBeCloseTo(0, 2);
  } finally { host.dispose(); }
});

test('a page\'s followed vehicle carries its hull where the wire poses it (SS-GP5)', async () => {
  const physics = new Physics(await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))), scope = new Scope('page');
  const row = sailRow({ x: 0, y: 0, z: -6 }, 0);
  const movers = new FollowedMovers([row], { physics, scope, restoreFlags: new Set(), hulls: vehicleHulls({ movers: [row], props: hullProps(0, -6) }) });
  physics.step();
  expect(floorBelow(physics, 0, -6, 5, 10)).toBeCloseTo(0.825, 2);
  movers.follow(row.id, { position: { x: 3, y: 0, z: -12 }, euler: { x: 0, y: 0.4, z: 0 }, enabled: true });
  physics.step();
  expect(floorBelow(physics, 3, -12, 5, 10)).toBeCloseTo(0.825, 2);
  expect(floorBelow(physics, 0, -7.5, 5, 10)).toBeUndefined(); // no level here: the parked spot is empty
  scope.dispose(); physics.dispose();
});
