// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import type { NetChat } from '../src/shared/engine/net/chatWire';
import type { NetLedger } from '../src/shared/engine/net/ledgerWire';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type HeadlessRuntimeInput, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { builtProduct } from './fixtures/builtProduct';

// P1-E5.2c: the acts and receipts through the real worker code over real MessagePorts. The page has no way to teleport, so
// each run starts from a save whose player already stands where the act needs them.
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
async function product(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct(slug), loaded = await loadHeadlessProduct(directory), descriptor = outputDescriptor(loaded.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: loaded.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product: loaded };
}
/** A page holding a save made after `arrange`. */
async function saved(slug: string, input: HeadlessRuntimeInput, arrange: (live: TrustedHeadlessResident) => void): Promise<PageStorage> {
  const live = await createTrustedHeadlessResident(input), storage = new PageStorage();
  arrange(live); live.step([]); live.step([]);
  const data = { tick: live.host.state.tick, snapshot: serializeSimSnapshot(snapshotSimHostBytes(live.host)) };
  storage.setItem(`wildshard.standalone-${slug}`, JSON.stringify({ keys: { continuation: { v: 1, data } } }));
  live.dispose();
  return storage;
}
function start(slug: string, storage: SaveStorage, input: HeadlessRuntimeInput): StandaloneShell {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input) });
  return connectStandalone({ slug, base: `/shards/${slug}/`, build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); });
}
const until = async (ready: () => boolean): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout: 10_000, interval: 5 }); };
const stand = (live: TrustedHeadlessResident, x: number, z: number): void => {
  const player = leadPlayer(live.host); player.position.set(x, live.host.groundHeightAt(x, z), z); player.motor.resetAt(player.position);
};

test('interact and its ledger receipt cross the worker, the grant reaches the page, and a retry pays nothing', async () => {
  const input = await product('driftwood-isle'), storage = await saved('driftwood-isle', input, live => { stand(live, -22, -71.5); });
  const shell = start('driftwood-isle', storage, input), { client } = shell, receipts: NetLedger[] = [];
  client.onLedger(row => { receipts.push(row); });
  await shell.booted; shell.ready();
  await until(() => client.latest !== null);
  client.onFrame(() => { client.flush(); });
  client.act({ kind: 'interact', seq: 1, id: 'castaway.talk' });
  await until(() => client.quests.get('sealed-ring')?.started === true);
  await until(() => receipts.length > 0);
  expect(receipts[0]).toMatchObject({ grant: 'fact', pending: false });
  const paid = receipts.length, profile = storage.getItem('wildshard.profile');
  expect(profile).toContain(receipts[0]?.name);
  client.act({ kind: 'interact', seq: 2, id: 'castaway.talk' });
  const tick = client.latest?.tick ?? 0;
  await until(() => (client.latest?.tick ?? 0) > tick + 20);
  expect(receipts).toHaveLength(paid);
  shell.dispose();
}, 40_000);

test('equip crosses the worker and comes back in the owner block', async () => {
  const input = await product('pine-hollow'), storage = await saved('pine-hollow', input, live => { live.host.flags.set('owned:lever-rifle'); });
  const shell = start('pine-hollow', storage, input), { client } = shell;
  await shell.booted; shell.ready();
  await until(() => client.latest !== null);
  client.onFrame(() => { client.flush(); });
  client.act({ kind: 'equip', seq: 1, slot: 1 });
  await until(() => client.latest !== null && client.owner(client.latest)['held'] === 1);
  shell.dispose();
}, 40_000);

test('a line of chat crosses the worker, filtered', async () => {
  const input = await product('sunscar-dunes'), shell = start('sunscar-dunes', new PageStorage(), input);
  const { client } = shell, heard: NetChat[] = [];
  client.onChat(line => { heard.push(line); });
  await shell.booted; shell.ready();
  await until(() => client.latest !== null);
  client.onFrame(() => { client.flush(); });
  client.say('room', 'hello shit');
  await until(() => heard.length === 1);
  expect(heard[0]).toMatchObject({ name: 'Guest', text: 'hello ****', channel: 'room' });
  shell.dispose();
}, 40_000);
