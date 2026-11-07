// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import type { NetTravel } from '../src/shared/engine/net/messages';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { GridAssembly, type GridPoint } from '../src/shared/game/grid/assembly';
import { outputDescriptor, serverReadsFile } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { connectStandalone, type StandaloneShell } from '../src/client/host/standalone/shell';
import { builtProduct } from './fixtures/builtProduct';
import { bakedGridCollision } from './fixtures/gridCollision';

// P1-E3.9, E5.2b: the grid in the server's half, over real MessagePorts on the server's own clock. A client walks off the road
// into a cell and back, hearing `travel` both ways, and a reload resumes it wherever it stood. Only a server's bytes are read.

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
const assembly = new GridAssembly({ developer: false, devserver: false });
const HOME = 'sunscar-dunes', NEIGHBOUR = 'driftwood-isle';
const cell = (slug: string): number => assembly.cells.findIndex(row => row.slug === slug) + 1;
const until = async (ready: () => boolean, timeout = 30_000): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout, interval: 5 }); };

let running: StandaloneGrid | undefined;
function start(storage: SaveStorage, arrival?: GridPoint, home = HOME, lone?: true): { shell: StandaloneShell; stop: () => void } {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => serverInput(slug), strips: bakedGridCollision, proof: { ...(arrival === undefined ? {} : { arrival }), booted: grid => { running = grid; } } });
  const shell = connectStandalone({ slug: home, base: `/shards/${home}/`, build: 'test', savePrefix: 'wildshard.', storage, ...(lone === undefined ? {} : { lone }) }, control.port2, game.port2, () => { server.dispose(); });
  return { shell, stop: () => { shell.dispose(); } };
}
/** Keep walking on a heading until `done`. Yaw π/2 is -x. */
async function walk(shell: StandaloneShell, yaw: number, done: () => boolean): Promise<void> {
  const timer = setInterval(() => { shell.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 }); shell.client.flush(); }, 16);
  try { await until(done); } finally { clearInterval(timer); }
}
const ownerX = (shell: StandaloneShell): number => { const { client } = shell, frame = client.latest; return frame === null ? Number.NaN : Number(client.owner(frame)['px']); };

// A one-shard page has one world: its player walks to the shard's own wall and stays there, in that world, on the same frame.
test.each([['a grid shard', HOME], ['a slug the grid does not place', 'pastel-plain']])('a lone cell runs %s inside its own walls', { timeout: 120_000 }, async (_name, slug) => {
  const storage = new PageStorage(), { shell, stop } = start(storage, undefined, slug, true), travels: NetTravel[] = [];
  shell.client.onTravel(event => { travels.push(event); });
  await shell.booted;
  const seat = running?.host.players.get('actor.player');
  if (seat === undefined) throw new Error('No session player');
  seat.position.set(-230, seat.position.y + 60, seat.position.z); seat.motor.resetAt(seat.position); // a minute's walk from spawn
  shell.ready();
  await until(() => shell.client.latest !== null);
  const frame = shell.client.latest?.cell;
  expect(frame).toBe(1);
  let last = ownerX(shell), still = 0;
  await walk(shell, Math.PI / 2, () => { const at = ownerX(shell); still = Math.abs(at - last) < 0.01 ? still + 1 : 0; last = at; return still > 400; });
  expect(last).toBeGreaterThan(-250);
  expect(travels).toEqual([]);
  expect(shell.client.latest?.cell).toBe(frame);
  expect((await shell.save()).ok).toBe(true);
  expect(storage.getItem(`wildshard.standalone-lone-${slug}`)?.length).toBeGreaterThan(1000);
  stop();
});

test('a player who falls out of a world is the server\'s to put back', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), { shell, stop } = start(storage, undefined, 'pastel-plain', true);
  await shell.booted;
  shell.ready();
  await until(() => shell.client.latest !== null);
  const seat = running?.host.players.get('actor.player'), host = running?.host;
  if (seat === undefined || host === undefined) throw new Error('No session player');
  seat.position.set(0, -251, 0); seat.motor.resetAt(seat.position);
  // one shard, one world: a fall is no death here, it goes back to where the player last stood
  await walk(shell, 0, () => seat.position.y > -250);
  expect(host.respawn.falls(seat.id)).toBe(0);
  stop();
});

