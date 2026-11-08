// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped Pine product and worker bridge.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { afterEach, beforeAll, beforeEach, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { directLoopback } from '../src/test/engine/netLoopback';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { Scope } from '../src/shared/engine/app/scope';
import { installSaveEnvironment, saveEnvironment } from '../src/shared/engine/saves/environment';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { CompendiumState } from '../src/shared/game/compendium/state';
import { declaredProductCompendium } from '../src/shared/game/shard/declaredRows';
import { SkinLocker } from '../src/client/game/cosmetics/locker';
import { WirePage } from '../src/client/game/shardfile/wirePage';
import { compendiumSave, skinSave, finishPickupSave, creatureRewardSave, syncPageRewards } from '../src/shared/game/saves';
import { populationRoster } from '../src/server/game/population/roster';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone } from '../src/client/host/standalone/shell';
import { importPageSaves } from '../src/client/engine/saves/indexed';
import { bakedGridCollision } from './fixtures/gridCollision';
import { builtProduct } from './fixtures/builtProduct';

const PREFIX = 'wildshard.save.v2.', KEY = `${PREFIX}pine-hollow`;
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
let input: HeadlessRuntimeInput, rosterStep: string;
const opened = new Set<() => void>();
let inheritedEnvironment: ReturnType<typeof saveEnvironment> | undefined;
beforeEach(() => { inheritedEnvironment = saveEnvironment(); });
afterEach(() => {
  for (const close of [...opened]) close();
  if (inheritedEnvironment !== undefined) installSaveEnvironment(inheritedEnvironment);
});
beforeAll(async () => {
  const directory = process.env['PINE_PROOF_PRODUCT'] ?? builtProduct('pine-hollow'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing Pine output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  input = { product, shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
  rosterStep = (await product.json('actors/roster.json') as { step: string }).step;
});
// The first grid case otherwise owns the cold road bake inside its gameplay
// deadline. Prepare that same real fixture once; reward case clocks stay put.
beforeAll(async () => {
  const started = performance.now(), strips = await bakedGridCollision();
  console.info(`Pine grid fixture: ${strips.length} real strips prepared in ${(performance.now() - started).toFixed(0)} ms`);
}, 60_000);
async function boot(storage: PageStorage, lone?: true, identity?: string, refused?: (error: unknown) => void) {
  const control = new MessageChannel(), game = new MessageChannel();
  let grid: StandaloneGrid | undefined;
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input), strips: bakedGridCollision,
    onSaveRefused: refused ?? (error => { throw error; }), proof: { booted: value => { grid = value; } } });
  const shell = connectStandalone({ slug: 'pine-hollow', base: '/shards/pine-hollow/', build: 'test', savePrefix: PREFIX, storage, ...(identity === undefined ? {} : { identity: { player: identity, name: identity } }), ...(lone === undefined ? {} : { lone }) }, control.port2, game.port2, () => { server.dispose(); });
  const close = () => { if (opened.delete(close)) shell.dispose(); };
  opened.add(close);
  const booted = await shell.booted;
  if (grid === undefined) throw new Error('No worker world');
  return { shell, grid, booted, close };
}
function onPage<T>(storage: PageStorage, run: () => T): T {
  const worker = saveEnvironment();
  installSaveEnvironment({ storage: () => storage, persistent: () => true, persist: () => Promise.resolve(true) });
  try { return run(); } finally { installSaveEnvironment(worker); }
}
function kill(grid: StandaloneGrid, player: string) {
  const body = populationRoster(grid.host, rosterStep).spawn('deer', 5, -225, 0, 'ghost'), source = grid.host.players.get(player);
  if (source === undefined) throw new Error('No killer');
  expect(grid.host.combat.hit({ source: source.health, sourceTags: ['actor.player', 'cover.checked'], target: body.combatActor(), amount: body.maxHp * 10,
    point: body.position.clone(), dir: new Vector3(0, 0, 1) })?.killed).toBe(true);
}
const turn = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });
async function copyPage(page: PageStorage, worker: PageStorage): Promise<void> {
  const target = { storage: worker, write: (key: string, value: string | null) => { if (value === null) worker.removeItem(key); else worker.setItem(key, value); return Promise.resolve(true); } };
  await importPageSaves(target, page, PREFIX); await syncPageRewards(target, page, PREFIX);
}

