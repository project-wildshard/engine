// oxlint-disable-next-line import/no-nodejs-modules -- The address of a real localhost server.
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import { WebSocketTransport } from '../../src/client/engine/net/webSocketTransport';
import { SOCKET_SERVER_OPTIONS, SocketTransport, type SocketTransportOptions } from '../../src/server/host/dedicated/socketTransport';

/** Both ends of one real localhost socket. */
export interface SocketLink { readonly client: WebSocketTransport; readonly server: SocketTransport }
/** A real `ws` server on a free localhost port. */
export interface SocketBench {
  readonly url: string;
  /** The next socket that connects, as its server end. */
  accepted: () => Promise<SocketTransport>;
  /** Dial it with the browser's transport, and wait for the server to have the other end. */
  link: () => Promise<SocketLink>;
  /** Sockets the server still holds. */
  open: () => number;
  close: () => Promise<void>;
}
/** E7.1: the bench a socket test stands on. Node 24's global `WebSocket` is the same API a browser has. */
export async function socketBench(options: SocketTransportOptions = {}): Promise<SocketBench> {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0, ...SOCKET_SERVER_OPTIONS }), arrived: SocketTransport[] = [], waiting: ((end: SocketTransport) => void)[] = [];
  await new Promise<void>(resolve => { server.once('listening', resolve); });
  server.on('connection', socket => {
    const end = new SocketTransport(socket, options), wait = waiting.shift();
    if (wait === undefined) arrived.push(end); else wait(end);
  });
  const { port } = server.address() as AddressInfo, url = `ws://127.0.0.1:${String(port)}`;
  const accepted = async (): Promise<SocketTransport> => { const end = arrived.shift(); return end ?? await new Promise(resolve => { waiting.push(resolve); }); };
  return { url, accepted, open: () => server.clients.size, link: async () => { const client = new WebSocketTransport(url); return { client, server: await accepted() }; },
    close: async () => { for (const socket of server.clients) socket.terminate(); await new Promise(resolve => { server.close(resolve); }); } };
}
/** Yield to the sockets until every byte said on `links` has been heard. */
export async function settled(links: readonly SocketLink[]): Promise<void> {
  const quiet = (): boolean => links.every(({ client, server }) => client.stats.sentBytes === server.stats.recvBytes && server.stats.sentBytes === client.stats.recvBytes);
  while (!quiet()) await new Promise(resolve => { setImmediate(resolve); });
}
