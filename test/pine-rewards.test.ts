// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the shipped Pine product and worker bridge.
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { beforeAll, expect, test } from 'vitest';
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
import { compendiumSave, skinSave } from '../src/shared/game/saves';
import { populationRoster } from '../src/server/game/population/roster';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone } from '../src/client/host/standalone/shell';
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
beforeAll(async () => {
  const directory = builtProduct('pine-hollow'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing Pine output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  input = { product, shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')) };
  rosterStep = (await product.json('actors/roster.json') as { step: string }).step;
});
async function boot(storage: PageStorage, lone?: true) {
  const control = new MessageChannel(), game = new MessageChannel();
  let grid: StandaloneGrid | undefined;
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input), strips: bakedGridCollision,
    onSaveRefused: error => { throw error; }, proof: { booted: value => { grid = value; } } });
  const shell = connectStandalone({ slug: 'pine-hollow', base: '/shards/pine-hollow/', build: 'test', savePrefix: PREFIX, storage, ...(lone === undefined ? {} : { lone }) }, control.port2, game.port2, () => { server.dispose(); });
  const booted = await shell.booted;
  if (grid === undefined) throw new Error('No worker world');
  return { shell, grid, booted };
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
  } finally { ca.dispose(); cb.dispose(); first.shell.dispose(); }
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
  } finally { for (const client of clients) client.dispose(); again.shell.dispose(); }
});

test('page discovery and worn finishes survive a worker reward write and reload', async () => {
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
  } finally { scope.dispose(); first.shell.dispose(); }
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
  } finally { again.shell.dispose(); }
});
