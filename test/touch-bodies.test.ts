// oxlint-disable-next-line import/no-nodejs-modules -- Exercise actual shipped native physics and restored handles.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { installTouchBodies, type TouchBodyRow } from '../src/server/game/shardfile/touchBodies';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost, type SimHost } from '../src/server/engine/sim';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { installKitWorldFixture } from './fixtures/kit-world';

await installKitWorldFixture();

// meta SHARD-SOURCE SS9b: a data shard's touchable panel is one Rapier dynamic body in the host's world. A walking player
// pushes it, its pose rides the wire as the row's script body, and a save and restore put it back where it was.
const LEVEL = { ...SIM_LEVEL, entities: [], quests: [] };
const crate = (x: number, z: number): TouchBodyRow => ({ id: 'yard.crate', panel: 'crate', at: { x, y: 0.4, z }, yaw: 0,
  shape: { cuboid: { x: 0.4, y: 0.4, z: 0.4 } }, material: 'wood', density: 150 });
const walk = (host: SimHost, ticks: number, moveZ = 1): void => {
  for (let i = 0; i < ticks; i++) host.step(new Map([...host.players.keys()].map(id => [id, { moveX: 0, moveZ, yaw: 0 }])));
};
const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));

test('a walking player pushes the crate, and the wire carries its pose', () => {
  const host = createSimHost(LEVEL, { rapier });
  try {
    // which way the player walks: a few ticks from the origin
    const lead = [...host.players.values()][0]; if (lead === undefined) throw new Error('no player');
    walk(host, 10);
    const from = { x: lead.position.x, z: lead.position.z }, length = Math.hypot(from.x, from.z);
    const ahead = { x: from.x / length, z: from.z / length };
    const touch = installTouchBodies(host, [crate(from.x + ahead.x * 2.5, from.z + ahead.z * 2.5)]);
    if (touch === null) throw new Error('no bodies');
    walk(host, 30, 0); // let it settle on the ground
    const rest = touch.body('yard.crate')?.rb.translation(); if (rest === undefined) throw new Error('no crate');
    expect(rest.y).toBeLessThan(0.45);
    walk(host, 120);
    const moved = touch.body('yard.crate')?.rb.translation(); if (moved === undefined) throw new Error('no crate');
    const pushed = (moved.x - rest.x) * ahead.x + (moved.z - rest.z) * ahead.z;
    expect(pushed).toBeGreaterThan(0.5);
    const wire = shardRows(host).bodies.get('script:yard.crate')?.();
    expect(wire?.enabled).toBe(true);
    expect(wire?.position.x).toBeCloseTo(moved.x, 5); expect(wire?.position.z).toBeCloseTo(moved.z, 5);
  } finally { host.dispose(); }
});

test('a save and restore put the crate back where it was, and it goes on as it would have', () => {
  const host = createSimHost(LEVEL, { rapier }), rows = [crate(0.3, 1.2)];
  try {
    installTouchBodies(host, rows);
    walk(host, 40); // bump it about
    const saved = snapshotSimHost(host);
    const restored = restoreSimHost(LEVEL, { rapier }, saved, fresh => { installTouchBodies(fresh, rows, true); });
    try {
      const a = shardRows(host).bodies.get('script:yard.crate')?.(), b = shardRows(restored).bodies.get('script:yard.crate')?.();
      expect(b).toEqual(a);
      walk(host, 30); walk(restored, 30);
      expect(shardRows(restored).bodies.get('script:yard.crate')?.()).toEqual(shardRows(host).bodies.get('script:yard.crate')?.());
    } finally { restored.dispose(); }
  } finally { host.dispose(); }
});

test('a duplicate id refuses, and no rows install nothing', () => {
  const host = createSimHost(LEVEL, { rapier });
  try {
    expect(installTouchBodies(host, [])).toBeNull();
    expect(() => installTouchBodies(host, [crate(1, 1), crate(2, 2)])).toThrow('Duplicate touchable body id');
  } finally { host.dispose(); }
});
