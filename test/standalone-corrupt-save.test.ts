// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { builtProduct } from './fixtures/builtProduct';

// P1-E5.2c (J102): a corrupt save falls back without losing the last good one, through the real worker code and a real restore.
const SLUG = 'sunscar-dunes', FIRST = `wildshard.standalone-${SLUG}`, SECOND = `wildshard.standalonealt-${SLUG}`;
class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  refuse = false;
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.refuse) throw new Error('quota'); this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
async function sunscar(): Promise<HeadlessRuntimeInput> {
  const directory = builtProduct(SLUG), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
interface Run { readonly shell: StandaloneShell; readonly refused: unknown[] }
function start(storage: SaveStorage, input: HeadlessRuntimeInput): Run {
  const control = new MessageChannel(), game = new MessageChannel(), refused: unknown[] = [];
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input), onSaveRefused: error => { refused.push(error); } });
  return { shell: connectStandalone({ slug: SLUG, base: `/shards/${SLUG}/`, build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); }), refused };
}
const until = async (ready: () => boolean): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout: 10_000, interval: 5 }); };
/** Boot, run a moment, and make `saves` saves, each at a later tick. */
async function played(storage: PageStorage, input: HeadlessRuntimeInput, saves: number): Promise<number[]> {
  const { shell } = start(storage, input), ticks: number[] = [];
  await shell.booted; shell.ready();
  for (let index = 0; index < saves; index++) {
    const from = shell.client.latest?.tick ?? 0;
    await until(() => (shell.client.latest?.tick ?? 0) > from + 10);
    const saved = await shell.save();
    expect(saved.ok).toBe(true);
    ticks.push(saved.tick);
  }
  shell.dispose();
  return ticks;
}
const withSnapshot = (raw: string, snapshot: string): string => {
  const parsed: unknown = JSON.parse(raw);
  return JSON.stringify(parsed, (key, value: unknown) => key === 'snapshot' ? snapshot : value);
};

test('saves take two documents in turn, and a reload takes the newest', async () => {
  const storage = new PageStorage(), input = await sunscar(), [, newest] = await played(storage, input, 2);
  expect(storage.getItem(FIRST)).not.toBeNull(); expect(storage.getItem(SECOND)).not.toBeNull();
  const { shell, refused } = start(storage, input);
  expect(await shell.booted).toEqual({ tick: newest, restored: true });
  expect(refused).toEqual([]);
  shell.dispose();
}, 40_000);

test('a save only ever in the first document, as older builds wrote it, still loads', async () => {
  const storage = new PageStorage(), input = await sunscar(), [only] = await played(storage, input, 1);
  expect(storage.getItem(SECOND)).toBeNull();
  const { shell } = start(storage, input);
  expect(await shell.booted).toEqual({ tick: only, restored: true });
  shell.dispose();
}, 40_000);

test('a torn newest save falls back to the one before, and the next save cannot touch that one', async () => {
  const storage = new PageStorage(), input = await sunscar(), [older] = await played(storage, input, 2), good = storage.getItem(FIRST) ?? '';
  storage.setItem(SECOND, storage.getItem(SECOND)?.slice(0, 5000) ?? ''); // the write that died halfway
  const { shell } = start(storage, input);
  expect(await shell.booted).toEqual({ tick: older, restored: true });
  shell.ready();
  await until(() => (shell.client.latest?.tick ?? 0) > (older ?? 0) + 10);
  expect((await shell.save()).ok).toBe(true);
  expect(storage.getItem(FIRST), 'the last good save stands while its successor proves itself').toBe(good);
  expect([...storage.items.keys()].some(key => key.startsWith(`${SECOND}.corrupt.`)), 'and the torn bytes are kept').toBe(true);
  shell.dispose();
}, 40_000);

test('a save that parses but will not restore falls back too, and its bytes are set aside', async () => {
  const storage = new PageStorage(), input = await sunscar(), [older] = await played(storage, input, 2), bad = withSnapshot(storage.getItem(SECOND) ?? '', 'not a continuation');
  storage.setItem(SECOND, bad);
  const { shell, refused } = start(storage, input);
  expect(await shell.booted).toEqual({ tick: older, restored: true });
  expect(refused).toHaveLength(1);
  await until(() => storage.getItem(`${SECOND}.corrupt.restore`) === bad);
  shell.dispose();
}, 40_000);

test('with nothing good left the server still boots, fresh, and the corrupt bytes survive', async () => {
  const storage = new PageStorage(), input = await sunscar();
  await played(storage, input, 2);
  const one = withSnapshot(storage.getItem(FIRST) ?? '', 'bad one'), two = withSnapshot(storage.getItem(SECOND) ?? '', 'bad two');
  storage.setItem(FIRST, one); storage.setItem(SECOND, two);
  const { shell, refused } = start(storage, input);
  expect(await shell.booted).toEqual({ tick: 0, restored: false });
  expect(refused).toHaveLength(2);
  await until(() => storage.getItem(`${FIRST}.corrupt.restore`) === one && storage.getItem(`${SECOND}.corrupt.restore`) === two);
  shell.dispose();
}, 40_000);

test('a refused write leaves the last good save, however many times it is retried', async () => {
  const storage = new PageStorage(), input = await sunscar(), [older] = await played(storage, input, 1), { shell } = start(storage, input);
  await shell.booted; shell.ready();
  await until(() => (shell.client.latest?.tick ?? 0) > (older ?? 0) + 10);
  storage.refuse = true;
  expect((await shell.save()).ok).toBe(false);
  expect((await shell.save()).ok).toBe(false);
  storage.refuse = false;
  shell.dispose();
  const again = start(storage, input);
  expect(await again.shell.booted).toEqual({ tick: older, restored: true });
  again.shell.dispose();
}, 40_000);
