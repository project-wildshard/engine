import { runtimeAssets } from './fixtures/engine-lift/folder';
// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import type { HeadlessRuntimeInput } from '@wildshard/engine/host/headlessRuntime';
import { readFileSync } from 'node:fs';
import { expect,test,vi } from 'vitest';
import { connectStandalone,type StandaloneShell } from '../src/client/host/standalone/shell';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { ANIMAL_CLASS } from '../src/shared/engine/net/netSchemas';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { WorkerLoopback } from '../src/shared/host/standalone/workerLoopback';
import { builtFolder } from './fixtures/engine-lift/folder';

// P1-E5.2 (E5-REPLICATION §6.3): the standalone target's two halves over real MessagePorts, on the server's own clock. The
// page's half and the worker's are the same code a browser runs; scripts/standalone-smoke.mjs runs them in a real Worker.

class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  refuse = false;
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { if (this.refuse) throw new Error('quota'); this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}

async function sunscarInput(): Promise<HeadlessRuntimeInput> {
  const directory = builtFolder('sunscar-dunes'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing Sunscar output');
  const assets = runtimeAssets(product, directory);
  return { shard: product.shardfile, assets, rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), product };
}
function start(storage: SaveStorage, input: HeadlessRuntimeInput): { shell: StandaloneShell; stop: () => void } {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input) });
  const shell = connectStandalone({ slug: 'sunscar-dunes', base: '/shards/sunscar-dunes/', build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); });
  return { shell, stop: () => { shell.dispose(); } };
}
const until = async (ready: () => boolean): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout: 10_000, interval: 5 }); };

test('the server ticks on its own clock, frames arrive at 30 Hz, and rows match the server within a step', async () => {
  const storage = new PageStorage(), { shell, stop } = start(storage, await sunscarInput()), { client } = shell;
  expect(await shell.booted).toEqual({ tick: 0, restored: false });
  shell.ready();
  await until(() => client.latest !== null);
  const first = client.latest?.tick ?? 0, frames: number[] = [];
  client.onFrame(frame => { frames.push(frame.tick); client.flush(); });
  await until(() => frames.length >= 45);
  // Frames are every second tick, in order, with none missing on a port
  expect(frames.every((tick, index) => tick === first + 2 * (index + 1))).toBe(true);
  const probe = await shell.probe();
  await until(() => client.frame(probe.tick) !== null);
  const frame = client.frame(probe.tick), step = ANIMAL_CLASS.row[0]?.step ?? 0;
  if (frame === null) throw new Error('Probed frame missing');
  expect(probe.rows).toHaveLength(13);
  const { px, py, pz } = client.owner(frame);
  for (const row of probe.rows) {
    const handle = [...client.entities.values()].find(entity => entity.id === row.id)?.handle ?? -1, fields = client.fields(frame, handle);
    if (Math.hypot(row.x - Number(px), row.y - Number(py), row.z - Number(pz)) > 59) continue; // past the near band a row is on its tier (P1-E5.2c)
    for (const axis of ['x', 'y', 'z'] as const) expect(Math.abs(Number(fields?.[axis]) - row[axis])).toBeLessThanOrEqual(step);
  }
  stop();
});

test('a save made in the server survives a reload, and is durable only once the page has it', async () => {
  // This outer edge deliberately waits for 120 real server-clock ticks
  // (about two seconds), then tests page acknowledgement and a fresh boot.
  // It measured 5.9 s under suite load, 2.56 s alone; the real timer is
  // part of the durability contract, and the case stays below J186's 10 s.
  const storage = new PageStorage(), input = await sunscarInput(), first = start(storage, input);
  await first.shell.booted; first.shell.ready();
  await until(() => first.shell.client.latest !== null);
  first.shell.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 1, pitch: 0, buttons: NET_BUTTONS.sprint });
  first.shell.client.flush();
  await until(() => (first.shell.client.latest?.tick ?? 0) > 120);
  const saved = await first.shell.save();
  expect(saved.ok).toBe(true);
  const document = storage.getItem('wildshard.standalone-sunscar-dunes');
  expect(document?.length).toBeGreaterThan(100_000);
  storage.refuse = true;
  expect((await first.shell.save()).ok).toBe(false); // the worker's copy took it; the page's refused, and the save says so
  storage.refuse = false;
  first.stop();

  const second = start(storage, input);
  expect(await second.shell.booted).toEqual({ tick: saved.tick, restored: true });
  second.shell.ready();
  await until(() => (second.shell.client.latest?.tick ?? 0) > saved.tick + 20);
  second.stop();
});

test('the worker pauses with a hidden tab: paused time is never simulated', async () => {
  const { shell, stop } = start(new PageStorage(), await sunscarInput());
  await shell.booted; shell.ready();
  await until(() => shell.client.latest !== null);
  shell.pause();
  await new Promise(resolve => { setTimeout(resolve, 50); });
  const held = shell.client.latest?.tick ?? 0;
  await new Promise(resolve => { setTimeout(resolve, 200); });
  expect(shell.client.latest?.tick).toBe(held);
  shell.resume();
  await until(() => (shell.client.latest?.tick ?? 0) > held);
  expect((shell.client.latest?.tick ?? 0) - held).toBeLessThan(30); // no burst for the 200 ms it slept
  stop();
});

test('a server of another build of this wire takes the hello: no reload (WR5, J54 replaced)', async () => {
  const control = new MessageChannel(), game = new MessageChannel(), input = await sunscarInput();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input) });
  let refused = 0;
  const shell = connectStandalone({ slug: 'sunscar-dunes', base: '/shards/sunscar-dunes/', build: 'stale', serverBuild: 'newer', savePrefix: 'wildshard.', storage: new PageStorage(),
    refused: () => { refused++; } }, control.port2, game.port2, () => { server.dispose(); });
  await shell.booted;
  await new Promise(resolve => { setTimeout(resolve, 500); });
  expect(shell.client.closed).toBeNull();
  expect(refused).toBe(0);
  shell.dispose();
  expect(refused).toBe(0);
});

test('a server that cannot boot says so on the control port', async () => {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.reject(new Error('no shard')) });
  const shell = connectStandalone({ slug: 'sunscar-dunes', base: '/none/', build: '', savePrefix: 'wildshard.', storage: new PageStorage() }, control.port2, game.port2, () => { server.dispose(); });
  await expect(shell.booted).rejects.toThrow('no shard');
  shell.dispose();
});

test('the worker loopback transfers its bytes rather than copying them, and carries a refusal', async () => {
  const channel = new MessageChannel(), near = new WorkerLoopback(channel.port1), far = new WorkerLoopback(channel.port2);
  const received: number[] = [];
  let closed = '';
  far.onMessage((name, bytes) => { received.push(bytes.byteLength); expect(name).toBe('unreliable'); });
  far.onClose(reason => { closed = reason; });
  const bytes = new Uint8Array(64).buffer;
  near.send('unreliable', bytes);
  expect(bytes.byteLength).toBe(0); // detached: ownership went with the message
  await until(() => received.length === 1);
  expect(near.stats.sentBytes).toBe(64); expect(far.stats.recvBytes).toBe(64);
  near.close('reload');
  await until(() => closed === 'reload');
});
