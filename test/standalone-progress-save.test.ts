// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { FIXED_STEP } from '../src/shared/engine/core/fixedStep';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createNativeHeadlessResident, type HeadlessRuntimeInput, type NativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { builtFolder } from '../src/test/game/builtFolder';

// TE-ENG8: a solo server saves as progress moves, so a page reloaded a moment later keeps it. Nothing here asks for a save:
// the page's 30 s timer never runs, and a reload ends the worker before a save the page asks for on leaving comes back.
const BRASSCAP = 'brasscap-mesa';
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  /** Writes of every document, and of a world's continuation (its two slots). */
  writes = 0; continued = 0;
  serverTick = (): number => 0;
  lastContinuationTick = 0;
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
    this.writes++;
    if (/\.standalone(alt)?-/u.test(key)) {
      this.continued++;
      this.lastContinuationTick = this.serverTick();
    }
  }
  removeItem(key: string): void { this.writes++; this.items.delete(key); }
}
async function product(slug: string): Promise<HeadlessRuntimeInput> {
  const directory = builtFolder(slug), loaded = await loadHeadlessFolder(directory), descriptor = outputDescriptor(loaded.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: loaded.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product: loaded };
}
/** A page holding a save whose player stands at (x, z). */
async function standingAt(slug: string, input: HeadlessRuntimeInput, x: number, z: number): Promise<PageStorage> {
  const live: NativeHeadlessResident = await createNativeHeadlessResident(input), storage = new PageStorage();
  const player = leadPlayer(live.host); player.position.set(x, live.host.groundHeightAt(x, z), z); player.motor.resetAt(player.position);
  live.step([]); live.step([]);
  const data = { tick: live.host.state.tick, snapshot: serializeSimSnapshot(snapshotSimHostBytes(live.host)) };
  storage.setItem(`wildshard.standalone-${slug}`, JSON.stringify({ keys: { continuation: { v: 1, data } } }));
  live.dispose();
  storage.writes = 0; storage.continued = 0;
  return storage;
}
function start(slug: string, storage: PageStorage, input: HeadlessRuntimeInput): StandaloneShell {
  const control = new MessageChannel(), game = new MessageChannel(), harness = new MessageChannel();
  const server = runStandaloneServer({
    control: control.port1, game: game.port1, harness: harness.port1, load: () => Promise.resolve(input),
    proof: { booted: grid => { storage.serverTick = () => grid.host.state.tick; } },
  });
  return connectStandalone({ slug, base: `/shards/${slug}/`, build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); harness.port1.close(); }, harness.port2);
}
const until = async (ready: () => boolean, timeout = 10_000): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout, interval: 5 }); };
const sleep = (ms: number): Promise<void> => new Promise(resolve => { setTimeout(resolve, ms); });
async function expectPromptSave(storage: PageStorage, writesBefore: number): Promise<void> {
  const observedAtTick = storage.serverTick();
  expect(observedAtTick).toBeGreaterThan(0);
  // Measure the write in simulated time. Allow the real message ports to
  // drain under load, with a watchdog well below the page's 30-second save.
  await until(() => storage.continued > writesBefore, 5_000);
  expect((storage.lastContinuationTick - observedAtTick) * FIXED_STEP).toBeLessThan(1);
}
/** Boot a page on `storage`, wait for the world's first frame, and send frames as they come. */
async function open(slug: string, storage: PageStorage, input: HeadlessRuntimeInput): Promise<StandaloneShell> {
  const shell = start(slug, storage, input);
  await shell.booted; shell.ready();
  await until(() => shell.client.latest !== null);
  shell.client.onFrame(() => { shell.client.flush(); });
  return shell;
}

test('an opened gate (a public field) saves within a second of simulation, with no save asked for, and a reload keeps it', async () => {
  const input = await product(BRASSCAP), storage = new PageStorage();
  const first = await open(BRASSCAP, storage, input), door = (shell: StandaloneShell): number | undefined => shell.client.latest === null ? undefined : shell.client.stateField(shell.client.latest, 'brasscap.gate.open');
  expect(door(first)).toBe(0);
  // A data shard's world has no headless resident to stand a save in: the harness stands the player at the canyon gate
  // (J434: its use, `brasscap.gate.use`, is radius 2 at (2, -61.5))
  first.place(2, 0, -60, Math.PI);
  // Settle the boot's own writes, then take what the page holds as the line
  await sleep(1000);
  const before = storage.continued;
  first.client.act({ kind: 'interact', seq: 1, id: 'brasscap.gate.use' });
  await until(() => door(first) === 1);
  await expectPromptSave(storage, before);
  first.dispose(); // the reload: the worker ends with no save of its own

  const second = await open(BRASSCAP, storage, input);
  expect(door(second)).toBe(1);
  second.dispose();
}, 40_000);

test('a quest step (a flag) saves within a second of simulation, and a reload keeps it', async () => {
  const input = await product('driftwood-isle'), storage = await standingAt('driftwood-isle', input, -22, -71.5);
  const first = await open('driftwood-isle', storage, input);
  await sleep(1000);
  const before = storage.continued;
  first.client.act({ kind: 'interact', seq: 1, id: 'castaway.talk' });
  await until(() => first.client.quests.get('sealed-ring')?.started === true);
  await expectPromptSave(storage, before);
  first.dispose();

  const second = await open('driftwood-isle', storage, input);
  await until(() => second.client.quests.get('sealed-ring')?.started === true, 3000);
  second.dispose();
}, 40_000);

test('an idle world writes nothing between the page\'s own saves', async () => {
  const input = await product(BRASSCAP), storage = new PageStorage();
  const shell = await open(BRASSCAP, storage, input);
  await sleep(1000);
  const before = storage.writes;
  await sleep(2000);
  expect(storage.writes).toBe(before);
  shell.dispose();
}, 40_000);
