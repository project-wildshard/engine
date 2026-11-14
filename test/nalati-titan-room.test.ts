// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test } from 'vitest';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { shardRows } from '../src/shared/engine/sim/shardRows';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { openArenaOf } from '../src/server/game/boss/openArenaNative';
import { patrolOf } from '../src/server/game/boss/patrolNative';
import { arenaTieWord } from '../src/shared/game/boss/arenaAnswers';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { netInteractCommands } from '../src/shared/host/standalone/netInput';
import { builtFolder } from './fixtures/builtFolder';

// The Storm Titan from Nalati's product, for a room. A tape's resident has no such fight, so its saves keep their adapters.
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });
async function nalati(room: boolean): Promise<TrustedHeadlessResident> {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product }, undefined, { room });
}

test('a tape\'s world has no room Titan', async () => {
  const live = await nalati(false);
  expect(openArenaOf(live.host)).toBeUndefined();
  expect(patrolOf(live.host)).toBeUndefined();
  expect(live.host.adapters.has('nalati.titan')).toBe(false);
  live.dispose();
});

test('a room runs the Titan and the patrol from the product, and a save holds them', async () => {
  const live = await nalati(true), { host } = live, arena = openArenaOf(host);
  if (arena === undefined) throw new Error('No room arena');
  expect(patrolOf(host)).toBeDefined();
  expect(host.adapters.has('nalati.titan')).toBe(true);
  host.addPlayer('bot:1');
  for (let tick = 0; tick < 120; tick++) live.step([]);
  expect(arena.boss.state).toBe('dormant');
  const saved = snapshotSimHost(host);
  expect(saved.adapters.some(row => row.id === 'nalati.titan')).toBe(true);
  live.dispose();
}, 120_000);

test('each earner takes the heart\'s reward, once, and it stands until the last has', async () => {
  const live = await nalati(true), { host } = live, arena = openArenaOf(host);
  if (arena === undefined) throw new Error('No room arena');
  const [lead] = host.players.values(), bot = host.addPlayer('bot:1');
  if (lead === undefined) throw new Error('No lead');
  for (let tick = 0; tick < 2; tick++) live.step([]);
  // Bring the fight to its last blow, and fell the heart as a held weapon does.
  const { boss, fight } = arena;
  boss.restore({ ...boss.snapshot(), state: 'fight', phase: 2, checkpoint: 2 });
  const state = fight.snapshot();
  fight.restore({ ...state, life: { ...state.life, state: { ...state.life.state, hp: 0 } } }, () => null);
  const center = fight.rewardPoint(), y = host.groundHeightAt(center.x, center.z) + 0.2;
  for (const player of [lead, bot]) player.resetPose({ x: center.x, y, z: center.z }, 0);
  for (let tick = 0; tick < 1200 && !arena.reward(); tick++) live.step([]);
  expect(arena.reward()).toBe(true);
  const point = arena.rewardPrompt()?.position;
  if (point === undefined) throw new Error('No reward stands');
  for (const player of [lead, bot]) player.resetPose({ x: point.x, y: host.groundHeightAt(point.x, point.z) + 0.2, z: point.z + 1 }, 0);
  const take = (player: string): string[] => {
    const acts = [{ kind: 'interact' as const, seq: 1, id: 'nalati.titan.reward' }];
    live.step(netInteractCommands(actRoutes(host), acts, player));
    return live.effects.flatMap(effect => effect.kind === 'item' ? [`${effect.actorId}:${effect.item}`] : []);
  };
  expect(take(bot.id)).toEqual(['bot:1:naizagai', 'bot:1:sky-marked-saddle']);
  expect(take(bot.id), 'a share is taken once').toEqual([]);
  expect(arena.reward(), 'it stands for the other earner').toBe(true);
  expect(take(lead.id)).toEqual([`${lead.id}:naizagai`, `${lead.id}:sky-marked-saddle`]);
  expect(arena.reward()).toBe(false);
  expect(boss.snapshot().saved.rewardTaken || arena.records.bosses.read()[boss.def.id]?.rewardTaken).toBe(true);
  live.dispose();
}, 120_000);

test('a paid Titan stays paid: his fall lays no heart\'s reward out, and pays nothing', async () => {
  const live = await nalati(true), { host } = live, arena = openArenaOf(host);
  if (arena === undefined) throw new Error('No room arena');
  const [lead] = host.players.values();
  if (lead === undefined) throw new Error('No lead');
  try {
    for (let tick = 0; tick < 2; tick++) live.step([]);
    const { boss, fight } = arena;
    boss.restore({ ...boss.snapshot(), state: 'fight', phase: 2, checkpoint: 2, saved: { defeated: true, rewardTaken: true, kills: 1 } });
    const state = fight.snapshot();
    fight.restore({ ...state, life: { ...state.life, state: { ...state.life.state, hp: 0 } } }, () => null);
    const center = fight.rewardPoint();
    lead.resetPose({ x: center.x, y: host.groundHeightAt(center.x, center.z) + 0.2, z: center.z }, 0);
    for (let tick = 0; tick < 1200 && boss.state !== 'victory'; tick++) live.step([]);
    expect(boss.state).toBe('victory');
    for (let tick = 0; tick < 60; tick++) live.step([]);
    expect(arena.reward()).toBe(false); expect(boss.rewardTaken).toBe(true);
    expect(live.effects.filter(effect => effect.kind === 'item')).toEqual([]);
  } finally { live.dispose(); }
}, 120_000);

// N9: the law has its own test (`arena-answers`), and `worker-client-fights` rides and ties him in a browser. This is the press a page sends,
// by the id it sends, on the real room.
test('a press at the cairn reaches the tie\'s law and the page hears its line, and a press from afar does nothing', async () => {
  const live = await nalati(true), { host } = live, arena = openArenaOf(host);
  if (arena === undefined) throw new Error('No room arena');
  const [lead] = host.players.values();
  if (lead === undefined) throw new Error('No lead');
  const lines: number[] = [], heard = shardRows(host).calls, push = heard.push.bind(heard), { boss, fight } = arena, word = arenaTieWord(boss.def.id);
  heard.push = (...calls) => { for (const call of calls) if (call.name === word) lines.push(call.args[0] ?? -1); return push(...calls); };
  const press = (): void => { live.step(netInteractCommands(actRoutes(host), [{ kind: 'interact' as const, seq: 1, id: `${boss.def.id}.tie` }], lead.id)); };
  const reach = (): number => { const out = new Map<string, number>(); for (const read of shardRows(host).owned.values()) read(lead.id, out); return (out.get(OWNED_ROW.tie) ?? 0) / 1000; };
  const stand = (x: number, z: number): void => { lead.resetPose({ x, y: host.groundHeightAt(x, z) + 0.2, z }, 0); };
  const anchor = fight.cairnSpot();
  try {
    for (let tick = 0; tick < 120; tick++) { stand(anchor.x + 1, anchor.z); live.step([]); }
    expect(reach(), 'the cairn offers its prompt').toBeGreaterThan(0);
    stand(anchor.x + 400, anchor.z); press();
    expect(fight.tied).toBe(false); expect(lines).toEqual([]);
    for (let tick = 0; tick < 4; tick++) { stand(anchor.x + 1, anchor.z); live.step([]); }
    press();
    expect(lines, 'on foot: the law\'s first line, and no tie').toEqual([0]);
    expect(fight.tied).toBe(false); expect(boss.state).toBe('dormant');
  } finally { live.dispose(); }
}, 120_000);
