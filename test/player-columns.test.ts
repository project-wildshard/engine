// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { createSimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { bindPlayerColumns } from '../src/shared/game/shardfile/dataCreaturePorts';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3.10: a column of air lifts every player boarding through it, as it only ever lifted the lead, and a parked seat not at all.
const column = { id: 'updraft.test', kind: 'updraft', from: { x: 0, y: 0, z: -4 }, to: { x: 0, y: 20, z: 4 }, width: 6, margin: 0.5, lift: 30 } as const;

test('every boarder in a column rises, and neither one outside it nor one on foot does', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier });
  try {
    bindPlayerColumns(host, [column]);
    const lead = leadPlayer(host), inside = host.addPlayer('bot:in', { x: 1, y: 0, z: 1 }), outside = host.addPlayer('bot:out', { x: 12, y: 0, z: 12 }), walker = host.addPlayer('bot:walk', { x: -1, y: 0, z: 2 });
    lead.position.set(-1, 0, -1); lead.motor.resetAt(lead.position);
    for (const player of [lead, inside, outside]) player.board.on = true;
    for (let tick = 0; tick < 5; tick++) host.step();
    expect(lead.impulse.y).toBeGreaterThan(0); expect(inside.impulse.y).toBeGreaterThan(0);
    expect(outside.impulse.y).toBe(0); expect(walker.impulse.y).toBe(0);
    host.parked.add(inside.id); inside.impulse.set(0, 0, 0);
    for (let tick = 0; tick < 5; tick++) host.step();
    expect(inside.impulse.y).toBe(0);
  } finally { host.dispose(); }
});
