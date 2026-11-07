// oxlint-disable-next-line import/no-nodejs-modules -- The product and Rapier are shipped bytes.
import { readFileSync } from 'node:fs';
import { beforeAll, expect, test, vi } from 'vitest';
import { WebSocket as RawSocket } from 'ws';
import type { NetCommand } from '@wildshard/format/netCommand';
import { NetClient } from '../src/client/engine/net/client';
import { WebSocketTransport } from '../src/client/engine/net/webSocketTransport';
import { NET_BUTTONS } from '../src/shared/engine/input/netButtons';
import { BitWriter } from '../src/shared/engine/net/bits';
import { GUEST } from '../src/shared/engine/net/identity';
import { encodeHello } from '../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { closeCode, closeReason, encodePing, framed, SOCKET_LOST, SOCKET_RELIABLE, SOCKET_UNRELIABLE, STALL_CLOSE_BYTES, FRAME_SKIP_BYTES } from '../src/shared/engine/net/socketFrames';
import type { NetChannel, Transport } from '../src/shared/engine/net/transport';
import type { LedgerFiling } from '../src/server/engine/net/ledgerBook';
import { NetRoom, MAX_CLIENT_MESSAGE_BYTES } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier, type Rapier } from '../src/shared/engine/physics/rapier';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { sayFightView } from '../src/shared/engine/sim/shardRows';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type TrustedHeadlessResident } from '../src/server/host/headlessRuntime';
import { ledgerFilings } from '../src/server/host/standalone/ledgerFilings';
import { netTickCommands } from '../src/shared/host/standalone/netInput';
import { tickCommands } from '../src/shared/host/tickProtocol';
import type { SocketTransport } from '../src/server/host/dedicated/socketTransport';
import { directLoopback } from '../src/test/engine/netLoopback';
import { settled, socketBench, type SocketLink } from './fixtures/socketBench';
import { builtProduct } from './fixtures/builtProduct';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// E7.1a: `net-bots`' room on real localhost sockets. Both ends are the shipped ones, and Node 24's global `WebSocket` stands in
// for the browser's. Set WS_SOCKET_REPORT=<file> to keep the run's numbers.
const PLAYERS = 32, TICKS = 900, TARGETS = 4;
let rapier: Rapier;
beforeAll(async () => { rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm')); });

async function resident(slug: string): Promise<TrustedHeadlessResident> {
  const directory = builtProduct(slug), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ shard: product.shardfile, assets, rapier, product });
}
/** Ticks the bots stand and fight before they wander. */
const FIGHT = 600;
/** net-bots' thumb, standing to swing at a creature until the fight is over, so blows land and loot falls. */
function input(index: number, tick: number, target: string | undefined): Omit<NetCommand, 'seq'> {
  const yaw = index * 0.9 + tick / (90 + index), keyY = tick >= FIGHT && tick % 240 < 200 ? 1 : 0, phase = (tick + index * 17) % 300;
  const buttons = (keyY === 1 ? NET_BUTTONS.sprint : 0) | (phase === 40 ? NET_BUTTONS.jump : 0) | (phase === 130 ? NET_BUTTONS.dodge : 0);
  return { viewTick: 0, steer: { keyX: 0, keyY, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons,
    ...(tick < FIGHT && (tick + index) % 20 === 0 && target !== undefined ? { attack: { targetId: target, aim: { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } } } } : {}) };
}

/** A line per thing a client heard, and where each body ended up: everything a game makes of a session. */
interface Session { readonly facts: readonly (readonly string[])[]; readonly ledger: readonly (readonly string[])[]; readonly ends: readonly (readonly (number | undefined)[])[]; readonly dropped: number; readonly refused: number }