test('a malformed historical reward book falls back before the player is welcomed', async () => {
  const worker = new PageStorage(), first = await boot(worker, true);
  try {
    await turn(); first.grid.open(); first.grid.tick(); first.grid.tick(); await turn();
    expect((await first.shell.save()).ok).toBe(true);
    first.grid.host.slots.questState['owned.creature-rewards'] = { 'actor.player': 1 };
    first.grid.tick(); first.grid.tick();
    expect((await first.shell.save()).ok).toBe(true);
  } finally { first.close(); }
  const rejected: unknown[] = [], again = await boot(worker, true, undefined, error => { rejected.push(error); });
  try {
    expect(rejected, 'an invalid historical row must be refused during world loading').toHaveLength(1);
    await turn(); again.grid.open(); again.grid.tick(); again.grid.tick(); await turn();
    expect(again.booted.restored).toBe(true);
    expect(again.shell.client.closed).toBeNull();
  } finally { again.close(); }
});

test('a historical seat-keyed continuation migrates only its local lead to a device profile', async () => {
  const worker = new PageStorage(), first = await boot(worker, true, 'device-a');
  const historical = { finishes: ['ghost-stag'], pending: { 'ghost-stag': { x: 5, y: 0, z: -225 }, ironhide: { x: 8, y: 0, z: -220 } },
    journal: { 'ghost-stag': { s: 3, n: 5, t: 7, b: 500 } } };
  try {
    // The previous release kept this book in the world; no new player record has been published yet.
    first.grid.host.slots.questState['owned.creature-rewards'] = { 'actor.player': historical, 'seat-b': historical };
    expect((await first.shell.save()).ok).toBe(true);
  } finally { first.close(); }
  const again = await boot(worker, true, 'device-a'), link = directLoopback(), bot = new NetClient(link.client);
  try {
    await turn(); again.grid.open(); again.grid.tick(); again.grid.tick(); await turn();
    expect(again.booted.restored).toBe(true);
    expect(again.shell.client.owned.get('finish.ghost-stag')).toBe(1);
    expect(again.shell.client.owned.get('finish-drop.ironhide')).toBe(1);
    expect(again.shell.client.owned.has('finish-drop.ghost-stag')).toBe(false);
    expect(again.shell.client.owned.get('journal.ghost-stag.taken')).toBe(8);
    again.grid.join({ join: 'seat-b', x: 5, y: 0, z: -225 }, link.server);
    bot.hello('test', { player: 'device-b', name: 'B' }); link.pump(); again.grid.tick(); again.grid.tick(); link.pump();
    expect(bot.owned.has('finish.ghost-stag'), 'an old seat row cannot prove the current occupant owned it').toBe(false);
    expect(bot.owned.has('journal.ghost-stag.taken')).toBe(false);
  } finally { bot.dispose(); again.close(); }
});