test('a client walks off the road into a cell and back, and a reload resumes it wherever it stood', { timeout: 120_000 }, async () => {
  const storage = new PageStorage(), first = start(storage, { x: -259, y: 0, z: 0 }), travels: NetTravel[] = [], { client } = first.shell;
  client.onTravel(event => { travels.push(event); });
  expect(await first.shell.booted).toEqual({ tick: 0, restored: false });
  first.shell.ready();
  await until(() => client.latest !== null);
  expect(client.latest?.cell).toBe(0);
  await walk(first.shell, -Math.PI / 2, () => travels.length === 1);
  expect(travels[0]).toMatchObject({ from: 0, to: cell(NEIGHBOUR) });
  // cell-local now: the deck runs up to the edge of Driftwood's own world, and its colliders take over from there
  await walk(first.shell, -Math.PI / 2, () => client.latest?.cell === cell(NEIGHBOUR) && ownerX(first.shell) > -245);
  expect(client.dropped).toBe(0);
  const inside = await first.shell.save(); expect(inside.ok).toBe(true);
  const stood = ownerX(first.shell);
  first.stop();
  expect(storage.getItem(`wildshard.standalone-${NEIGHBOUR}`)?.length).toBeGreaterThan(1000);

  const second = start(storage), back: NetTravel[] = [];
  second.shell.client.onTravel(event => { back.push(event); });
  expect(await second.shell.booted).toEqual({ tick: inside.tick, restored: true });
  second.shell.ready();
  await until(() => second.shell.client.latest !== null);
  expect(second.shell.client.latest?.cell).toBe(cell(NEIGHBOUR));
  expect(Math.abs(ownerX(second.shell) - stood)).toBeLessThan(2);
  await walk(second.shell, Math.PI / 2, () => back.length === 1);
  expect(back[0]).toMatchObject({ from: cell(NEIGHBOUR), to: 0 });
  await until(() => second.shell.client.latest?.cell === 0);
  expect(ownerX(second.shell)).toBeLessThan(-250); // world coordinates again
  const road = await second.shell.save(); expect(road.ok).toBe(true);
  second.stop();

  const third = start(storage);
  expect(await third.shell.booted).toEqual({ tick: road.tick, restored: true });
  third.shell.ready();
  await until(() => third.shell.client.latest !== null);
  expect(third.shell.client.latest?.cell).toBe(0);
  third.stop();
});

// Nine has no terrain: its deck has to meet the road's, and only the plan's server files stand behind it.
test('a client walks off the road onto Nine Dragon\'s deck, and a reload resumes it there', { timeout: 120_000 }, async () => {
  const nine = assembly.cells.find(row => row.slug === 'nine-dragon-stack');
  if (nine === undefined) throw new Error('The grid places no Nine Dragon');
  const storage = new PageStorage(), first = start(storage, { x: nine.origin.x - 259, y: 0, z: nine.origin.z }), travels: NetTravel[] = [], { client } = first.shell;
  client.onTravel(event => { travels.push(event); });
  await first.shell.booted; first.shell.ready();
  await until(() => client.latest !== null);
  await walk(first.shell, -Math.PI / 2, () => travels.length === 1);
  expect(travels[0]).toMatchObject({ from: 0, to: cell('nine-dragon-stack') });
  await walk(first.shell, -Math.PI / 2, () => client.latest?.cell === cell('nine-dragon-stack') && ownerX(first.shell) > -245);
  expect(client.dropped).toBe(0);
  const inside = await first.shell.save(), stood = ownerX(first.shell);
  expect(inside.ok).toBe(true);
  first.stop();
  const second = start(storage);
  expect(await second.shell.booted).toEqual({ tick: inside.tick, restored: true });
  second.shell.ready();
  await until(() => second.shell.client.latest !== null);
  expect(second.shell.client.latest?.cell).toBe(cell('nine-dragon-stack'));
  expect(Math.abs(ownerX(second.shell) - stood)).toBeLessThan(2);
  second.stop();
});

test('J68: a world keeps its far solids as data, in its save too, and a restored one knows them again', { timeout: 60_000 }, async () => {
  const storage = new PageStorage(), first = start(storage, undefined, 'nalati-grasslands');
  await first.shell.booted; first.shell.ready();
  await until(() => (running?.near.live ?? 0) > 0 || first.shell.client.latest !== null);
  const held = running?.near.held ?? 0;
  expect(held).toBeGreaterThan(1000);
  await until(() => (first.shell.client.latest?.tick ?? 0) > 10);
  expect(running?.near.live).toBeLessThan(held / 4);
  expect((await first.shell.save()).ok).toBe(true);
  expect(storage.getItem('wildshard.standalone-nalati-grasslands')?.length).toBeLessThan(2_000_000);
  first.stop();
  const second = start(storage, undefined, 'nalati-grasslands');
  expect((await second.shell.booted).restored).toBe(true);
  expect(running?.near.held).toBe(held);
  second.stop();
});