/** One room, one transport pair per bot, stepped in lockstep with `pump`: the same inputs at the same ticks, however bytes travel. */
async function session(live: TrustedHeadlessResident, pairs: readonly { readonly client: Transport; readonly server: Transport }[], pump: () => Promise<void>): Promise<Session> {
  const { host } = live, first = leadPlayer(host).id, planted: LedgerFiling[] = [];
  const world = new SimNetWorld(host, 0, () => [...planted.splice(0), ...ledgerFilings(host, first, live.effects, null)]);
  const room = new NetRoom({ world, step: inputs => {
    const [lead, ...others] = inputs, commands = new Map<string, NetCommand>();
    for (const other of others) if (other.command !== null) commands.set(other.player, other.command);
    live.step(tickCommands([{ source: 'bots', commands: netTickCommands(lead?.command ?? null, lead?.acts ?? []) }], 8), commands);
  } });
  const creatures = [...host.entities].slice(0, TARGETS);
  for (const [, creature] of creatures) creature.harnessHold = true;
  const bots = pairs.map((pair, index) => {
    const [id, creature] = creatures[index % creatures.length] ?? [], angle = index / PLAYERS * Math.PI * 8;
    if (id === undefined || creature === undefined) throw new Error('No creature');
    const at = { x: creature.position.x + Math.cos(angle) * 1.5, y: creature.position.y, z: creature.position.z + Math.sin(angle) * 1.5 };
    return { id: index === 0 ? first : host.addPlayer(`bot:${String(index)}`, at).id, target: id, client: new NetClient(pair.client, () => 0), facts: [] as string[], ledger: [] as string[], server: pair.server };
  });
  for (const bot of bots) {
    room.join(bot.server, world.playerOf(bot.id)); bot.client.hello();
    bot.client.onCombat(event => { bot.facts.push(JSON.stringify(event)); });
    bot.client.onView(event => { bot.facts.push(JSON.stringify(event)); });
    bot.client.onLedger(event => { bot.ledger.push(JSON.stringify(event)); });
  }
  await pump(); room.open(); await pump();
  for (let tick = 0; tick < TICKS; tick++) {
    if (tick % 120 === 60) for (const bot of bots) planted.push({ player: bot.id, id: `planted.${String(tick)}`, tick, grant: 'coins', name: 'coins', amount: 1 + tick, pending: false });
    bots.forEach((bot, index) => { bot.client.command(input(index, tick, bot.target)); bot.client.flush(); });
    await pump(); room.tick(); await pump();
  }
  const ends = bots.map(bot => { const frame = bot.client.latest; if (frame === null) throw new Error('No frame'); const owner = bot.client.owner(frame), body = host.players.get(bot.id); return [frame.tick, Number(owner['px']), Number(owner['py']), Number(owner['pz']), body?.position.x, frame.lastSeq, frame.rows.size]; });
  for (const bot of bots) { bot.facts.push(JSON.stringify([...bot.client.owned]), JSON.stringify([...bot.client.quests]), JSON.stringify([...bot.client.entities.keys()])); }
  const out: Session = { facts: bots.map(bot => bot.facts), ledger: bots.map(bot => bot.ledger), ends, dropped: bots.reduce((sum, bot) => sum + bot.client.dropped, 0), refused: room.admission.refused + room.stats.refused };
  room.dispose();
  return out;
}

test('a 32-player room on real sockets gives the same facts and ledger as DirectLoopback', async () => {
  const direct = Array.from({ length: PLAYERS }, () => directLoopback());
  const onDirect = await resident('driftwood-isle');
  const started = performance.now(), loopback = await session(onDirect, direct, () => { for (const link of direct) link.pump(); return Promise.resolve(); });
  const directMs = performance.now() - started;
  onDirect.dispose();
  const bench = await socketBench(), links: SocketLink[] = [];
  for (let index = 0; index < PLAYERS; index++) links.push(await bench.link());
  const onSockets = await resident('driftwood-isle'), at = performance.now(), sockets = await session(onSockets, links, () => settled(links)), socketMs = performance.now() - at;
  onSockets.dispose();
  const count = (rows: readonly (readonly string[])[]): number => rows.reduce((sum, row) => sum + row.length, 0);
  const kinds = new Map<string, number>();
  for (const row of sockets.facts) for (const line of row) { const kind = /"kind":"(\w+)"/u.exec(line)?.[1] ?? 'state'; kinds.set(kind, (kinds.get(kind) ?? 0) + 1); }
  console.info(`socket room ${String(PLAYERS)} players ${String(TICKS)} ticks: ${String(count(sockets.facts))} facts ${JSON.stringify(Object.fromEntries(kinds))}, ${String(count(sockets.ledger))} receipts, down ${(links.reduce((sum, link) => sum + link.client.stats.recvBytes, 0) / 1024).toFixed(0)} KB, loopback ${directMs.toFixed(0)} ms, sockets ${socketMs.toFixed(0)} ms`);
  expect(count(sockets.ledger), 'real grants, past the planted ones').toBeGreaterThan(PLAYERS * 7);
  expect(kinds.get('hit')).toBeGreaterThan(0);
  expect(sockets.dropped).toBe(0);
  expect(sockets.refused).toBe(loopback.refused);
  expect(sockets.ledger).toEqual(loopback.ledger);
  expect(sockets.facts).toEqual(loopback.facts);
  expect(sockets.ends).toEqual(loopback.ends);
  await bench.close();
}, 170_000);