test('device rewards survive an empty world and follow the owner into another seat', async () => {
  const worker = new PageStorage();
  worker.setItem(KEY, JSON.stringify({ keys: { skins: { v: 1, data: { owned: ['ghost-stag'], worn: {} } }, compendium: { v: 1, data: { 'ghost-stag': { s: 3, n: 4, t: 8, b: 400 } } } } }));
  const first = await boot(worker, true, 'device-a');
  try {
    await turn(); first.grid.open(); first.grid.tick(); first.grid.tick(); await turn();
    expect(first.shell.client.owned.get('finish.ghost-stag')).toBe(1);
    expect(first.shell.client.owned.get('journal.ghost-stag.taken')).toBe(9);
  } finally { first.close(); }
  // No continuation was saved: E7 also opens empty worlds, and its lead seat can be reused.
  const next = await boot(worker, true, 'device-b'), link = directLoopback(), returning = new NetClient(link.client);
  try {
    await turn(); next.grid.open(); next.grid.tick(); next.grid.tick(); await turn();
    expect(next.shell.client.owned.has('finish.ghost-stag'), 'B cannot inherit A’s former lead seat').toBe(false);
    expect(next.shell.client.owned.has('journal.ghost-stag.taken')).toBe(false);
    next.grid.join({ join: 'seat-return', x: 5, y: 0, z: -225 }, link.server);
    returning.hello('test', { player: 'device-a', name: 'A' }); link.pump(); next.grid.tick(); next.grid.tick(); link.pump();
    expect(returning.owned.get('finish.ghost-stag')).toBe(1);
    expect(returning.owned.get('journal.ghost-stag.taken')).toBe(9);
    kill(next.grid, 'actor.player'); next.grid.tick(); next.grid.tick(); await turn(); link.pump();
    expect(next.shell.client.owned.get('finish-drop.ghost-stag')).toBe(1);
    expect(returning.owned.has('finish-drop.ghost-stag')).toBe(false);
    expect(returning.owned.get('journal.ghost-stag.taken')).toBe(9);
    expect(onPage(worker, () => compendiumSave.read('pine-hollow')['ghost-stag']?.t), 'B must not overwrite A’s legacy document').toBe(8);
  } finally { returning.dispose(); next.close(); }
});

