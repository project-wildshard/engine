// oxlint-disable-next-line import/no-nodejs-modules -- Runs the shipped physics.
import { readFileSync } from 'node:fs';
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { expect, test } from 'vitest';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { MoverScriptDriver } from '../src/server/game/plugin/mover';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// SHARD-SOURCE SS-GP5b (found by opus-ss5 on the way to SS-GP5): a rider whose page closed mid-ride held the lead seat for its
// 30 s hold, then the room cleared the seat and parked its body (`DedicatedRoom.clearLead`), but the land-sail stayed ridden by
// that seat. The next player to take the lead seat was carried at once. A parked rider is no rider: the vehicle is let go, as
// it is for a body that left the world.
const steer = { kind: 'steer', speed: 8, turn: 1, boost: 1.5, accel: 40, ground: false } as const;
const trigger = { kind: 'interact', permission: 0 } as const;
const at = { x: 0, y: 0, z: -3 }, euler = { x: 0, y: 0, z: 0 };
const carry = {
  seat: 0.8, landings: [[2, 0, 0], [-2, 0, 0]], yaw: 0,
  surface: { level: 0, bankRamp: 0, bob: [0, 0], pitch: [0, 0], roll: [0, 0, 0] },
  prompts: [{ at: [0, 1, 0], radius: 3.8, label: 'Board' }, { at: [0, 2, 0], radius: 2, label: 'Leave' }],
};
const lowered = lowerMoverMotion({ trigger, driver: steer }, { at, euler });
const [row] = parseMovers([{ id: 'salt.sail', entity: 7, module: lowered.module, execution: 'native', kind: 'channel', at, euler,
  enabled: true, boxes: [], trigger, driver: steer, carry, input: lowered.input }]);
const walk = (host: SimHost, ticks: number, moveZ: number): void => { for (let i = 0; i < ticks; i++) host.step(leadCommands(host, { moveX: 0, moveZ, yaw: 0 })); };

test('a parked lead seat rides nothing: the next lead is not carried off on its vehicle', async () => {
  if (row === undefined) throw new Error('Missing land-sail');
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  try {
    const source = emptyShardfile({ slug: 'parked-lead', name: 'Parked', author: 'Test', revision: 1, seed: 3 });
    const motion = new MoverScriptDriver([row], host).install(host, { content: source, assets: new Map(), rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } },
      { id: 'parked-lead', drive: true });
    motion.command(row.id, 1); walk(host, 1, 0);
    expect(motion.riding(row.id)).toBe(true);
    walk(host, 60, -1); // the rider sails off; then the page closes, and its hold runs out with no stick
    expect(motion.pose(row.id).position.z).toBeLessThan(at.z - 2);
    const lead = leadPlayer(host);
    lead.motor.setEnabled(false); host.parked.add(lead.id); // the room clears the lead seat: its body waits, parked
    walk(host, 30, 0);
    expect(motion.riding(row.id)).toBe(false);
    // the next player takes the lead seat and holds W on foot: the sail stands, and nobody is carried
    host.parked.delete(lead.id); lead.motor.setEnabled(true);
    const stood = motion.pose(row.id).position;
    walk(host, 60, -1);
    expect(motion.riding(row.id)).toBe(false);
    expect(motion.pose(row.id).position).toEqual(stood);
    expect(motion.carrying()).toBe(false);
  } finally { host.dispose(); }
});