test('a client that stops reading is closed at 256 KB and the room keeps ticking', async () => {
  const bench = await socketBench(), host = createSimHost(SIM_LEVEL, { rapier }), lead = leadPlayer(host), bot = host.addPlayer('bot:1', { x: 3, y: 0, z: 0 }), deaf = host.addPlayer('bot:2', { x: 4, y: 0, z: 0 });
  const world = new SimNetWorld(host), room = new NetRoom({ world, step: () => { host.step(); } }), writer = new BitWriter(1024);
  /** A client that will stop reading: it says hello, hears its first message, and from then on only says it is alive, as a wedged phone does. */
  const wedged = async (id: string): Promise<{ raw: RawSocket; end: SocketTransport }> => {
    const raw = new RawSocket(bench.url, { perMessageDeflate: false }), end = await bench.accepted();
    await new Promise(resolve => { raw.once('open', resolve); });
    room.join(end, world.playerOf(id));
    raw.send(framed(SOCKET_RELIABLE, encodeHello(writer, { schemaHash: NET_SCHEMA_HASH, build: '', ...GUEST, ledger: 0 })));
    return { raw, end };
  };
  try {
    const never = await wedged(deaf.id), healthy = await bench.link(), reader = new NetClient(healthy.client), { raw, end: stuckEnd } = await wedged(bot.id), perFrame = new Map<number, number>();
    room.join(healthy.server, world.playerOf(lead.id)); reader.hello();
    reader.onView(view => { perFrame.set(view.tick, (perFrame.get(view.tick) ?? 0) + 1); });
    await settled([healthy]);
    room.open();
    await Promise.all([raw, never.raw].map(socket => new Promise(resolve => { socket.once('message', resolve); })));
    raw.pause(); never.raw.pause();
    const pings = setInterval(() => { raw.send(encodePing(0, 0)); never.raw.send(encodePing(0, 0)); }, 500);
    let reason: string | null = null, ticks = 0, closedAtTick = -1;
    stuckEnd.onClose(said => { reason = said; closedAtTick = ticks; });
    const framesBefore = room.stats.frames;
    while (reason === null && ticks < 200_000) {
      for (let view = 0; view < 64; view++) sayFightView(host, `load.${String(view)}`, [ticks, 2, 3, 4, 5, 6, 7, 8]);
      room.tick(); ticks++;
      await new Promise(resolve => { setImmediate(resolve); });
    }
    clearInterval(pings);
    expect(reason).toBe('stalled');
    console.info(`stalled client: closed at ${String(stuckEnd.stalledAt)} bytes waiting after ${String(closedAtTick)} ticks, ${String(stuckEnd.skippedFrames)} frames skipped, ${stuckEnd.stats.lossPct.toFixed(1)}% loss, sent ${String(stuckEnd.stats.sentBytes)}`);
    expect(stuckEnd.stalledAt).toBeGreaterThan(STALL_CLOSE_BYTES);
    expect(stuckEnd.stalledAt).toBeLessThan(STALL_CLOSE_BYTES + 32 * 1024);
    expect(stuckEnd.skippedFrames, `frames stop first, at ${String(FRAME_SKIP_BYTES)}`).toBeGreaterThan(0);
    expect(stuckEnd.stats.lossPct).toBeGreaterThan(0);
    const tickNow = host.state.tick, frames = room.stats.frames, seen = reader.latest?.tick ?? 0;
    expect(frames).toBeGreaterThan(framesBefore);
    for (let tick = 0; tick < 30; tick++) { for (let view = 0; view < 64; view++) sayFightView(host, `load.${String(view)}`, [ticks + tick, 2, 3, 4, 5, 6, 7, 8]); room.tick(); await settled([healthy]); }
    expect(host.state.tick).toBe(tickNow + 30);
    expect(reader.latest?.tick).toBeGreaterThan(seen);
    expect(reader.dropped).toBe(0);
    expect(healthy.client.open).toBe(true);
    expect(room.stats.frames - frames, 'the room frames only the client it has left').toBe(15);
    const heard = [...perFrame.entries()].sort(([a], [b]) => a - b), [firstHeard = 0] = heard[0] ?? [];
    expect(heard.map(([tick]) => tick), 'a client that goes never costs the next in line a frame\'s events').toEqual(heard.map((_row, index) => firstHeard + index));
    expect(heard.every(([, rows]) => rows === 64)).toBe(true);
    const closed = new Promise<number>(resolve => { raw.once('close', resolve); });
    raw.resume();
    expect(closeReason(await closed), 'a client that wakes reads why').toBe('stalled');
    const started = performance.now();
    while (bench.open() > 1 && performance.now() - started < 3000) await new Promise(resolve => { setTimeout(resolve, 20); });
    expect(bench.open(), 'one that never wakes is cut off after its grace, not ws\'s 30 s').toBe(1);
  } finally { room.dispose(); host.dispose(); await bench.close(); }
}, 60_000);