test('J105 pays meaningful contributors, including when a tiny last hit comes from someone else', async () => {
  const worker = new PageStorage(), first = await boot(worker), a = directLoopback(), b = directLoopback(), ca = new NetClient(a.client), cb = new NetClient(b.client);
  try {
    for (const [id, link, client] of [['pine-a', a, ca], ['pine-b', b, cb]] as const) {
      first.grid.join({ join: id, x: 5, y: 0, z: -225 }, link.server); client.hello('test', { player: id, name: id }); link.pump();
    }
    first.grid.open();
    let body = populationRoster(first.grid.host, rosterStep).spawn('deer', 5, -225, 0, 'ghost');
    const hit = (id: string, amount: number) => {
      const source = first.grid.host.players.get(id); if (source === undefined) throw new Error('No hitter');
      return first.grid.host.combat.hit({ source: source.health, sourceTags: ['actor.player', 'cover.checked', 'dmg.legacy'], target: body.combatActor(), amount,
        point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    };
    hit('pine-a', body.maxHp * 0.99); first.grid.tick();
    expect(body.alive).toBe(true);
    expect(hit('pine-b', body.maxHp * 0.02)?.killed).toBe(true);
    first.grid.tick(); first.grid.tick(); a.pump(); b.pump();
    expect(ca.owned.get('journal.ghost-stag.taken'), 'A earned the kill').toBe(2);
    expect(ca.owned.get('finish-drop.ghost-stag')).toBe(1);
    expect(cb.owned.has('journal.ghost-stag.taken'), 'a tiny final blow does not meet J105').toBe(false);
    const lines = ca.owned, x = lines.get('finish-drop.ghost-stag.x') ?? 0, y = lines.get('finish-drop.ghost-stag.y') ?? 0, z = lines.get('finish-drop.ghost-stag.z') ?? 0;
    first.grid.place({ x, y, z, yaw: 0 }, 'pine-a'); ca.act({ kind: 'interact', seq: 0, id: 'finish.claim.ghost-stag' }); a.pump();
    first.grid.tick(); first.grid.tick(); a.pump();
    expect(ca.owned.get('finish.ghost-stag')).toBe(1);
    first.grid.place({ x: 80, y, z, yaw: 0 }, 'pine-b');
    body = populationRoster(first.grid.host, rosterStep).spawn('deer', 5, -225, 0, 'ghost');
    hit('pine-a', body.maxHp * 0.5); first.grid.tick();
    expect(hit('pine-b', body.maxHp * 0.51)?.killed).toBe(true);
    first.grid.tick(); first.grid.tick(); a.pump(); b.pump();
    expect(ca.owned.get('journal.ghost-stag.taken')).toBe(3);
    expect(cb.owned.get('journal.ghost-stag.taken'), 'both meaningful contributors earn their own progress').toBe(2);
    expect(cb.owned.get('finish-drop.ghost-stag')).toBe(1);
    expect(cb.owned.get('finish-drop.ghost-stag.x'), 'Pine’s declared drop stays at its source, not the lead').toBeCloseTo(body.position.x);
    expect(ca.owned.has('finish-drop.ghost-stag'), 'owned finishes cannot drop again').toBe(false);
    expect((await first.shell.save()).ok).toBe(true);
    expect(onPage(worker, () => creatureRewardSave.read('pine-hollow').players['pine-a']?.pending['ghost-stag'])).toBeUndefined();
  } finally { ca.dispose(); cb.dispose(); first.close(); }
});

test('two stores merge later page progress, clean owned pending drops and keep non-lead writes private', async () => {
  const page = new PageStorage(), worker = new PageStorage();
  page.setItem(KEY, JSON.stringify({ keys: { skins: { v: 1, data: { owned: ['scarback-furnace'], worn: {} } },
    compendium: { v: 1, data: { 'ghost-stag': { s: 3, n: 1, t: 1, b: 200 } } } } }));
  await copyPage(page, worker);
  const first = await boot(worker, true, 'device-a');
  try { await turn(); first.grid.open(); first.grid.tick(); first.grid.tick(); await turn(); }
  finally { first.close(); }
  onPage(page, () => {
    skinSave.write({ owned: ['scarback-furnace', 'ghost-stag'], worn: { crossbow: 'ghost-stag' } }, 'pine-hollow');
    compendiumSave.write({ 'ghost-stag': { s: 3, n: 9, t: 12, b: 600 } }, 'pine-hollow');
  });
  onPage(worker, () => { finishPickupSave.write({ 'ghost-stag': { x: 5, y: 0, z: -225 }, ironhide: { x: 8, y: 0, z: -220 } }, 'pine-hollow'); });
  await copyPage(page, worker);
  const next = await boot(worker, true, 'device-a'), link = directLoopback(), bot = new NetClient(link.client);
  try {
    await turn(); next.grid.open(); next.grid.tick(); next.grid.tick(); await turn();
    expect(next.shell.client.owned.get('finish.ghost-stag')).toBe(1);
    expect(next.shell.client.owned.get('journal.ghost-stag.taken')).toBe(13);
    expect(next.shell.client.owned.has('finish-drop.ghost-stag')).toBe(false);
    expect(next.shell.client.owned.get('finish-drop.ironhide'), 'later legacy pending rewards merge too').toBe(1);
    expect((await next.shell.save()).ok).toBe(true);
    expect(onPage(worker, () => creatureRewardSave.read('pine-hollow').players['device-a']?.pending['ghost-stag']), 'exports must not retain owned pending rewards').toBeUndefined();
    const legacy = onPage(worker, () => ({ skins: skinSave.read('pine-hollow'), journal: compendiumSave.read('pine-hollow'), pending: finishPickupSave.read('pine-hollow') }));
    next.grid.join({ join: 'seat-b', x: 100, y: 0, z: -225 }, link.server);
    bot.hello('test', { player: 'device-b', name: 'B' }); link.pump(); next.grid.tick(); next.grid.tick(); link.pump();
    expect(bot.owned.has('finish.ghost-stag'), 'a non-empty legacy save is never inherited by another device').toBe(false);
    expect(bot.owned.has('journal.ghost-stag.taken')).toBe(false);
    expect(bot.owned.has('finish-drop.ironhide')).toBe(false);
    kill(next.grid, 'seat-b'); next.grid.tick(); next.grid.tick(); link.pump();
    expect(bot.owned.get('journal.ghost-stag.taken')).toBe(2);
    const x = bot.owned.get('finish-drop.ghost-stag.x') ?? 0, y = bot.owned.get('finish-drop.ghost-stag.y') ?? 0, z = bot.owned.get('finish-drop.ghost-stag.z') ?? 0;
    next.grid.place({ x: x + 10, y, z, yaw: 0 }, 'seat-b');
    bot.act({ kind: 'interact', seq: 0, id: 'finish.claim.ghost-stag' }); link.pump(); next.grid.tick(); next.grid.tick(); link.pump();
    expect(bot.owned.has('finish.ghost-stag'), 'distant claims fail').toBe(false);
    next.grid.place({ x, y, z, yaw: 0 }, 'seat-b');
    bot.act({ kind: 'interact', seq: 0, id: 'finish.claim.ghost-stag' }); link.pump(); next.grid.tick(); next.grid.tick(); link.pump();
    expect(bot.owned.get('finish.ghost-stag')).toBe(1);
    expect((await next.shell.save()).ok).toBe(true);
    expect(onPage(worker, () => ({ skins: skinSave.read('pine-hollow'), journal: compendiumSave.read('pine-hollow'), pending: finishPickupSave.read('pine-hollow') }))).toEqual(legacy);
  } finally { bot.dispose(); next.close(); }
});

test('a lower real server frame cannot rewind the page journal', async () => {
  const page = new PageStorage(), worker = new PageStorage();
  onPage(page, () => { compendiumSave.write({ 'ghost-stag': { s: 3, n: 9, t: 10, b: 900 } }, 'pine-hollow'); });
  onPage(worker, () => { compendiumSave.write({ 'ghost-stag': { s: 3, n: 1, t: 3, b: 200 } }, 'pine-hollow'); });
  const first = await boot(worker, true), scope = new Scope('pine.old-frame'), wire = new WirePage();
  const journal = onPage(page, () => {
    if (input.product === undefined) throw new Error('Missing product');
    return new CompendiumState(declaredProductCompendium(input.product, input.shard.rows.compendiums[0]?.id ?? ''));
  });
  try {
    wire.bind(first.shell.client, () => undefined, () => undefined, () => false); wire.hold({ journal }, scope);
    await turn(); first.grid.open(); first.grid.tick(); first.grid.tick(); await turn();
    expect(first.shell.client.owned.get('journal.ghost-stag.taken')).toBe(4);
    onPage(page, () => { wire.frame('pine-hollow', true); });
    expect(journal.stats('ghost-stag')).toMatchObject({ taken: 10, best: 900, seen: 9 });
    expect(onPage(page, () => compendiumSave.read('pine-hollow')['ghost-stag'])).toMatchObject({ t: 10, b: 900, n: 9 });
  } finally { scope.dispose(); first.close(); }
});

test('two stores keep a kill and claim after the worker crashes without another continuation save', async () => {
  const page = new PageStorage(), worker = new PageStorage();
  page.setItem(KEY, JSON.stringify({ keys: { compendium: { v: 1, data: { 'ghost-stag': { s: 3, n: 7, t: 1, b: 200 } } } } }));
  await copyPage(page, worker);
  const first = await boot(worker, true), wire = new WirePage(), scope = new Scope('pine.two-stores');
  const journal = onPage(page, () => {
    if (input.product === undefined) throw new Error('Missing product');
    return new CompendiumState(declaredProductCompendium(input.product, input.shard.rows.compendiums[0]?.id ?? ''));
  });
  wire.bind(first.shell.client, () => undefined, () => undefined, () => false); wire.hold({ journal }, scope);
  try {
    await turn(); first.grid.open(); first.grid.tick(); first.grid.tick(); await turn();
    expect((await first.shell.save()).ok).toBe(true);
    kill(first.grid, 'actor.player'); first.grid.tick(); first.grid.tick(); await turn();
    onPage(page, () => { wire.frame('pine-hollow', true); });
    const lines = first.shell.client.owned, x = lines.get('finish-drop.ghost-stag.x') ?? 0, y = lines.get('finish-drop.ghost-stag.y') ?? 0, z = lines.get('finish-drop.ghost-stag.z') ?? 0;
    first.grid.place({ x, y, z, yaw: 0 }); first.shell.client.act({ kind: 'interact', seq: 0, id: 'finish.claim.ghost-stag' });
    await turn(); first.grid.tick(); first.grid.tick(); await turn();
    expect(first.shell.client.owned.get('finish.ghost-stag')).toBe(1);
    expect(journal.stats('ghost-stag').taken).toBe(2);
  } finally { scope.dispose(); first.close(); }
  await copyPage(page, worker); // The production import is once only.
  const again = await boot(worker, true);
  try {
    await turn(); again.grid.open(); again.grid.tick(); again.grid.tick(); await turn();
    expect(again.shell.client.owned.get('journal.ghost-stag.taken')).toBe(3);
    expect(again.shell.client.owned.get('finish.ghost-stag')).toBe(1);
    expect(again.shell.client.owned.has('finish-drop.ghost-stag')).toBe(false);
  } finally { again.close(); }
});

test('a drop earned after the last continuation survives a worker crash', async () => {
  const worker = new PageStorage(), first = await boot(worker, true);
  try {
    await turn(); first.grid.open(); first.grid.tick(); first.grid.tick(); await turn();
    expect((await first.shell.save()).ok).toBe(true);
    kill(first.grid, 'actor.player'); first.grid.tick(); first.grid.tick(); await turn();
    expect(first.shell.client.owned.get('finish-drop.ghost-stag')).toBe(1);
  } finally { first.close(); }
  const again = await boot(worker, true);
  try {
    await turn(); again.grid.open(); again.grid.tick(); again.grid.tick(); await turn();
    expect(again.shell.client.owned.get('finish-drop.ghost-stag')).toBe(1);
  } finally { again.close(); }
});

test('a grid kill and claim belong to their player, including after a worker reload', async () => {
  const storage = new PageStorage(), first = await boot(storage), a = directLoopback(), b = directLoopback();
  const ca = new NetClient(a.client), cb = new NetClient(b.client);
  try {
    first.grid.join({ join: 'pine-a', x: 5, y: 0, z: -225 }, a.server);
    first.grid.join({ join: 'pine-b', x: 5, y: 0, z: -225 }, b.server);
    ca.hello('test', { player: 'pine-a', name: 'A' }); cb.hello('test', { player: 'pine-b', name: 'B' }); a.pump(); b.pump(); first.grid.open();
    const frames = () => { first.grid.tick(); first.grid.tick(); a.pump(); b.pump(); };
    kill(first.grid, 'pine-a'); frames();
    expect(ca.owned.get('journal.ghost-stag.taken')).toBe(2);
    expect(cb.owned.has('journal.ghost-stag.taken'), 'B did not make A’s kill').toBe(false);
    expect(ca.owned.get('finish-drop.ghost-stag')).toBe(1);
    expect(cb.owned.has('finish-drop.ghost-stag')).toBe(false);
    const x = ca.owned.get('finish-drop.ghost-stag.x') ?? 0, y = ca.owned.get('finish-drop.ghost-stag.y') ?? 0, z = ca.owned.get('finish-drop.ghost-stag.z') ?? 0;
    first.grid.place({ x, y, z, yaw: 0 }, 'pine-b');
    cb.act({ kind: 'interact', seq: 0, id: 'finish.claim.ghost-stag' }); b.pump(); frames();
    expect(cb.owned.has('finish.ghost-stag'), 'B cannot take A’s finish').toBe(false);
    first.grid.place({ x, y, z, yaw: 0 }, 'pine-a');
    ca.act({ kind: 'interact', seq: 0, id: 'finish.claim.ghost-stag' }); a.pump(); frames();
    expect(ca.owned.get('finish.ghost-stag')).toBe(1);
    expect(ca.owned.has('finish-drop.ghost-stag')).toBe(false);
    kill(first.grid, 'pine-b'); frames();
    expect(cb.owned.get('journal.ghost-stag.taken')).toBe(2);
    expect(cb.owned.get('finish-drop.ghost-stag')).toBe(1);
    expect(ca.owned.get('journal.ghost-stag.taken')).toBe(2);
    expect(ca.owned.has('finish-drop.ghost-stag')).toBe(false);
    expect((await first.shell.save()).ok).toBe(true);
  } finally { ca.dispose(); cb.dispose(); first.close(); }
  const again = await boot(storage);
  const links = [directLoopback(), directLoopback()], clients = links.map(link => new NetClient(link.client));
  try {
    expect(again.booted.restored).toBe(true);
    for (const [index, id] of ['pine-a', 'pine-b'].entries()) {
      const link = links[index], client = clients[index];
      if (link === undefined || client === undefined) throw new Error('No returning client');
      again.grid.join({ join: id, x: 5, y: 0, z: -225 }, link.server);
      client.hello('test', { player: id, name: id }); link.pump();
    }
    again.grid.open(); again.grid.tick(); again.grid.tick(); for (const link of links) link.pump();
    expect(clients[0]?.owned.get('finish.ghost-stag')).toBe(1);
    expect(clients[0]?.owned.has('finish-drop.ghost-stag')).toBe(false);
    expect(clients[1]?.owned.has('finish.ghost-stag')).toBe(false);
    expect(clients[1]?.owned.get('finish-drop.ghost-stag')).toBe(1);
    for (const client of clients) expect(client.owned.get('journal.ghost-stag.taken')).toBe(2);
  } finally { for (const client of clients) client.dispose(); again.close(); }
});

test('a shared-storage host preserves page discovery and worn finishes across reload', async () => {
  const storage = new PageStorage();
  storage.setItem(KEY, JSON.stringify({ keys: { skins: { v: 1, data: { owned: ['scarback-furnace'], worn: {} } }, compendium: { v: 1, data: { 'ghost-stag': { s: 1, n: 1, t: 0, b: 0 } } } } }));
  const first = await boot(storage, true);
  const scope = new Scope('pine.page'), wire = new WirePage();
  const journal = onPage(storage, () => {
    if (input.product === undefined) throw new Error('Missing product');
    return new CompendiumState(declaredProductCompendium(input.product, input.shard.rows.compendiums[0]?.id ?? ''));
  });
  const skins = onPage(storage, () => new SkinLocker('pine-hollow', ['scarback-furnace', 'hollow-ash', 'ghost-stag'].map(id => ({ id, weapon: 'crossbow', name: id, blurb: '', mats: {} }))));
  wire.bind(first.shell.client, () => undefined, () => undefined, () => false);
  wire.hold({ shard: 'pine-hollow', journal, finishes: skins }, scope);
  const place = journal.def.entries.find(entry => entry.kind === 'place')?.id;
  if (place === undefined) throw new Error('No Pine place');
  try {
    // Real page mutations after the worker copied its boot documents.
    onPage(storage, () => {
      skins.own('hollow-ash'); skins.wear('crossbow', 'scarback-furnace');
      for (let i = 0; i < 6; i++) journal.see('ghost-stag');
      for (let i = 0; i < 3; i++) journal.placeVisited(place);
    });
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    kill(first.grid, 'actor.player');
    first.grid.open(); first.grid.tick(); first.grid.tick();
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    onPage(storage, () => { wire.frame('pine-hollow', true); });
    expect((await first.shell.save()).ok).toBe(true);
    // This confirmed kill reaches the page before the next periodic continuation; closing the tab keeps it.
    kill(first.grid, 'actor.player'); first.grid.tick(); first.grid.tick();
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    onPage(storage, () => { wire.frame('pine-hollow', true); });
  } finally { scope.dispose(); first.close(); }
  const again = await boot(storage, true);
  try {
    expect(again.booted.restored).toBe(true);
    expect(skinSave.read('pine-hollow')).toEqual({ owned: ['scarback-furnace', 'hollow-ash'], worn: { crossbow: 'scarback-furnace' } });
    expect(compendiumSave.read('pine-hollow')['ghost-stag']).toMatchObject({ n: 7, t: 2 });
    expect(compendiumSave.read('pine-hollow')[place]).toEqual({ s: 2, n: 3, t: 0, b: 0 });
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    again.grid.open(); again.grid.tick(); again.grid.tick();
    await new Promise<void>(resolve => { setTimeout(resolve, 0); });
    expect(again.shell.client.owned.get('journal.ghost-stag.taken')).toBe(3);
  } finally { again.close(); }
});
