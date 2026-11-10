// oxlint-disable-next-line import/no-nodejs-modules -- Exercise a real gateway socket.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Await actual socket events.
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { expect, test } from 'vitest';
import { World, type WorkerLink } from '../src/server/host/dedicated/world';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { BitWriter } from '../src/shared/engine/net/bits';
import { encodeHello } from '../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../src/shared/engine/net/netSchemas';
import { framed, SOCKET_RELIABLE, SOCKET_VOICE } from '../src/shared/engine/net/socketFrames';
import { cloudflareTurn, parseTurnServers } from '../src/server/host/dedicated/voiceRelay';
import type { WorkerNews } from '../src/server/host/dedicated/cellProtocol';

// Exercise the gateway's actual socket and worker protocol, with a deliberately late find reply.
test('a returning socket closed during find cannot replace its held body', async () => {
  let news: (row: WorkerNews) => void = () => undefined, reply: () => void = () => undefined;
  let seated: () => void = () => undefined;
  const firstSeat = new Promise<void>(resolve => { seated = resolve; });
  let seats = 0, found: () => void = () => undefined;
  const looking = new Promise<void>(resolve => { found = resolve; });
  const ports: MessagePort[] = [];
  const boot = (): WorkerLink => ({ listen: heard => { news = heard; queueMicrotask(() => { news({ kind: 'booted', ms: 0 }); }); }, stop: () => undefined,
    send: order => {
      if (order.kind === 'find') {
        reply = () => { news({ kind: 'found', id: order.id, held: true, spawn: { x: 0, y: 0, z: 0, yaw: 0 } }); };
        found();
      } else if (order.kind === 'seat') { seats++; ports.push(order.port); seated(); }
    } });
  const world = await World.open({ build: 'bench', cells: ['driftwood-isle'], workers: 1, seats: 32, secret: 'test', saves: memoryPlayerSaves(), boot, log: () => undefined, crashed: error => { throw error; }, restart: () => undefined });
  let upgrades = 0, closedSecond: () => void = () => undefined;
  const secondClosed = new Promise<void>(resolve => { closedSecond = resolve; });
  const server = createServer(); server.on('upgrade', (request, socket, head) => {
    if (++upgrades === 2) socket.on('close', closedSecond);
    world.upgrade(request, socket, head);
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No port');
  // The previous connection already seated this identity; only the gateway's public worker news is used.
  // Feed a normal initial seat through its load handshake first.
  const first = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
  const hello = (): Uint8Array => framed(SOCKET_RELIABLE, encodeHello(new BitWriter(), { schemaHash: NET_SCHEMA_HASH, build: 'bench', player: 'device:returning', name: 'Returning', ledger: 0 }));
  try {
    await once(first, 'open'); first.send(hello()); await looking; reply();
    await once(first, 'message'); first.send(Buffer.from([5]));
    await firstSeat;
    first.close(); await once(first, 'close');
    let foundAgain: () => void = () => undefined;
    const nextFind = new Promise<void>(resolve => { foundAgain = resolve; }); found = foundAgain;
    const next = new WebSocket(`ws://127.0.0.1:${String(address.port)}`);
    await once(next, 'open'); next.send(hello()); await nextFind;
    next.close(); await once(next, 'close'); await secondClosed;
    await new Promise<void>(resolve => { setImmediate(resolve); }); reply();
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(seats).toBe(1);
  } finally { first.terminate(); world.dispose(); for (const port of ports) port.close(); server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); }
});

// J218: voice chat's signalling rides the gateway's sockets. Two players in one cell meet; a third in another cell can't be reached.
test('voice signalling joins, relays inside one cell and says leave on close', async () => {
  const ports: MessagePort[] = [];
  const cellOf: Readonly<Record<string, string>> = { 'device:a': 'driftwood-isle', 'device:b': 'driftwood-isle', 'device:c': 'dunes' };
  // Each row of the worker table hears its own news.
  const boot = (): WorkerLink => { let news: (row: WorkerNews) => void = () => undefined; return { listen: heard => { news = heard; queueMicrotask(() => { heard({ kind: 'booted', ms: 0 }); }); }, stop: () => undefined,
    send: order => {
      if (order.kind === 'find') queueMicrotask(() => { news({ kind: 'found', id: order.id, held: false, spawn: { x: 0, y: 0, z: 0, yaw: 0 } }); });
      else if (order.kind === 'seat') ports.push(order.port);
    } }; };
  const saves = { ...memoryPlayerSaves(), where: (device: string) => Promise.resolve(cellOf[device] ?? null) };
  const world = await World.open({ build: 'bench', cells: ['driftwood-isle', 'dunes'], workers: 1, seats: 32, secret: 'test', saves, boot, log: () => undefined, crashed: error => { throw error; }, restart: () => undefined,
    voiceIce: () => Promise.resolve([{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }]) });
  const server = createServer(); server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No port');
  type Word = { readonly k: string; readonly id?: string; readonly ice?: unknown; readonly peers?: unknown[]; readonly m?: number };
  const sockets: WebSocket[] = [];
  const join = async (device: string, name: string): Promise<{ socket: WebSocket; words: Word[]; next: (k: string) => Promise<Word>; say: (word: object) => void }> => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}`, { headers: { 'cf-connecting-ip': `10.0.0.${String(sockets.length + 1)}` } }); sockets.push(socket);
    const words: Word[] = [], waiting: { k: string; resolve: (word: Word) => void }[] = [];
    socket.on('message', (data: Buffer) => {
      if (data[0] === 4) { socket.send(Buffer.from([5])); return; }
      if (data[0] !== SOCKET_VOICE) return;
      const word = JSON.parse(data.subarray(1).toString()) as Word; const at = waiting.findIndex(row => row.k === word.k);
      if (at >= 0) { waiting.splice(at, 1)[0]?.resolve(word); } else words.push(word);
    });
    const next = (k: string): Promise<Word> => { const at = words.findIndex(word => word.k === k); if (at >= 0) return Promise.resolve(words.splice(at, 1)[0] as Word); return new Promise(resolve => { waiting.push({ k, resolve }); }); };
    await once(socket, 'open');
    socket.send(framed(SOCKET_RELIABLE, encodeHello(new BitWriter(), { schemaHash: NET_SCHEMA_HASH, build: 'bench', player: device, name, ledger: 0 })));
    return { socket, words, next, say: word => { socket.send(Buffer.concat([Buffer.from([SOCKET_VOICE]), Buffer.from(JSON.stringify(word))])); } };
  };
  try {
    const a = await join('device:a', 'Jake'), b = await join('device:b', 'Matt'), c = await join('device:c', 'Stranger');
    const aId = String((await a.next('you')).id), bId = String((await b.next('you')).id), cId = String((await c.next('you')).id);
    a.say({ k: 'join' });
    const hi = await a.next('hi');
    expect(hi.ice).toEqual([{ urls: 'turn:turn.example:3478', username: 'u', credential: 'c' }]);
    expect(hi.peers).toEqual([]);
    // B hears A is on voice without joining: the prompt says who to join.
    let roster = await b.next('roster');
    while ((roster.peers ?? []).length === 0) roster = await b.next('roster');
    expect(roster.peers).toEqual([{ id: aId, name: 'Jake' }]);
    b.say({ k: 'join' });
    expect((await b.next('hi')).peers).toEqual([aId]);
    b.say({ k: 'sig', to: aId, m: 1, i: 0, n: 1, d: '{"type":"offer"}' });
    expect(await a.next('sig')).toEqual({ k: 'sig', from: bId, m: 1, i: 0, n: 1, d: '{"type":"offer"}' });
    // Another cell is out of reach, joined or not.
    c.say({ k: 'join' }); expect((await c.next('hi')).peers).toEqual([]);
    c.say({ k: 'sig', to: aId, m: 2, i: 0, n: 1, d: 'x' }); a.say({ k: 'sig', to: cId, m: 3, i: 0, n: 1, d: 'y' });
    b.say({ k: 'sig', to: aId, m: 4, i: 0, n: 1, d: 'after' });
    expect((await a.next('sig')).m).toBe(4);
    expect(c.words.filter(word => word.k === 'sig')).toEqual([]);
    expect(world.health().voice).toBe(3);
    b.socket.close(); await once(b.socket, 'close');
    let left = await a.next('roster');
    while ((left.peers ?? []).length !== 1) left = await a.next('roster');
    expect(left.peers).toEqual([{ id: aId, name: 'Jake' }]);
  } finally { for (const socket of sockets) socket.terminate(); world.dispose(); for (const port of ports) port.close(); server.closeAllConnections(); await new Promise(resolve => { server.close(resolve); }); }
});

test('Cloudflare TURN answers parse, and credentials are shared while they last', async () => {
  expect(parseTurnServers({ iceServers: { urls: ['turn:a'], username: 'u', credential: 'c' } })).toEqual([{ urls: ['turn:a'], username: 'u', credential: 'c' }]);
  expect(parseTurnServers({ iceServers: [{ urls: 'stun:b' }, { urls: ['turn:c'], username: 'u', credential: 'c' }] })).toEqual([{ urls: 'stun:b' }, { urls: ['turn:c'], username: 'u', credential: 'c' }]);
  expect(() => parseTurnServers({ nope: 1 })).toThrow();
  let calls = 0, clock = 0;
  const ice = cloudflareTurn('key', 'token', { ttlSeconds: 100, now: () => clock, fetch: (() => { calls++; return Promise.resolve(new Response(JSON.stringify({ iceServers: [{ urls: 'turn:x', username: 'u', credential: String(calls) }] }))); }) as typeof fetch });
  const [first, second] = await Promise.all([ice(), ice()]);
  expect(calls).toBe(1); expect(first).toBe(second);
  expect(first?.at(-1)).toEqual({ urls: 'turn:x', username: 'u', credential: '1' });
  clock = 49_000; await ice(); expect(calls).toBe(1);
  clock = 51_000; expect((await ice()).at(-1)).toEqual({ urls: 'turn:x', username: 'u', credential: '2' });
});

test('voice holds eight places in a cell even when nine join at once', async () => {
  const { VoiceRelay } = await import('../src/server/host/dedicated/voiceRelay');
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const relay = new VoiceRelay(async () => { await gate; return []; });
  const heard: string[][] = [], sends: ((bytes: ArrayBuffer) => void)[] = [];
  for (let index = 0; index < 9; index++) {
    const words: string[] = []; heard.push(words);
    relay.attach({ control: (_control, bytes) => { words.push(new TextDecoder().decode(bytes)); },
      onControl: listener => { sends.push(bytes => { listener('voice', bytes); }); return () => undefined; }, onClose: () => () => undefined }, 'cell', `P${String(index)}`);
  }
  for (const send of sends) send(new TextEncoder().encode('{"k":"join"}').buffer);
  release(); await gate; await new Promise(resolve => { setImmediate(resolve); });
  expect(heard.filter(words => words.some(word => word.includes('"k":"full"')))).toHaveLength(1);
  expect(relay.talking).toBe(8);
});
