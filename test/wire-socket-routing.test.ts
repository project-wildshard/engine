// WIRE-STABILITY WR3: wire v1 rides inside the socket wrapper's game channels and changes none of its controls. Prefixes 0
// and 1 carry game messages; 2 to 8 (ping, pong, resume, ready, countdown, playtest and voice, SOCKET_VOICE = 8) are
// controls, and their payloads never reach the game decoder, even when they look like v1 records.
import { WebSocket as NodeSocket, WebSocketServer } from 'ws';
import { afterEach, expect, test } from 'vitest';
import { WebSocketTransport } from '../src/client/engine/net/webSocketTransport';
import { SocketTransport } from '../src/server/host/dedicated/socketTransport';
import { SOCKET_COUNTDOWN, SOCKET_PING, SOCKET_PLAYTEST, SOCKET_PONG, SOCKET_READY, SOCKET_RELIABLE, SOCKET_RESUME, SOCKET_UNRELIABLE, SOCKET_VOICE, type SocketControl } from '../src/shared/engine/net/socketFrames';
import type { NetChannel } from '../src/shared/engine/net/transport';

/** A v1 client's first message: `W`, major 1, then a hello record (tag 1) with an empty body. */
const V1_HELLO = Uint8Array.of(0x57, 1, 1, 0);
/** A v1 cmds record (tag 2) with a one-byte body. */
const V1_CMDS = Uint8Array.of(2, 1, 0);
const closers: (() => void)[] = [];
afterEach(() => { for (const close of closers.splice(0)) close(); });

interface Heard { readonly game: [NetChannel, number[]][]; readonly controls: [SocketControl, number[]][] }
function listen(transport: SocketTransport | WebSocketTransport): Heard {
  const heard: Heard = { game: [], controls: [] };
  transport.onMessage((channel, bytes) => { heard.game.push([channel, [...new Uint8Array(bytes)]]); });
  transport.onControl((control, bytes) => { heard.controls.push([control, [...new Uint8Array(bytes)]]); });
  return heard;
}

const settle = async (until: () => boolean): Promise<void> => { await expect.poll(until, { timeout: 5000, interval: 10 }).toBe(true); };

async function pair(): Promise<{ readonly server: SocketTransport; readonly client: WebSocketTransport }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  closers.push(() => { wss.close(); });
  await new Promise<void>(resolve => { wss.once('listening', () => { resolve(); }); });
  const address = wss.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a port');
  const accepted = new Promise<SocketTransport>(resolve => { wss.once('connection', socket => { resolve(new SocketTransport(socket)); }); });
  const client = new WebSocketTransport(`ws://127.0.0.1:${String(address.port)}`, { socket: NodeSocket as unknown as new (url: string) => WebSocket });
  closers.push(() => { client.close(); });
  const server = await accepted;
  await settle(() => client.open);
  return { server, client };
}

test('the server routes game channels 0 and 1 to the game decoder and controls 2, 5, 7 and 8 away from it', async () => {
  const { server, client } = await pair(), heard = listen(server);
  client.send('reliable', V1_HELLO.slice().buffer);
  client.send('unreliable', V1_CMDS.slice().buffer);
  for (const control of ['ready', 'playtest', 'voice'] as const) client.control(control, V1_HELLO.slice().buffer);
  await settle(() => heard.controls.length === 3 && heard.game.length === 2);
  expect(heard.game).toEqual([['reliable', [...V1_HELLO]], ['unreliable', [...V1_CMDS]]]);
  expect(heard.controls).toEqual([['ready', [...V1_HELLO]], ['playtest', [...V1_HELLO]], ['voice', [...V1_HELLO]]]);
});

test('the client routes game channels 0 and 1 to the game decoder and controls 3, 4, 6, 7 and 8 away from it', async () => {
  const { server, client } = await pair(), heard = listen(client);
  server.send('reliable', V1_HELLO.slice().buffer);
  server.send('unreliable', V1_CMDS.slice().buffer);
  for (const control of ['resume', 'countdown', 'playtest', 'voice'] as const) server.control(control, V1_HELLO.slice().buffer);
  await settle(() => heard.controls.length === 4 && heard.game.length === 2 && client.stats.rttMs > 0);
  expect(heard.game).toEqual([['reliable', [...V1_HELLO]], ['unreliable', [...V1_CMDS]]]);
  expect(heard.controls).toEqual((['resume', 'countdown', 'playtest', 'voice'] as const).map(control => [control, [...V1_HELLO]]));
  // The ping (2) the client sent on open came back as a pong (3), measured by the wrapper: neither reached a listener.
  expect(client.stats.rttMs).toBeGreaterThan(0);
  expect(heard.game).toHaveLength(2);
});

test('the prefixes are the ones the wire carries unchanged, voice on 8', () => {
  expect([SOCKET_RELIABLE, SOCKET_UNRELIABLE, SOCKET_PING, SOCKET_PONG, SOCKET_RESUME, SOCKET_READY, SOCKET_COUNTDOWN, SOCKET_PLAYTEST, SOCKET_VOICE]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
});
