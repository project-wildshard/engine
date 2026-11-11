import { expect, test, vi } from 'vitest';
import { WebSocket as RawSocket } from 'ws';
import { NetClient } from '../src/client/engine/net/client';
import { WebSocketTransport } from '../src/client/engine/net/webSocketTransport';
import { BitWriter } from '../src/shared/engine/net/bits';
import { GUEST } from '../src/shared/engine/net/identity';
import { encodeHello } from '../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { closeReason, encodePing, framed, SOCKET_RELIABLE, STALL_CLOSE_BYTES, FRAME_SKIP_BYTES } from '../src/shared/engine/net/socketFrames';
import { NetRoom, MAX_CLIENT_MESSAGE_BYTES } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { sayFightView } from '../src/shared/engine/sim/shardRows';
import type { SocketTransport } from '../src/server/host/dedicated/socketTransport';
import { settled, socketBench } from './fixtures/socketBench';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { rapier } from './fixtures/netSocketRoom';

// TEST-SPEED TS5 (J255): net-socket-room was 22-31 s hosted. Split from net-socket-room.test.ts by case; bodies unchanged.
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
    let reason: string | null = null, otherReason: string | null = null, ticks = 0, closedAtTick = -1;
    stuckEnd.onClose(said => { reason = said; closedAtTick = ticks; });
    never.end.onClose(said => { otherReason = said; });
    const framesBefore = room.stats.frames;
    // Independent kernel send buffers need not cross the stall boundary in
    // the same tick. Both actual transports must leave before counting one.
    while ((reason === null || otherReason === null) && ticks < 200_000) {
      for (let view = 0; view < 64; view++) sayFightView(host, `load.${String(view)}`, [ticks, 2, 3, 4, 5, 6, 7, 8]);
      room.tick(); ticks++;
      await new Promise(resolve => { setImmediate(resolve); });
    }
    clearInterval(pings);
    expect(reason).toBe('stalled');
    expect(otherReason).toBe('stalled');
    console.info(`stalled client: closed at ${String(stuckEnd.stalledAt)} bytes waiting after ${String(closedAtTick)} ticks, ${String(stuckEnd.skippedFrames)} frames skipped, ${stuckEnd.stats.lossPct.toFixed(1)}% loss, sent ${String(stuckEnd.stats.sentBytes)}`);
    expect(stuckEnd.stalledAt).toBeGreaterThan(STALL_CLOSE_BYTES);
    expect(stuckEnd.stalledAt).toBeLessThan(STALL_CLOSE_BYTES + 32 * 1024);
    expect(stuckEnd.skippedFrames, `frames stop first, at ${String(FRAME_SKIP_BYTES)}`).toBeGreaterThan(0);
    expect(stuckEnd.stats.lossPct).toBeGreaterThan(0);
    expect(never.end.stalledAt).toBeGreaterThan(STALL_CLOSE_BYTES);
    expect(never.end.stalledAt).toBeLessThan(STALL_CLOSE_BYTES + 32 * 1024);
    expect(never.end.skippedFrames).toBeGreaterThan(0);
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