test('a client that falls behind loses frames, not state: delta-against-ack heals when it reads again', async () => {
  const bench = await socketBench(), host = createSimHost(SIM_LEVEL, { rapier }), lead = leadPlayer(host), world = new SimNetWorld(host), room = new NetRoom({ world, step: () => { host.step(); } });
  try {
    const raw = new RawSocket(bench.url, { perMessageDeflate: false }), end = await bench.accepted(), listeners = new Set<(channel: NetChannel, bytes: ArrayBuffer) => void>();
    await new Promise(resolve => { raw.once('open', resolve); });
    raw.on('message', (data: Buffer) => { if (data[0] === SOCKET_RELIABLE || data[0] === SOCKET_UNRELIABLE) { const { buffer } = new Uint8Array(data.subarray(1)); for (const listener of listeners) listener(data[0] === SOCKET_RELIABLE ? 'reliable' : 'unreliable', buffer); } });
    const link: Transport = { stats: { rttMs: 0, lossPct: 0, sentBytes: 0, recvBytes: 0 }, send: (channel, bytes) => { raw.send(framed(channel === 'reliable' ? SOCKET_RELIABLE : SOCKET_UNRELIABLE, bytes)); },
      onMessage: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, onClose: () => () => undefined, close: () => undefined };
    const client = new NetClient(link);
    room.join(end, world.playerOf(lead.id)); client.hello(); room.open();
    const pump = async (): Promise<void> => { await new Promise(resolve => { setTimeout(resolve, 2); }); };
    while (client.latest === null) { room.tick(); await pump(); }
    for (let tick = 0; tick < 20; tick++) { client.flush(); room.tick(); await pump(); }
    raw.pause();
    let said = 0;
    while (end.skippedFrames < 6 && said < 200_000) { for (let view = 0; view < 64; view++) sayFightView(host, `load.${String(view)}`, [said, 2, 3, 4, 5, 6, 7, 8]); said++; room.tick(); await new Promise(resolve => { setImmediate(resolve); }); }
    const skipped = end.skippedFrames, behind = client.latest.tick;
    expect(skipped).toBeGreaterThanOrEqual(6);
    expect(end.buffered).toBeLessThan(STALL_CLOSE_BYTES);
    raw.resume();
    while (end.buffered > 1024) await pump();
    for (let tick = 0; tick < 40; tick++) { client.flush(); room.tick(); await pump(); }
    console.info(`behind: ${String(skipped)} frames skipped, then ${String(client.latest.tick - behind)} ticks caught up, ${String(client.dropped)} dropped`);
    expect(client.dropped).toBe(0);
    expect(client.latest.tick).toBeGreaterThan(host.state.tick - 4);
    expect(end.skippedFrames, 'with the backlog gone, nothing is skipped').toBe(skipped);
    raw.terminate();
  } finally { room.dispose(); host.dispose(); await bench.close(); }
}, 60_000);

