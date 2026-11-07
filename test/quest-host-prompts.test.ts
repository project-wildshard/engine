// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped native physics binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { installQuestHost } from '../src/server/game/plugin/simulation';
import { bindHeadlessPrompts, type HeadlessPrompt } from '../src/shared/game/quest/interactionRows';
import { parseQuestHost } from '@wildshard/format/questHost';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const quests = { flags: [], quests: [], triggers: [], dialogue: [] };
const declaration = parseQuestHost({ version: 1, drive: 'external', actors: { ids: [], error: 'Missing body' },
  graph: { actor: 'interact', step: 'quest.graph', actions: [] }, interactions: { marks: [], rows: [] }, npcs: [],
  observations: [], stages: [], summons: [], commands: { step: 'quest.commands', inputs: {}, routes: [
    { value: 1, spot: 'key', when: 'true', action: { kind: 'owner', id: 'key' } },
  ] } });

async function fixture() {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [], quests: [] }, { rapier });
  let deliveries = 0;
  const ports = { spots: { interact: [], crack: [] }, commands: () => [{ actorId: 'interact', value: 1 }],
    fact: () => undefined, coins: () => undefined, directorActions: new Map(), observations: new Map(),
    actions: new Map([['key', () => { deliveries++; }]]) };
  return { host, ports, deliveries: () => deliveries };
}

test('external routes borrow live prompt order, strict reach, weak priority and unhosted competitors', async () => {
  const { host, ports, deliveries } = await fixture();
  const at = { x: 0, y: 1.68, z: 2 }, live = { act: 1, position: at, radius: 4 };
  const competitor: HeadlessPrompt = { act: null, position: { x: 0, y: 1.68, z: 2 }, radius: 4 };
  const prompts = bindHeadlessPrompts([
    { id: null, position: competitor.position, radius: 4, sight: { slack: 0 } },
    { id: 'key', position: at, radius: 4, sight: { slack: 0 } },
  ], () => live);
  try {
    expect(prompts.map(prompt => prompt.id)).toEqual([null, 'key']);
    const graph = installQuestHost(host, quests, declaration, { ...ports, prompts });
    host.step(); expect(deliveries()).toBe(0); // The earlier unhosted prompt wins an exact tie.
    at.z = 1; host.step(); expect(deliveries()).toBe(1);
    live.radius = 0; host.step(); expect(deliveries()).toBe(1);
    live.radius = 4; at.z = 5; expect(graph.near('key')).toBe(false);
    at.z = 1; prompts[0] = { ...competitor, position: { x: 0, y: 1.68, z: 0.5 }, weak: true };
    host.step(); expect(deliveries()).toBe(2); // A strong prompt wins over the closer weak row.
    at.x = leadPlayer(host).position.x + 4; at.y = leadPlayer(host).position.y + 1.68; at.z = leadPlayer(host).position.z;
    expect(graph.near('key')).toBe(false); // Reach is strict, not inclusive.
    at.x = 0; at.z = 1;
    prompts.push({ id: 'key', act: 1, position: { x: 0, y: 1.68, z: 8 }, radius: 4 });
    expect(graph.near('key')).toBe(false); // Duplicate ids retain the old spot map's last registration.
    expect(() => graph.near('missing')).toThrow('Undeclared quest prompt');
  } finally { host.dispose(); }
});

test('external route sight uses the real collision world and the declared target owner', async () => {
  const { host, ports, deliveries } = await fixture();
  const owner = 'key-body', blocker = host.physics.world.createCollider(host.physics.R.ColliderDesc.cuboid(0.4, 0.4, 0.1).setTranslation(0, 1.68, 1));
  const prompts = bindHeadlessPrompts([{ id: 'key', position: { x: 0, y: 1.68, z: 2 }, radius: 4, sight: { slack: 0, body: owner } }],
    () => ({ act: 1, position: { x: 0, y: 1.68, z: 2 }, radius: 4 }));
  try {
    installQuestHost(host, quests, declaration, { ...ports, prompts });
    tagCollider(blocker, 'wood', 'wall'); host.step(); expect(deliveries()).toBe(0);
    tagCollider(blocker, 'wood', owner); host.step(); expect(deliveries()).toBe(1);
    blocker.setEnabled(false); host.step(); expect(deliveries()).toBe(2);
  } finally { host.dispose(); }
});

test('unbound and oversized live rosters refuse while the existing baked-spot route stays unchanged', async () => {
  const { host, ports, deliveries } = await fixture();
  const prompt: HeadlessPrompt = { id: 'key', act: 1, position: { x: 0, y: 1.68, z: 1 }, radius: 4 };
  try {
    expect(() => installQuestHost(host, quests, declaration, { ...ports, prompts: [] })).toThrow('Undeclared quest spot');
    expect(() => installQuestHost(host, quests, declaration, { ...ports, prompts: Array.from({ length: 1025 }, () => prompt) })).toThrow('finite bound');
    installQuestHost(host, quests, declaration, { ...ports, spots: { interact: [{ id: 'key', ...prompt.position, radius: prompt.radius }], crack: [] } });
    host.step(); expect(deliveries()).toBe(1);
  } finally { host.dispose(); }
});
