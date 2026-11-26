// oxlint-disable-next-line import/no-nodejs-modules -- Exercise a real door socket and its HTTP route.
import { createServer, type IncomingMessage, type Server } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- Await actual socket events.
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { afterEach, expect, test, vi } from 'vitest';
import { AGENTS_REFUSED, agentsRefusedOn, carriesAgentMarker, classifyActor } from '../src/shared/engine/app/actor';
import { World, type WorkerLink } from '../src/server/host/dedicated/world';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { SocketTransport } from '../src/server/host/dedicated/socketTransport';
import { zoneSelectPressRoute } from '../src/server/host/dedicated/zoneSelectPress';
import { encodeDeviceWord } from '../src/shared/engine/net/deviceWord';

// QA 11-25 row 124 (J205, J209): production is humans only. On 2026-11-26 a lane's marked headless boots of
// play.wildshard.io went past the title; nothing reached a room, but nothing at the door would have stopped one.
const HUMAN = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/605.1';
const servers: Server[] = [], worlds: World[] = [];
afterEach(async () => {
  for (const world of worlds.splice(0)) world.dispose();
  await Promise.all(servers.splice(0).map(server => { server.closeAllConnections(); server.close(); return once(server, 'close'); }));
});

const boot = (): WorkerLink => ({ listen: heard => { queueMicrotask(() => { heard({ kind: 'booted', ms: 0 }); }); }, stop: () => undefined, send: () => undefined });

async function door(refuseAgents: boolean): Promise<{ url: string; world: World }> {
  const world = await World.open({ build: 'bench', cells: ['driftwood-isle'], workers: 1, seats: 8, secret: 'test', saves: memoryPlayerSaves(), boot,
    log: () => undefined, crashed: error => { throw error; }, restart: () => undefined, allowedOrigins: null, refuseAgents });
  worlds.push(world);
  const server = createServer(); servers.push(server);
  server.on('upgrade', (request, socket, head) => { world.upgrade(request, socket, head); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No port');
  return { url: `ws://127.0.0.1:${String(address.port)}`, world };
}

/** Opened, or the door's status and words. */
async function dial(url: string, headers: Record<string, string>): Promise<{ readonly opened: WebSocket } | { readonly status: number; readonly body: string }> {
  const socket = new WebSocket(url, { headers });
  return await new Promise((resolve, reject) => {
    socket.once('open', () => { resolve({ opened: socket }); });
    socket.once('unexpected-response', (_request, response: IncomingMessage) => {
      let body = ''; response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => { resolve({ status: response.statusCode ?? 0, body }); socket.terminate(); });
    });
    socket.once('error', reject);
  });
}

const MARKED: readonly (readonly [string, string, Record<string, string>])[] = [
  ['user agent', '', { 'user-agent': `${HUMAN} WildshardAgent/1 (opus-lane)` }],
  ['header', '', { 'user-agent': HUMAN, 'x-wildshard-agent': 'opus-lane' }],
  ['query', '/?agent=opus-lane', { 'user-agent': HUMAN }],
];

test('only production refuses agents, and only on a marker an agent sets on purpose', () => {
  expect(agentsRefusedOn('production')).toBe(true);
  for (const channel of ['staging', 'preview', 'local']) expect(agentsRefusedOn(channel)).toBe(false);
  expect(carriesAgentMarker(classifyActor({ userAgent: `${HUMAN} WildshardAgent/1` }))).toBe(true);
  expect(carriesAgentMarker(classifyActor({ userAgent: HUMAN, query: 'lane' }))).toBe(true);
  expect(carriesAgentMarker(classifyActor({ userAgent: HUMAN, stored: 'lane' }))).toBe(true);
  // A guess is not a marker: a headless or webdriver browser is counted as an agent, but never turned away for it.
  expect(carriesAgentMarker(classifyActor({ userAgent: 'Mozilla/5.0 HeadlessChrome/140' }))).toBe(false);
  expect(carriesAgentMarker(classifyActor({ userAgent: HUMAN, webdriver: true }))).toBe(false);
  expect(carriesAgentMarker(classifyActor({ userAgent: HUMAN }))).toBe(false);
});

test.each(MARKED)('a production door refuses a socket marked by its %s, in plain words', async (_carrier, path, headers) => {
  const { url, world } = await door(true);
  expect(await dial(`${url}${path}`, headers)).toEqual({ status: 403, body: AGENTS_REFUSED });
  expect(world.refusals).toEqual({ agent: 1 });
  const human = await dial(url, { 'user-agent': HUMAN });
  expect('opened' in human).toBe(true);
  if ('opened' in human) human.opened.terminate();
});

test.each(MARKED)('a staging or local door still lets an agent marked by its %s in', async (_carrier, path, headers) => {
  const { url, world } = await door(false);
  const agent = await dial(`${url}${path}`, headers);
  expect('opened' in agent).toBe(true);
  if ('opened' in agent) agent.opened.terminate();
  expect(world.refusals).toEqual({});
});

test('a production door closes a socket whose device word says agent', async () => {
  const { url, world } = await door(true);
  const dialled = await dial(url, { 'user-agent': HUMAN });
  if (!('opened' in dialled)) throw new Error(`refused ${String(dialled.status)}`);
  const closed = once(dialled.opened, 'close');
  new SocketTransport(dialled.opened).control('device', encodeDeviceWord({ actor: 'agent', lane: 'opus-lane', build: 'bench' }));
  await closed;
  expect(world.refusals).toEqual({ agent: 1 });
});

test('a production Zone Select press from a marked agent is refused and counts nothing; staging counts it', async () => {
  const play = 'https://play.wildshard.io', press = vi.fn();
  const route = (channel: 'production' | 'staging', refuseAgents: boolean): ReturnType<typeof zoneSelectPressRoute> =>
    zoneSelectPressRoute({ channel, allowedOrigins: [play], trustProxy: 'none', enterable: () => true, press, refuseAgents });
  for (const [channel, refuse] of [['production', true], ['staging', false]] as const) {
    const handle = route(channel, refuse), server = createServer((request, response) => { if (!handle(request, response)) response.writeHead(404).end(); });
    servers.push(server); server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No port');
    const body = JSON.stringify({ slug: 'pine-hollow', channel });
    const send = async (headers: Record<string, string>, query = ''): Promise<{ status: number; text: string }> => {
      const answer = await fetch(`http://127.0.0.1:${String(address.port)}/zone-select/enter${query}`, { method: 'POST', body, headers: { origin: play, ...headers } });
      return { status: answer.status, text: await answer.text() };
    };
    const marked = [await send({ 'user-agent': `${HUMAN} WildshardAgent/1` }), await send({ 'user-agent': HUMAN }, '?agent=lane')];
    expect(marked).toEqual(refuse ? [{ status: 403, text: AGENTS_REFUSED }, { status: 403, text: AGENTS_REFUSED }] : [{ status: 204, text: '' }, { status: 204, text: '' }]);
    expect(await send({ 'user-agent': HUMAN })).toEqual({ status: 204, text: '' });
  }
  expect(press.mock.calls.map(([, actor]: readonly unknown[]) => (actor as { actor: string }).actor)).toEqual(['human', 'agent', 'agent', 'human']);
});
