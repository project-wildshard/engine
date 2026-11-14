import { runtimeAssets, builtProduct } from './fixtures/engine-lift/product';
// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { loadHeadlessProduct } from '@wildshard/engine/host/headlessProduct';
import type { HeadlessRuntimeInput } from '@wildshard/engine/host/headlessRuntime';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { afterEach, expect, test, vi } from 'vitest';
import { connectStandalone } from '../src/client/host/standalone/shell';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { isDevRestart, withDevGameplay } from '../src/shared/game/devGameplay';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';

// SHARD-SOURCE AP19: `wildshard watch`'s soft restart, both halves over real MessagePorts, as standalone-server.test.ts runs them.
// The page asks; the server saves, boots its world again on the new rows from that save and takes a new link, which the page's
// client rejoins; the player stands where the page said.

class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
const until = async (ready: () => boolean): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout: 10_000, interval: 5 }); };

afterEach(() => { vi.unstubAllGlobals(); });

test('AP19: the in-page server restarts on new quest rows, keeps the player where the page has it, and the client rejoins', async () => {
  vi.stubGlobal('__DEVSERVER__', true);
  const directory = builtProduct('sunscar-dunes'), product = await loadHeadlessProduct(directory);
  const input: HeadlessRuntimeInput = { shard: product.shardfile, assets: runtimeAssets(product, directory), rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
  // the worker's reader makes its product of the patched shardfile (serverProduct.ts); here the fixture's product takes it
  const read: Shardfile[] = [];
  const load = (_boot: unknown, _slug: string, patch?: (shard: Shardfile) => Shardfile): Promise<HeadlessRuntimeInput> => {
    if (patch === undefined) return Promise.resolve(input);
    const shard = patch(input.shard); read.push(shard);
    return Promise.resolve({ ...input, shard, product: { ...product, shardfile: shard } });
  };
  const control = new MessageChannel(), game = new MessageChannel(), harness = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, harness: harness.port1, load });
  const shell = connectStandalone({ slug: 'sunscar-dunes', base: '/shards/sunscar-dunes/', build: 'test', savePrefix: 'wildshard.', storage: new PageStorage() },
    control.port2, game.port2, () => { server.dispose(); }, harness.port2);
  await shell.booted; shell.ready();
  await until(() => shell.client.latest !== null);

  // a quest step's words, changed in the source
  const quests: Shardfile['quests'] = structuredClone(input.shard.quests), step = quests.quests[0]?.steps[0];
  if (step === undefined) throw new Error('the fixture has no quest step');
  step.objective = 'Find the well behind the dune';
  const at = { x: 12.5, y: 40, z: -7.25, yaw: 0.5 };
  expect(isDevRestart({ wildshardDevRestart: { quests }, at })).toBe(true);
  expect(isDevRestart({ wildshardDevRestart: { look: {} }, at })).toBe(false);
  const before = shell.client.latest?.tick ?? 0;
  const done = await shell.devRestart({ quests }, at);
  expect(done).toMatchObject({ ok: true });
  expect(read.at(-1)?.quests.quests[0]?.steps[0]?.objective).toBe('Find the well behind the dune');
  // the descriptor rides the patched shardfile, so the product is still a verified output
  expect(outputDescriptor(read.at(-1) as Shardfile)).toBe(outputDescriptor(input.shard));
  // the client hears the new world's frames, from the saved tick on, and its player stands where the page said
  await until(() => (shell.client.latest?.tick ?? 0) > before + 10);
  const frame = shell.client.latest;
  if (frame === null) throw new Error('no frame after the restart');
  const { px, pz } = shell.client.owner(frame);
  expect(Math.hypot(Number(px) - at.x, Number(pz) - at.z)).toBeLessThan(1);
  // rows the format refuses are no restart: the running world stays down only until the page reloads into a new shell
  expect(() => withDevGameplay(input.shard, { quests: { ...quests, quests: [{ ...quests.quests[0], steps: [] }] } as unknown as Shardfile['quests'] })).toThrow();
  shell.dispose();
});
