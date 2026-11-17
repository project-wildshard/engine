// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers, type MoverData } from '@wildshard/format/movers';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { expect, test } from 'vitest';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { MoverScriptDriver, type MoverRuntime } from '../src/server/game/plugin/mover';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// SHARD-SOURCE SS-MS2a1b: a carry mover with a `steer` driver moves by its rider's stick and boost, not a fixed path.
const steer = { kind: 'steer', speed: 8, turn: 1, boost: 1.5, accel: 40, ground: false } as const;
const trigger = { kind: 'interact', permission: 0 } as const;
const at = { x: 0, y: 1, z: 0 }, euler = { x: 0, y: 0, z: 0 };
const carry = {
  seat: 0.8, landings: [[2, 0, 0], [-2, 0, 0]], yaw: 0,
  surface: { level: 0, bankRamp: 0, bob: [0, 0], pitch: [0, 0], roll: [0, 0, 0] },
  prompts: [{ at: [0, 0, 0], radius: 3, label: 'Board the land-sail' }, { at: [0, 0, 0], radius: 3, label: 'Leave the land-sail' }],
};
function sailRow(): MoverData[number] {
  const lowered = lowerMoverMotion({ trigger, driver: steer }, { at, euler });
  const [row] = parseMovers([{ id: 'land-sail', entity: 7, module: lowered.module, execution: 'native', kind: 'channel', at, euler,
    enabled: true, boxes: [], trigger, driver: steer, carry, input: lowered.input }]);
  if (row === undefined) throw new Error('Missing land-sail'); return row;
}
const level = { ...SIM_LEVEL, entities: [] }, row = sailRow();
function install(host: SimHost): MoverRuntime {
  const source = emptyShardfile({ slug: 'steer-test', name: 'Steer', author: 'Test', revision: 1, seed: 3 });
  return new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(),
    rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } }, { id: 'steer-test', drive: true });
}
const run = (host: SimHost, ticks: number, moveX: number, moveZ: number, boost = false): void => {
  for (let i = 0; i < ticks; i++) host.step(leadCommands(host, { moveX, moveZ, yaw: 0, ...(boost ? { boost: true as const } : {}) }));
};

test('a riderless land-sail stands; its rider boards, steers a curve, boosts and leaves (SS-MS2a1b)', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost(level, { rapier }), motion = install(host);
  try {
    run(host, 60, 0, -1); // a stick with no rider moves nothing
    expect(motion.pose(row.id).position).toEqual({ x: 0, y: 1, z: 0 });
    expect(motion.riding(row.id)).toBe(false);

    const [board, leave] = motion.ridePrompts();
    expect([board?.radius, leave?.radius]).toEqual([3, 0]); // free: only the board prompt shows
    motion.command(row.id, 1); run(host, 1, 0, 0);
    expect(motion.riding(row.id)).toBe(true); expect(motion.carrying()).toBe(true);
    expect([board?.radius, leave?.radius]).toEqual([0, 3]); // ridden: only the leave prompt shows
    run(host, 60, 0, -1); // forward is -z at heading 0
    expect(leave?.position.z).toBeCloseTo(motion.pose(row.id).position.z, 9); // the prompts ride with the vehicle
    const straight = motion.pose(row.id).position;
    expect(straight.z).toBeLessThan(-4); expect(Math.abs(straight.x)).toBeLessThan(1e-9); expect(straight.y).toBe(1);
    expect(leadPlayer(host).position.distanceTo({ x: straight.x, y: straight.y + carry.seat, z: straight.z } as never)).toBeLessThan(0.2);

    run(host, 60, 1, -1); // a right turn: the heading falls and the sail swings toward +x
    const turned = motion.pose(row.id);
    expect(turned.euler.y).toBeLessThan(-0.3); expect(turned.position.x).toBeGreaterThan(straight.x + 0.5);

    run(host, 45, 0, 0); // coast to a stand, then the same stick straight ahead, plain and boosted
    const a = motion.pose(row.id).position; run(host, 60, -Math.sin(turned.euler.y), -Math.cos(turned.euler.y)); const b = motion.pose(row.id).position;
    run(host, 60, 0, 0);
    const c = motion.pose(row.id).position, heading = motion.pose(row.id).euler.y;
    run(host, 60, -Math.sin(heading), -Math.cos(heading), true); const d = motion.pose(row.id).position;
    expect(Math.hypot(d.x - c.x, d.z - c.z)).toBeGreaterThan(Math.hypot(b.x - a.x, b.z - a.z) * 1.3); // boost goes further

    motion.command(row.id, 2); run(host, 1, 0, 0);
    expect(motion.riding(row.id)).toBe(false); expect(motion.carrying()).toBe(false);
    const left = motion.pose(row.id), cos = Math.cos(left.euler.y), sin = Math.sin(left.euler.y);
    const landing = { x: left.position.x + cos * 2, z: left.position.z - sin * 2 };
    expect(Math.hypot(leadPlayer(host).position.x - landing.x, leadPlayer(host).position.z - landing.z)).toBeLessThan(0.6);
    run(host, 60, 0, -1); const stood = motion.pose(row.id).position; run(host, 30, 0, -1);
    expect(motion.pose(row.id).position).toEqual(stood); // riderless again: it stands
  } finally { host.dispose(); }
});
