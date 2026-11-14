// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { afterEach, expect, test, vi } from 'vitest';
import { installAppIdentity } from '../src/shared/engine/app/identity';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { installSaveEnvironment } from '../src/shared/engine/saves/environment';
import { saves } from '../src/shared/engine/saves/runtime';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { decodeSimSnapshot, serializeSimSnapshot } from '../src/shared/engine/sim/snapshot';
import { instanceSave } from '../src/shared/game/instanceSaves';
import { captureClientState, clientStateSave } from '../src/shared/game/shardfile/clientState';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { createShardfileSim } from '../src/server/game/plugin/simulation';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { bakedGridCollision } from './fixtures/gridCollision';
import { builtFolder } from './fixtures/builtFolder';

// An exact save is one build's: a later build that changes a level, a creature or an adapter refuses the whole world. The player's progress still
// goes on, through the real worker code, or every such deploy takes it from them.
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
  const directory = builtFolder(slug), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error(`Missing ${slug} output`);
  const server = descriptor.index.files.filter(file => serverReadsFile(file, product.shardfile.terrain?.collider) && (file.name === undefined || file.kind === 'wasm' || file.kind === 'tile'));
  const assets = new Map(server.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
let stop: (() => void) | undefined, running: StandaloneGrid | undefined;
function boot(storage: SaveStorage, slug: string, refused: unknown[] = []): StandaloneShell {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, cell) => serverInput(cell), strips: bakedGridCollision, onSaveRefused: error => { refused.push(error); }, proof: { booted: grid => { running = grid; } } });
  const shell = connectStandalone({ slug, base: `/shards/${slug}/`, build: 'test', savePrefix: PREFIX, storage, lone: true }, control.port2, game.port2, () => { server.dispose(); });
  stop = () => { shell.dispose(); };
  return shell;
}
afterEach(() => { stop?.(); stop = undefined; });
const played = async (shell: StandaloneShell, flag: string): Promise<void> => {
  await shell.booted; shell.ready();
  await vi.waitFor(() => { expect(shell.client.latest?.tick ?? 0).toBeGreaterThan(5); }, { timeout: 10_000, interval: 5 });
  running?.raise(flag);
  expect((await shell.save()).ok).toBe(true);
  stop?.();
};
/** What a level's edit does to a save: nothing in its bytes changes, and no later build will restore it. */
function laterBuild(storage: PageStorage): void {
  for (const key of [...storage.items.keys()].filter(name => /standalone(alt)?-lone-/u.test(name) && !name.includes('.corrupt'))) {
    const doc = JSON.parse(storage.items.get(key) ?? '{}') as { keys: { continuation: { data: { snapshot: string } } } }, saved = decodeSimSnapshot(doc.keys.continuation.data.snapshot);
    doc.keys.continuation.data.snapshot = serializeSimSnapshot({ ...saved, levelFingerprint: saved.levelFingerprint + 1 });
    storage.items.set(key, JSON.stringify(doc));
  }
}

test.each(['pastel-plain', 'nalati-grasslands'])('%s: a save a later build refuses still gives back its flags, and the next save stands', { timeout: 20_000 }, async slug => {
  const storage = new PageStorage(), refused: unknown[] = [];
  await played(boot(storage, slug), 'kept.flag');
  laterBuild(storage);
  const shell = boot(storage, slug, refused);
  expect(await shell.booted).toMatchObject({ restored: true });
  expect(refused.length).toBeGreaterThan(0);
  expect(running?.host.flags.has('kept.flag')).toBe(true);
  await played(shell, 'next.flag');
  const again = boot(storage, slug), { restored } = await again.booted;
  expect(restored).toBe(true);
  expect(running?.host.flags.has('kept.flag')).toBe(true);
  expect(running?.host.flags.has('next.flag')).toBe(true);
});

test('a page\'s continuation with a lane from another build, holding a page\'s items, keeps its progress', { timeout: 20_000 }, async () => {
  const slug = 'pastel-plain', input = await serverInput(slug), storage = new PageStorage(), sim = createShardfileSim(input.shard, input.assets, { rapier: input.rapier, quest: { fact: () => undefined, coins: () => undefined } });
  sim.host.flags.set('imported.flag');
  const checkpoint = captureClientState(input.shard, sim, new Map());
  sim.dispose();
  installAppIdentity({ name: '', wordmark: '', tagline: '', savePrefix: PREFIX, saveFormat: '', fileSlug: '', exposeProbe: () => undefined, harness: () => undefined });
  installSaveEnvironment({ storage: () => storage, persistent: () => true, persist: () => Promise.resolve(false) });
  const item = { version: 1 as const, id: 'weapon.pastel-whip', tick: 1, cooldown: 0, fuel: 1, lit: false, held: false, chargeTime: 0, pending: [] };
  const lane: unknown = JSON.parse(checkpoint.lane ?? '{}');
  expect(instanceSave(saves, clientStateSave, { id: slug, shard: slug }).write({ ...checkpoint, lane: JSON.stringify({ ...lane as object, contract: 'another build' }), items: { [item.id]: item } })).toBe(true);
  const refused: unknown[] = [], shell = boot(storage, slug, refused);
  await shell.booted;
  expect(refused).toEqual([]);
  expect(running?.host.flags.has('imported.flag')).toBe(true);
});

// EV5: the late write behind the nalati case's flake. A progress save the worker posted just before the page ended the session
// still reached the page's port, and landed after the next session had read storage, with a world tick that outranked its save.
test('a write the worker posted before the page ended its session never lands', async () => {
  const storage = new PageStorage(), control = new MessageChannel(), game = new MessageChannel(), key = `${PREFIX}standalonealt-lone-pastel-plain`;
  const shell = connectStandalone({ slug: 'pastel-plain', base: '/shards/pastel-plain/', build: 'test', savePrefix: PREFIX, storage, lone: true }, control.port2, game.port2, () => undefined);
  // The server answers the page's save, and the progress save queued behind it posts its write in the same turn. Node runs
  // the microtasks after `saved` (the dispose) before it hands over `write`, which is the order the flake hit.
  control.port1.onmessage = (event: MessageEvent<{ readonly kind: string; readonly id?: number }>): void => {
    if (event.data.kind !== 'save') return;
    control.port1.postMessage({ kind: 'saved', id: event.data.id, tick: 1, ok: true });
    control.port1.postMessage({ kind: 'write', seq: 1, key, value: '{"keys":{}}' });
  };
  expect((await shell.save()).ok).toBe(true);
  shell.dispose();
  await new Promise(resolve => { setTimeout(resolve, 50); });
  control.port1.close(); game.port1.close();
  expect(storage.items.has(key)).toBe(false);
});
