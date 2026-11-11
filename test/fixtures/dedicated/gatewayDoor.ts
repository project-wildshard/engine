// oxlint-disable-next-line import/no-nodejs-modules -- Real gateway HTTP boundary.
import { createServer } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Real raw upgrades.
import { connect } from 'node:net';
// oxlint-disable-next-line import/no-nodejs-modules -- WebSocket's public per-handshake nonce.
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { World, type WorldOptions, type WorkerLink } from '../../../src/server/host/dedicated/world';
import { memoryPlayerSaves } from '../../../src/server/host/dedicated/playerSaves';
import type { CellOrder, WorkerNews } from '../../../src/server/host/dedicated/cellProtocol';
import { BitWriter } from '../../../src/shared/engine/net/bits';
import { encodeHello } from '../../../src/shared/engine/net/messages';
import { NET_SCHEMA_HASH } from '../../../src/shared/engine/net/netSchemas';
import { framed, SOCKET_RELIABLE } from '../../../src/shared/engine/net/socketFrames';

/** The header a loopback proxy of this kind sets for a client (VH10). */
const PROXY_HEADER = { caddy: 'x-forwarded-for', cloudflare: 'cf-connecting-ip', none: 'x-forwarded-for' } as const;

export async function gatewayDoor(options: Partial<WorldOptions> = {}) {
  const proxyHeader = PROXY_HEADER[options.trustProxy ?? 'caddy'];
  let news: (row: WorkerNews) => void = () => undefined;
  const seats: Extract<CellOrder, { kind: 'seat' }>[] = [], sockets: WebSocket[] = [], arrivals = new Map<string, () => void>(), closes: number[] = [];
  const boot = (): WorkerLink => ({ listen: heard => { news = heard; queueMicrotask(() => { news({ kind: 'booted', ms: 0 }); }); }, stop: () => undefined,
    send: order => { if (order.kind === 'find') queueMicrotask(() => { news({ kind: 'found', id: order.id, held: false, spawn: { x: 0, y: 0, z: 0, yaw: 0 } }); });
      else if (order.kind === 'seat') { seats.push(order); arrivals.get(order.device)?.(); } } });
  const world = await World.open({ build: 'bench', cells: ['driftwood-isle'], workers: 1, seats: 32, secret: 'test', saves: memoryPlayerSaves(), boot, log: () => undefined, crashed: error => { throw error; }, restart: () => undefined, ...options });
  const server = createServer(); server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No port');
  const upgrade = (ip: string, extra: Readonly<Record<string, string>> = {}): Promise<string> => new Promise(resolve => {
    const socket = connect(address.port, '127.0.0.1');
    socket.on('error', () => { resolve('error'); });
    socket.once('connect', () => { const headers = Object.entries({ [proxyHeader]: ip, ...extra }).map(([key, value]) => `${key}: ${value}\r\n`).join(''); socket.write(`GET / HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: ${randomBytes(16).toString('base64')}\r\n${headers}\r\n`); });
    socket.once('data', bytes => { socket.destroy(); resolve(bytes.toString().split('\r\n')[0] ?? ''); });
  });
  const admit = (ip: string, device: string, extra: Readonly<Record<string, string>> = {}): Promise<boolean> => new Promise(resolve => {
    const socket = new WebSocket(`ws://127.0.0.1:${String(address.port)}/`, { headers: { [proxyHeader]: ip, ...extra } }); sockets.push(socket);
    arrivals.set(device, () => { arrivals.delete(device); resolve(true); });
    socket.on('error', () => { arrivals.delete(device); resolve(false); });
    socket.on('close', code => { closes.push(code); arrivals.delete(device); resolve(false); });
    socket.once('open', () => { socket.send(framed(SOCKET_RELIABLE, encodeHello(new BitWriter(), { schemaHash: NET_SCHEMA_HASH, build: 'bench', player: device, name: 'Guest', ledger: 0 }))); });
    socket.once('message', () => { socket.send(Buffer.from([5])); });
  });
  return { world, seats, closes, upgrade, admit, close: async (): Promise<void> => { for (const socket of sockets) socket.terminate(); world.dispose(); for (const seat of seats) seat.port.close(); server.closeAllConnections(); await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); } };
}
