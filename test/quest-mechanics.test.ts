// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native physics binary.
import { lowerMoverMotion } from '@wildshard/format/moverMotion';
import { parseMovers } from '@wildshard/format/movers';
import { parseQuestHost } from '@wildshard/format/questHost';
import { readFileSync } from 'node:fs';
import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { MoverScriptDriver } from '../src/server/game/plugin/mover';
import { installQuestHost } from '../src/server/game/plugin/simulation';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { emptyShardfile } from '../src/shared/host/author';
import { SIM_LEVEL } from './fixtures/sim-level/level';


const base = { version: 1, drive: 'external', actors: { ids: [], error: 'Missing body' },
  graph: { actor: 'interact', step: 'graph', actions: [] }, interactions: { marks: [], rows: [] }, npcs: [],
  observations: [], stages: [], summons: [], commands: { step: 'commands', inputs: {}, routes: [] } };
const quests = { flags: ['ready', 'done'], quests: [], triggers: [], dialogue: [] };
async function fixture() {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  return createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
}
const ports = { spots: { interact: [{ id: 'control', x: 0, y: 1.68, z: 1, radius: 4 }], crack: [] },
  fact: () => undefined, coins: () => undefined };


test('mover rows queue on the existing driver and observe its committed endpoint', async () => {
  const host = await fixture();
  const rest = { at: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 } };
  const motion = { driver: { kind: 'track' }, trigger: { kind: 'interact', permission: 0 },
    track: { clip: 'raise', duration: 0.1, loop: 'once', speed: 1, times: [0, 0.1], position: [[0, 0, 0], [0, 1, 0]] } };
  const rows = parseMovers([{ id: 'bridge', entity: 1, kind: 'channel', ...rest, boxes: [], enabled: true,
    ...lowerMoverMotion(motion, rest), ...motion, execution: 'native', atEnd: { field: 5, equals: 1 } }]);
  const row = rows[0]; if (row === undefined) throw new Error('Missing mover fixture');
  try {
    const source = emptyShardfile({ slug: 'quest-mover', name: 'Quest mover', author: 'Test', revision: 1, seed: 1 });
    const runtime = new MoverScriptDriver(rows, host).install(host, { content: source, assets: new Map(), rules: { fields: {}, archetypes: [], events: [], maxEntities: 32 } }, { id: 'move', drive: true });
    let command = 1;
    const declaration = parseQuestHost({ ...base, observations: [{ binding: 'event:end', kind: 'mover', mover: 'bridge', state: 'at-end' }],
      commands: { ...base.commands, inputs: { end: 'event:end' }, routes: [
        { value: 1, spot: 'control', when: '!end', action: { kind: 'mover', mover: 'bridge', command: 1 } },
        { value: 2, spot: 'control', when: 'end', action: { kind: 'flag', flag: 'done', value: true } },
      ] } });
    installQuestHost(host, quests, declaration, { ...ports, mechanics: { motion: runtime }, commands: () => [{ actorId: 'interact', value: command }] });
    host.step(); expect(runtime.atEnd('bridge')).toBe(false);
    command = 2;
    for (let frame = 0; frame < 12; frame++) host.step();
    expect(runtime.atEnd('bridge')).toBe(true); expect(host.flags.has('done')).toBe(true);
    expect(runtime.pose('bridge').position.y).toBeCloseTo(1, 12);
  } finally { host.dispose(); }
}, 10_000);
