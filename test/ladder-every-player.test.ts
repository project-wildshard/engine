// oxlint-disable-next-line import/no-nodejs-modules -- Native traversal uses the shipped physics binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createSimHost } from '@wildshard/engine/sim';
import { loadRapier } from '@wildshard/engine/physics/rapier';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
import { installLadders } from '../src/shared/game/shardfile/ladder';
import type { LadderMode } from '@wildshard/format/modes';
import { SIM_LEVEL } from './fixtures/sim-level/level';

const y = SIM_LEVEL.ground.height;
const ladder: LadderMode = { id: 'yard.ladder', kind: 'ladder', bottom: { x: 6, y, z: 6 }, top: { x: 6, y: y + 4, z: 6 }, exit: { x: 6, y: y + 4, z: 5 }, normal: { x: 0, z: 1 }, reach: 1, speed: 2 };

test('a bot climbs on its own capsule while the first player stands, and the climb saves with it', async () => {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  try {
    installLadders(host, [ladder]);
    const lead = leadPlayer(host), bot = host.addPlayer('bot.climber', { x: 6, y, z: 6.2 }), adapter = host.adapters.get('modes.ladder');
    if (adapter === undefined) throw new Error('Missing ladder adapter');
    expect(adapter.snapshot()).not.toHaveProperty('others');
    host.step();
    expect(adapter.snapshot()).toHaveProperty(['others', bot.id, 'route'], null);
    const up = new Map([[bot.id, { moveX: 0, moveZ: -1, yaw: 0 }]]), standing = lead.position.y;
    for (let tick = 0; tick < 45; tick++) host.step(up);
    expect(bot.position.y).toBeGreaterThan(y + 1); expect(lead.position.y).toBeCloseTo(standing, 1);
    expect(bot.led).toBe(true); expect(lead.led).toBe(false); // the server climbs, and a client takes its word
    const saved = adapter.snapshot();
    expect(saved).toHaveProperty(['others', bot.id, 'route'], ladder.id); expect(saved).toHaveProperty('route', null);
    host.step(up); adapter.restore(saved); expect(adapter.snapshot()).toEqual(saved);
    host.removePlayer(bot.id); host.step(); expect(adapter.snapshot()).not.toHaveProperty('others');
  } finally { host.dispose(); }
});
