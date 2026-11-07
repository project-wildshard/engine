// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { bakedGridCollision } from './fixtures/gridCollision';
import { afterEach, expect, test, vi } from 'vitest';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { installSaveEnvironment } from '../src/shared/engine/saves/environment';
import { saves } from '../src/shared/engine/saves/runtime';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { captureClientState, clientStateSave } from '../src/shared/game/shardfile/clientState';
import { GridAssembly } from '../src/shared/game/grid/assembly';
import { gridRecovery } from '../src/shared/game/grid/recovery';
import { regionalRuntimeCheckpoint } from '../src/shared/game/grid/runtimeCheckpoint';
import { instanceSave } from '../src/shared/game/instanceSaves';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { importPageSaves, type IndexedSaves } from '../src/client/engine/saves/indexed';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { builtProduct } from './fixtures/builtProduct';

// A player's saves are the page's: the server opens them, with its own world rebuilt, and carries on from what they say.
const PREFIX = 'wildshard.save.v2.';
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
async function serverInput(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
/** The page's own save environment, writing what a player's page wrote. */
function pageSaves(storage: SaveStorage): void {
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: PREFIX, saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
  installSaveEnvironment({ storage: () => storage, persistent: () => true, persist: () => Promise.resolve(false) });
}
let stop: (() => void) | undefined, running: StandaloneGrid | undefined;
function boot(storage: SaveStorage, slug: string, lone?: true): StandaloneShell {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, cell) => serverInput(cell), strips: bakedGridCollision, onSaveRefused: error => { throw error; }, proof: { booted: grid => { running = grid; } } });
  const shell = connectStandalone({ slug, base: `/shards/${slug}/`, build: 'test', savePrefix: PREFIX, storage, ...(lone === undefined ? {} : { lone }) }, control.port2, game.port2, () => { server.dispose(); });
  stop = () => { shell.dispose(); };
  return shell;
}
afterEach(() => { stop?.(); stop = undefined; });
const assembly = new GridAssembly({ developer: false, devserver: false });

test('saves copy in once and leave the page\'s alone; what the store has already stands', async () => {
  const page = new PageStorage(), written = new Map<string, string | null>([[`${PREFIX}shard`, 'newer']]);
  page.setItem(`${PREFIX}shard`, 'old'); page.setItem(`${PREFIX}device`, 'device'); page.setItem('other', 'not a save');
  const write = vi.fn((key: string, value: string | null) => { written.set(key, value); return Promise.resolve(true); });
  const store: IndexedSaves = { write, storage: { length: 0, key: () => null, getItem: key => written.get(key) ?? null, setItem: () => undefined, removeItem: () => undefined } };
  await importPageSaves(store, page, PREFIX); await importPageSaves(store, page, PREFIX);
  expect(written.get(`${PREFIX}shard`)).toBe('newer');
  expect(written.get(`${PREFIX}device`)).toBe('device');
  expect(written.has('other')).toBe(false);
  expect(write).toHaveBeenCalledTimes(2); // the document and the mark, once
  expect(page.getItem(`${PREFIX}shard`)).toBe('old');
});

test('a mark is not set over a failed copy: the next boot finishes it', async () => {
  const page = new PageStorage(), written = new Map<string, string | null>();
  page.setItem(`${PREFIX}shard`, 'old');
  let refuse = true;
  const store: IndexedSaves = { write: (key, value) => { if (refuse) return Promise.resolve(false); written.set(key, value); return Promise.resolve(true); }, storage: { length: 0, key: () => null, getItem: key => written.get(key) ?? null, setItem: () => undefined, removeItem: () => undefined } };
  await importPageSaves(store, page, PREFIX);
  expect(written.size).toBe(0);
  refuse = false; await importPageSaves(store, page, PREFIX);
  expect(written.get(`${PREFIX}shard`)).toBe('old');
});

test('a data cell takes a page\'s progress, in a world of its own', { timeout: 60_000 }, async () => {
  const slug = 'pastel-plain', input = await serverInput(slug), storage = new PageStorage(), sim = createShardfileSim(input.shard, input.assets, { rapier: input.rapier, quest: { fact: () => undefined, coins: () => undefined } });
  sim.host.flags.set('imported.flag');
  const checkpoint = captureClientState(input.shard, sim, new Map());
  sim.dispose();
  pageSaves(storage);
  expect(instanceSave(saves, clientStateSave, { id: slug, shard: slug }).write(checkpoint)).toBe(true);
  const shell = boot(storage, slug, true);
  expect(await shell.booted).toMatchObject({ restored: false });
  expect(running?.host.flags.has('imported.flag')).toBe(true);
});

test('a session opens where the page\'s save stood, and a creature keeps its health', { timeout: 60_000 }, async () => {
  const cell = assembly.cell('driftwood-isle'), slug = cell.slug, placed = { id: cell.instance, shard: slug }, input = await serverInput(slug);
  const fresh = new PageStorage(), first = boot(fresh, 'sunscar-dunes');
  await first.booted;
  stop?.();
  const storage = new PageStorage();
  pageSaves(storage);
  const road = { x: cell.origin.x + assembly.pitch / 2, z: cell.origin.z, yaw: 0 };
  expect(gridRecovery(saves).save(assembly, cell, road, { kind: 'cell', x: 40, y: 12, z: -60, yaw: 1 })).toBe(true);
  const shell = boot(storage, 'sunscar-dunes');
  expect(await shell.booted).toMatchObject({ restored: false });
  expect(running?.grid.current()).toBe(cell.instance);
  const seat = running?.host.players.get('actor.player');
  expect(seat?.position.x).toBeCloseTo(40); expect(seat?.position.z).toBeCloseTo(-60);
  const [id, creature] = [...running?.host.entities ?? []][0] ?? [];
  if (id === undefined || creature === undefined) throw new Error(`${slug} has no creature`);
  stop?.();
  const hurt = new PageStorage();
  pageSaves(hurt);
  gridRecovery(saves).save(assembly, cell, road, { kind: 'cell', x: 40, y: 12, z: -60, yaw: 1 });
  regionalRuntimeCheckpoint(saves, placed, input.shard.identity.revision).checkpoint({ animals: [{ entityId: id, kind: creature.kind, hp: 1, maxHp: creature.maxHp, alive: true, position: creature.position, yaw: creature.yaw, snapshot: () => creature.snapshot(), restore: () => undefined }] });
  const again = boot(hurt, 'sunscar-dunes');
  await again.booted;
  expect(running?.host.entities.get(id)?.hp).toBe(1);
});
