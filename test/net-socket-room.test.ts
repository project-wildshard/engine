import { expect, test } from 'vitest';
import { WebSocket as RawSocket } from 'ws';
import { NetClient } from '../src/client/engine/net/client';
import { closeCode, closeReason, framed, SOCKET_LOST, SOCKET_RELIABLE, SOCKET_UNRELIABLE, STALL_CLOSE_BYTES } from '../src/shared/engine/net/socketFrames';
import type { NetChannel, Transport } from '../src/shared/engine/net/transport';
import { NetRoom } from '../src/server/engine/net/room';
import { SimNetWorld } from '../src/server/engine/net/simWorld';
import { createSimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { sayFightView } from '../src/shared/engine/sim/shardRows';
import { directLoopback } from '../src/test/engine/netLoopback';
import { settled, socketBench, type SocketLink } from './fixtures/socketBench';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { PLAYERS, rapier, resident, session, TICKS } from './fixtures/netSocketRoom';

// TEST-SPEED TS5 (J255): net-socket-room was 22-31 s hosted. Some cases moved to net-socket-room-limits.test.ts; the helpers are in test/fixtures/netSocketRoom.ts.
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