test('close reasons cross the wire as the strings a room uses', async () => {
  for (const reason of ['reload', 'refused', 'full', 'replaced', 'stalled', 'restart']) expect(closeReason(closeCode(reason))).toBe(reason);
  expect(closeReason(1006)).toBe(SOCKET_LOST);
  const bench = await socketBench();
  try {
    for (const reason of ['reload', 'refused', 'full', 'replaced', 'stalled', 'restart']) {
      const { client, server } = await bench.link(), heard = new Promise<string>(resolve => { client.onClose(resolve); });
      let own = '';
      server.onClose(said => { own = said; });
      server.close(reason);
      expect(await heard).toBe(reason);
      expect(own).toBe(reason);
    }
  } finally { await bench.close(); }
});

test('a stale build is refused with `reload` over a real socket', async () => {
  const bench = await socketBench(), host = createSimHost(SIM_LEVEL, { rapier }), world = new SimNetWorld(host), room = new NetRoom({ world, step: () => { host.step(); }, build: 'new' });
  try {
    room.open();
    const { client, server } = await bench.link(), netClient = new NetClient(client), heard = new Promise<string>(resolve => { client.onClose(resolve); });
    room.join(server); netClient.hello('old');
    expect(await heard).toBe('reload');
    expect(netClient.closed).toBe('reload');
  } finally { room.dispose(); host.dispose(); await bench.close(); }
});

test('the keepalive measures a round trip, and a silent client is closed `stalled`', async () => {
  const bench = await socketBench({ silenceMs: 2000 });
  try {
    const { client, server } = await bench.link();
    await vi.waitFor(() => { expect(client.stats.rttMs).toBeGreaterThan(0); expect(server.stats.rttMs).toBeGreaterThan(0); }, { timeout: 5000, interval: 10 });
    expect(client.stats.rttMs).toBeLessThan(250);
    expect(server.stats.rttMs).toBeGreaterThan(0);
    const raw = new RawSocket(bench.url, { perMessageDeflate: false }), end = await bench.accepted(), reason = new Promise<string>(resolve => { end.onClose(resolve); });
    await new Promise(resolve => { raw.once('open', resolve); });
    expect(await reason).toBe('stalled');
  } finally { await bench.close(); }
});

test('`resume` and `ready` travel outside the game protocol, and a prefix nobody speaks is refused', async () => {
  const bench = await socketBench();
  try {
    const { client, server } = await bench.link(), game: number[] = [], controls: string[] = [];
    client.onMessage(() => { game.push(1); }); server.onMessage(() => { game.push(2); });
    client.onControl((control, bytes) => { controls.push(`client ${control} ${String(new Uint8Array(bytes)[0])}`); });
    server.onControl((control, bytes) => { controls.push(`server ${control} ${String(bytes.byteLength)}`); });
    server.control('resume', Uint8Array.of(7).buffer); client.control('ready');
    await settled([{ client, server }]);
    expect([...controls].sort()).toEqual(['client resume 7', 'server ready 0']);
    expect(game).toEqual([]);
    const raw = new RawSocket(bench.url, { perMessageDeflate: false }), end = await bench.accepted(), refused = new Promise<string>(resolve => { end.onClose(resolve); });
    await new Promise(resolve => { raw.once('open', resolve); });
    raw.send(Uint8Array.of(9, 1, 2));
    expect(await refused).toBe('refused');
  } finally { await bench.close(); }
});

test('a client past `maxPayload`, or speaking text, costs only its own socket', async () => {
  const bench = await socketBench();
  try {
    const big = new RawSocket(bench.url, { perMessageDeflate: false }), bigEnd = await bench.accepted(), tooBig = new Promise<string>(resolve => { bigEnd.onClose(resolve); });
    await new Promise(resolve => { big.once('open', resolve); });
    big.send(new Uint8Array(MAX_CLIENT_MESSAGE_BYTES + 2));
    await expect(tooBig).resolves.toBeDefined();
    const text = new RawSocket(bench.url, { perMessageDeflate: false }), textEnd = await bench.accepted(), refused = new Promise<string>(resolve => { textEnd.onClose(resolve); });
    await new Promise(resolve => { text.once('open', resolve); });
    text.send('hello');
    expect(await refused).toBe('refused');
    const { client } = await bench.link();
    expect(client).toBeInstanceOf(WebSocketTransport);
  } finally { await bench.close(); }
});
