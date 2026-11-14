import type { StandaloneGrid } from '../src/server/host/standalone/gridServer';
import { runtimeAssets } from './fixtures/engine-lift/folder';
// oxlint-disable-next-line import/no-nodejs-modules -- The server half runs the shipped product bytes and physics module.
import { loadHeadlessFolder } from '@wildshard/engine/host/headlessFolder';
import { createTrustedHeadlessResident,type HeadlessRuntimeInput,type TrustedHeadlessResident } from '@wildshard/engine/host/headlessRuntime';
import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import * as v from 'valibot';
import { beforeAll,expect,onTestFinished,test,vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { connectStandalone,type StandaloneShell } from '../src/client/host/standalone/shell';
import { CommandQueue } from '../src/server/engine/net/commandQueue';
import { HitHistory } from '../src/server/engine/net/hitHistory';
import { LedgerBook,LedgerBookSchema } from '../src/server/engine/net/ledgerBook';
import { CLIENT_FLOOD_DEBT,CLIENT_MESSAGES_PER_TICK,MAX_CLIENT_MESSAGE_BYTES,MAX_CLIENT_MESSAGES,NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { ledgerFilings } from '../src/server/host/standalone/ledgerFilings';
import { runStandaloneServer } from '../src/server/host/standalone/serverHost';
import { type NetTravel } from '../src/shared/engine/net/messages';
import { actMessage, commandsMessage } from '../src/shared/engine/net/wireMessages';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import type { SaveStorage } from '../src/shared/engine/saves/store';
import { actRoutes } from '../src/shared/engine/sim/actRoutes';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { serializeSimSnapshot,snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { stepResident } from '../src/shared/host/standalone/netInput';
import { directLoopback,type DirectLoopback } from '../src/test/engine/netLoopback';
import { builtFolder } from './fixtures/engine-lift/folder';
import { bakedGridCollision } from './fixtures/gridCollision';
import { Fuzz,Hostile } from './fixtures/net-hostile';
import { ownedSetup } from './fixtures/ownedSetup';

// The server's law: every byte a client sends is hostile, and none of them ends the room. Real products on a real resident,
// over the real codec. Two clients fuzz every path in, as the lead and as another player, while a third just plays.
// NET_FUZZ_SEEDS=1,2,3 NET_FUZZ_TICKS=3000 runs it for longer; any failure replays from its seed.

const SEEDS = (process.env['NET_FUZZ_SEEDS'] ?? '20261105').split(',').map(Number), TICKS = Number(process.env['NET_FUZZ_TICKS'] ?? 120);
const CLOCK = (): number => 0;

let rapier: Rapier;
const products = new Map<string, HeadlessRuntimeInput>();
// TS11 / FL20: each fuzzed product is read once, before the cases, as every later case already shares it. The cases'
// 10 s then time the room, the hostile ticks, the save and the restore, not a cold product read (0.35 s of the Nalati
// case's ~3 CPU-s, three times that at load 50).
const FUZZED = ['pine-hollow', 'nalati-grasslands', 'sunscar-dunes', 'driftwood-isle', 'nine-dragon-stack'] as const;
beforeAll(async () => {
  rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  for (const slug of FUZZED) await product(slug);
});
// Immutable products may be shared; each case retires its own native worlds,
// including a construction that settles after the case has already failed.
function resident(input: HeadlessRuntimeInput, snapshot?: string): Promise<TrustedHeadlessResident> {
  const setup = ownedSetup(() => createTrustedHeadlessResident(input, snapshot, { room: true }), live => Promise.resolve(live.dispose()));
  onTestFinished(() => setup.close());
  return setup.open();
}
async function product(slug: string): Promise<HeadlessRuntimeInput> {
  const held = products.get(slug);
  if (held !== undefined) return held;
  const directory = builtFolder(slug), loaded = await loadHeadlessFolder(directory), descriptor = outputDescriptor(loaded.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = runtimeAssets(loaded, directory);
  const input = { shard: loaded.shardfile, assets, rapier, product: loaded };
  products.set(slug, input);
  return input;
}

interface Seat { readonly link: DirectLoopback; readonly net: NetClient; readonly id: number }
/** A room as `StandaloneGrid` runs one, on a fresh resident. */
async function roomOn(slug: string): Promise<{ live: TrustedHeadlessResident; room: NetRoom; world: SimNetWorld; book: LedgerBook; seat: (player?: string, name?: string) => Seat }> {
  const live = await resident(await product(slug)), { host } = live, lead = leadPlayer(host), book = new LedgerBook();
  host.respawn.served = true;
  const world = new SimNetWorld(host, 0, () => ledgerFilings(host, lead.id, live.effects, null)), room = new NetRoom({ world, book, step: inputs => { stepResident(live, lead.id, inputs); } });
  room.open();
  return { live, room, world, book, seat: (player, name = 'Player') => {
    const link = directLoopback(), id = room.join(link.server, player === undefined ? world.player : world.playerOf(host.addPlayer(player, lead.position).id)), net = new NetClient(link.client, CLOCK);
    net.hello('', { player: player ?? 'lead', name }); link.pump();
    return { link, net, id };
  } };
}
const spots = (live: TrustedHeadlessResident): readonly { readonly x: number; readonly z: number }[] => [...live.host.entities.values()].map(body => body.position).filter(at => Number.isFinite(at.x) && Number.isFinite(at.z));

test.each(FUZZED.flatMap(slug => SEEDS.map(seed => [slug, seed] as const)))('hostile clients on %s (seed %d) end nothing', { timeout: 10_000 }, async (slug, seed) => {
  const rewinds = vi.spyOn(HitHistory.prototype, 'at');
  const { live, room, book, seat } = await roomOn(slug), { host } = live, fuzz = new Fuzz(seed), lead = leadPlayer(host), interactions = [...actRoutes(host).interactions.keys()];
  const first = seat(), second = seat('bot:rival', 'Rival'), clean = seat('bot:clean', 'Clean'), rival = host.players.get('bot:rival'), honest = host.players.get('bot:clean');
  if (rival === undefined || honest === undefined) throw new Error('Missing seat');
  const hostile = [new Hostile(first.net), new Hostile(second.net)], links = [first.link, second.link], places = spots(live), start = honest.position.clone();
  const pump = (): void => { for (const { pump: run } of [...links, clean.link]) run(); };
  const step = (): void => { room.tick(); pump(); };
  let sent = 0, frames = 0, worst = 0;
  clean.net.onFrame(() => { frames++; });
  for (let tick = 0; tick < TICKS; tick++) {
    if (tick % 200 === 0) fuzz.nasty = fuzz.pick([0, 0.02, 0.3]);
    if (tick % 40 === 0) for (const body of [lead, rival]) {
      // somewhere with something to reach, then a blow that sometimes kills: every act lands in every state
      const spot = fuzz.chance(0.7) && places.length > 0 ? fuzz.pick(places) : { x: body.position.x + fuzz.int(100) - 50, z: body.position.z + fuzz.int(100) - 50 };
      body.resetPose({ x: spot.x + 1, y: host.groundHeightAt(spot.x + 1, spot.z + 1) + 0.2, z: spot.z + 1 }, fuzz.int(7));
      if (fuzz.chance(0.2)) host.combat.hit({ source: 'env', sourceTags: [], target: body.health, amount: 1e6, point: body.position.clone(), dir: new Vector3(0, 0, 1) });
    }
    clean.net.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); clean.net.flush(); sent++;
    hostile.forEach((client, at) => {
      const burst = tick % 97 === 0 ? 200 : 1 + fuzz.int(6), link = links[at];
      if (link === undefined) throw new Error('Missing link');
      for (let index = 0; index < burst; index++) link.client.send('reliable', client.any(fuzz, host.state.tick, interactions));
    });
    pump();
    const before = rewinds.mock.calls.length;
    step();
    worst = Math.max(worst, rewinds.mock.calls.length - before);
  }
  // The room kept ticking, and refused what it should have, and said so.
  expect(host.state.tick).toBe(TICKS);
  expect(room.stats.refused).toBeGreaterThan(TICKS);
  expect(room.admission.refused + room.admission.duplicates).toBeGreaterThan(0);
  expect(room.stats.dropped, 'floods this short earn no drop').toBe(0);
  // The honest player never noticed: every command applied in order, every frame arrived, and it walked.
  expect(room.lastSeq(clean.id)).toBe(sent);
  expect(frames).toBe(TICKS / 2);
  expect(clean.net.closed).toBeNull();
  expect(honest.position.distanceTo(start)).toBeGreaterThan(5);
  // A rewind is a read of the roster per shot, and a client earns one shot a tick however much it sends.
  expect(worst).toBeLessThanOrEqual(64);
  // M8: what outlives the room is intact. The save restores, and the book is what it should be.
  const snapshot = serializeSimSnapshot(snapshotSimHostBytes(host));
  const back = await resident(await product(slug), snapshot);
  expect(back.host.state.tick).toBe(TICKS);
  expect([...back.host.players.keys()]).toEqual([...host.players.keys()]);
  back.step([]);
  const saved = v.parse(LedgerBookSchema, book.snapshot());
  for (const { serial, rows } of Object.values(saved)) {
    expect(new Set(rows.map(row => row.id)).size).toBe(rows.length);
    expect(rows.at(-1)?.serial ?? 0).toBe(serial);
  }
});

// M8's half that a refusal touches: what a client's own state says it has applied, and nothing else, while it sends rubbish.
test('refusals leave lastSeq exact, and the good half of a refused command stands', async () => {
  const { live, room, seat } = await roomOn('pine-hollow'), plain = seat('bot:plain'), mixed = seat('bot:mixed'), { host } = live;
  const walk = { viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: 1, pitch: 0, buttons: 0 };
  const start = (id: string): Vector3 => { const body = host.players.get(id); if (body === undefined) throw new Error('Missing seat'); return body.position; };
  start('bot:mixed').copy(start('bot:plain')).add(new Vector3(3, 0, 0));
  const a = start('bot:plain').clone(), b = start('bot:mixed').clone();
  for (let tick = 0; tick < 120; tick++) {
    plain.net.command(walk); plain.net.flush();
    const seq = mixed.net.command({ ...walk, launcher: { slot: 29, ads: 1, fire: true } }); mixed.net.flush();
    const { client } = mixed.link;
    client.send('reliable', actMessage({ kind: 'reload', seq, slot: 29 }).buffer);
    client.send('reliable', actMessage({ kind: 'interact', seq, id: 'nobody' }).buffer);
    client.send('reliable', Uint8Array.of(2, 1).buffer);
    // v1 cannot carry a NaN yaw (the angle codec writes a word); the stale half is still refused by its seq.
    client.send('unreliable', commandsMessage(0, [{ ...walk, seq: seq - 1 }, { ...walk, seq, yaw: Number.NaN }], () => 0).buffer);
    plain.link.pump(); mixed.link.pump();
    room.tick();
    plain.link.pump(); mixed.link.pump();
    expect(room.lastSeq(mixed.id)).toBe(seq);
  }
  const walked = (from: Vector3, id: string): number => from.distanceTo(start(id));
  expect(walked(b, 'bot:mixed')).toBeCloseTo(walked(a, 'bot:plain'), 1);
  expect(room.lastSeq(mixed.id)).toBe(room.lastSeq(plain.id));
  expect(room.stats.refused).toBeGreaterThanOrEqual(240);
  expect(room.admission.duplicates).toBeGreaterThanOrEqual(120);
});

test('a flood is refused unread, then its sender is dropped, and the room goes on', async () => {
  const { live, room, world, seat } = await roomOn('pine-hollow'), { host } = live, clean = seat('bot:clean', 'Clean');
  const admits = vi.fn(), queue = new class extends CommandQueue { override admit(commands: Parameters<CommandQueue['admit']>[0]): void { admits(); super.admit(commands); } }();
  const link = directLoopback(), flooder = new NetClient(link.client, CLOCK);
  room.join(link.server, world.playerOf(host.addPlayer('bot:flood', host.level.player.at).id), queue);
  flooder.hello('', { player: 'flood', name: 'Flood' }); link.pump();
  const hostile = new Hostile(flooder), fuzz = new Fuzz(7);
  for (let index = 0; index < 1000; index++) link.client.send('reliable', hostile.commands(fuzz, 0));
  link.pump();
  expect(admits.mock.calls.length, 'one message of its allowance went on the hello').toBeLessThan(MAX_CLIENT_MESSAGES);
  expect(room.stats.refused).toBeGreaterThanOrEqual(1000 - MAX_CLIENT_MESSAGES);
  expect(flooder.closed).toBeNull();
  // it earns its way back at the published rate
  const paid = admits.mock.calls.length;
  for (let tick = 0; tick < 200; tick++) room.tick();
  const refused = room.stats.refused;
  link.client.send('reliable', commandsMessage(0, [], () => 0).buffer);
  link.pump();
  expect(admits.mock.calls.length).toBe(paid + 1);
  expect(room.stats.refused).toBe(refused);
  // a client that will not stop is sent away; nobody else notices
  for (let index = 0; index < MAX_CLIENT_MESSAGES - CLIENT_FLOOD_DEBT + CLIENT_MESSAGES_PER_TICK; index++) link.client.send('reliable', new ArrayBuffer(1));
  link.pump();
  expect(flooder.closed).toBe('refused');
  expect(room.stats.dropped).toBe(1);
  const tick = host.state.tick;
  room.tick(); clean.link.pump();
  expect(host.state.tick).toBe(tick + 1);
  expect(clean.net.closed).toBeNull();
});

test('a message past the longest real one is refused unread', async () => {
  const { room, seat } = await roomOn('pine-hollow'), { link } = seat();
  link.client.send('reliable', new Uint8Array(MAX_CLIENT_MESSAGE_BYTES + 1).fill(3).buffer);
  link.pump();
  expect(room.stats.refused).toBe(1);
});

class PageStorage implements SaveStorage {
  readonly items = new Map<string, string>();
  get length(): number { return this.items.size; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  setItem(key: string, value: string): void { this.items.set(key, value); }
  removeItem(key: string): void { this.items.delete(key); }
}
function worker(slug: string, storage: SaveStorage, input: HeadlessRuntimeInput): { shell: StandaloneShell; control: MessagePort; game: MessagePort; refused: () => number; close: () => void } {
  const control = new MessageChannel(), game = new MessageChannel();
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input) });
  const shell = connectStandalone({ slug, base: `/shards/${slug}/`, build: 'test', savePrefix: 'wildshard.', storage, lone: true }, control.port2, game.port2, () => { server.dispose(); });
  let closed = false;
  const close = (): void => { if (!closed) { closed = true; shell.dispose(); } };
  onTestFinished(close);
  return { control: control.port2, game: game.port2, refused: server.refused, shell, close };
}
const until = async (ready: () => boolean): Promise<void> => { await vi.waitFor(() => { expect(ready()).toBe(true); }, { timeout: 8_000, interval: 5 }); };

// The whole worker, over real MessagePorts: a native cell and a data cell, whose input takes different roads to the tick.
test.each([['native', 'pine-hollow'], ['data', 'pastel-plain']])('the %s worker takes hostile bytes on both ports, keeps ticking and saves', { timeout: 10_000 }, async (_kind, slug) => {
  const input = await product(slug), storage = new PageStorage(), { shell, control, game, refused, close } = worker(slug, storage, input), { client } = shell;
  await shell.booted; shell.ready();
  await until(() => client.latest !== null);
  const hostile = new Hostile(client), fuzz = new Fuzz(SEEDS[0] ?? 1), last = client.latest?.tick ?? 0;
  for (let index = 0; index < 600; index++) {
    const bytes = hostile.any(fuzz, client.latest?.tick ?? 0, ['nobody', 'castaway.talk']);
    if (fuzz.chance(0.9)) shell.transport.send('reliable', bytes);
    else game.postMessage(fuzz.pick([null, 7, 'bytes', { channel: 'reliable' }, { channel: 'sideways', bytes: new ArrayBuffer(1) }, { channel: 'reliable', bytes: 'none' }]), []);
    if (fuzz.chance(0.2)) control.postMessage(fuzz.pick([null, 7, { kind: 'nope' }, { kind: 'save' }, { kind: 'probe', id: -1 }, { kind: 'probe', id: 9 }, { kind: 'written', seq: 1e9, ok: true }, { kind: 'written', seq: 'a', ok: 1 }, { kind: 'boot', slug: 'other', base: '/', build: '', savePrefix: 'x', saves: {} }, { kind: 'ready' }, { kind: 'resume' }]), []);
    if (index % 40 === 0) await new Promise(resolve => { setTimeout(resolve, 0); });
  }
  await until(() => (client.latest?.tick ?? 0) > last + 30);
  expect(client.closed).toBeNull();
  expect(refused()).toBeGreaterThan(0);
  expect(await shell.save()).toMatchObject({ ok: true });
  close();
  // the save it made after all that is a save: the next boot resumes from it
  const again = worker(slug, storage, input);
  expect((await again.shell.booted).restored).toBe(true);
  again.close();
});

test('a client that hangs up leaves a server that still saves', { timeout: 10_000 }, async () => {
  const input = await product('pine-hollow'), storage = new PageStorage(), { shell, close } = worker('pine-hollow', storage, input);
  await shell.booted; shell.ready();
  await until(() => shell.client.latest !== null);
  shell.transport.close('hostile');
  const before = (await shell.probe()).tick;
  await new Promise(resolve => { setTimeout(resolve, 100); });
  expect((await shell.probe()).tick).toBeGreaterThan(before);
  expect(await shell.save()).toMatchObject({ ok: true });
  close();
});

// A crossing under fire: the acts and commands in flight when a player changes rooms belong to neither, and neither minds.
// Ring 2: cold pinned-road collision bake plus a real 900-tick crossing exceeds ten seconds.
test('a client crosses a seam while it fuzzes both rooms', { timeout: 60_000 }, async () => {
  const strips = await bakedGridCollision();
  const control = new MessageChannel(), game = new MessageChannel(), storage = new PageStorage();
  let running: StandaloneGrid | undefined;
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: (_boot, slug) => product(slug), strips: () => Promise.resolve(strips),
    proof: { arrival: { x: -259, y: 0, z: 0 }, booted: grid => { running = grid; } } });
  const shell = connectStandalone({ slug: 'sunscar-dunes', base: '/shards/sunscar-dunes/', build: 'test', savePrefix: 'wildshard.', storage }, control.port2, game.port2, () => { server.dispose(); });
  const { client } = shell, travels: NetTravel[] = [], hostile = new Hostile(client), fuzz = new Fuzz(SEEDS[0] ?? 1);
  const turn = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
  client.onTravel(event => { travels.push(event); });
  try {
    await shell.booted;
    const grid = running;
    if (grid === undefined) throw new Error('No booted server');
    // Keep the real control/game ports, but let this bounded tape own the clock.
    // FIFO control delivery opens the room and pauses its timer before the tape.
    shell.ready(); shell.pause(); await turn(); await turn();
    for (let tick = 0; tick < 32 && client.latest === null; tick++) { grid.tick(); await turn(); }
    expect(client.latest).not.toBeNull();
    for (let tick = 0; tick < 900 && travels.length === 0; tick++) {
      client.command({ viewTick: 0, steer: { keyX: 0, keyY: 1, stickX: 0, stickY: 0 }, yaw: -Math.PI / 2, pitch: 0, buttons: 0 }); client.flush();
      shell.transport.send('reliable', fuzz.chance(0.5) ? hostile.act(fuzz, []) : hostile.broken(fuzz, client.latest?.tick ?? 0));
      await turn(); grid.tick(); await turn();
    }
    expect(travels).toHaveLength(1);
    // The tape reaches the seam; only the actual ServerClock can prove the
    // arrived room stays alive. No test-driven tick is allowed after resume.
    const before = grid.host.state.tick;
    shell.resume();
    await new Promise(resolve => { setTimeout(resolve, 150); });
    expect(grid.host.state.tick).toBeGreaterThan(before);
    expect((await shell.probe()).tick).toBeGreaterThan(before);
    expect(client.closed).toBeNull();
  } finally { shell.dispose(); }
});

test('a save asked for before boot is told no, and the server still boots', async () => {
  const input = await product('pine-hollow'), control = new MessageChannel(), game = new MessageChannel(), heard: unknown[] = [];
  const server = runStandaloneServer({ control: control.port1, game: game.port1, load: () => Promise.resolve(input) });
  onTestFinished(() => { server.dispose(); control.port2.close(); game.port2.close(); });
  control.port2.onmessage = (event: MessageEvent<unknown>): void => { heard.push(event.data); };
  control.port2.postMessage({ kind: 'save', id: 1 }, []);
  await until(() => heard.length > 0);
  expect(heard[0]).toEqual({ kind: 'saved', id: 1, tick: 0, ok: false });
  expect(server.refused()).toBe(1);
});
