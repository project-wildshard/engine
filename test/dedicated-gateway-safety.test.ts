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
import { framed, SOCKET_RELIABLE } from '../src/shared/engine/net/socketFrames';
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
