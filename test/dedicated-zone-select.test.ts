import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import { parse } from 'valibot';
import { zoneSelectRoute } from '../src/server/host/dedicated/zoneSelect';
import { ZoneSelectSchema, type ZoneSelectCard } from '../src/shared/game/grid/zoneSelectRows';

const staging = 'https://staging.wildshard.io';
const names = (cards: readonly ZoneSelectCard[]): string[] => cards.map(card => card.slug);
const running: Server[] = [];
afterEach(async () => {
  await Promise.all(running.splice(0).map(server => {
    server.close();
    return once(server, 'close');
  }));
});

async function open(route: ReturnType<typeof zoneSelectRoute>): Promise<URL> {
  const server = createServer((request, response) => { if (!route(request, response)) response.writeHead(404).end(); });
  running.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing Zone Select test address');
  return new URL(`http://127.0.0.1:${address.port}/zone-select`);
}

test('the room door serves its own channel and counts only human arrivals for Popular', async () => {
  let serial = 5;
  const slugs = ['pine-hollow', 'driftwood-isle', 'new-shard', 'proof-town', 'test-name', '_future'];
  const uploads = vi.fn(async () => [
    { slug: 'pine-hollow', name: 'Pine Hollow', firstUploadedAt: '2026-11-15T12:00:00.000Z' },
    { slug: 'driftwood-isle', name: 'Driftwood Isle', listedNew: false, firstUploadedAt: '2026-11-18T12:00:00.000Z' },
    { slug: 'new-shard', name: 'A New Shard', firstUploadedAt: '2026-11-17T12:00:00.000Z' },
    { slug: 'test-name', name: 'test-name' },
  ]);
  const totals = vi.fn(async () => [
    { slug: 'pine-hollow', humans: 2, agents: 30, uniqueHumans: 2 },
    { slug: 'new-shard', humans: 3, agents: 0, uniqueHumans: 1 },
    { slug: 'driftwood-isle', humans: 2, agents: 0, uniqueHumans: 1 },
    { slug: 'nine-dragon-stack', humans: 100, agents: 0, uniqueHumans: 100 },
  ]);
  const door = await open(zoneSelectRoute({
    channel: 'staging', allowedOrigins: [staging], world: () => ({ serial, slugs }),
    uploads, totals, log: () => undefined,
  }));
  door.searchParams.set('channel', 'production');
  const replies = await Promise.all(Array.from({ length: 2 }, () => fetch(door, { headers: { origin: staging } })));
  for (const reply of replies) {
    expect(reply.status).toBe(200);
    expect(reply.headers.get('access-control-allow-origin')).toBe(staging);
    expect(reply.headers.get('cache-control')).toBe('public, max-age=30');
    const document = parse(ZoneSelectSchema, await reply.json());
    expect(document.channel).toBe('staging');
    expect(document.serial).toBe(5);
    expect(names(document.featured)).toEqual(['driftwood-isle', 'pine-hollow']);
    expect(names(document.popular)).toEqual(['new-shard', 'pine-hollow', 'driftwood-isle']);
    expect(names(document.new)).toEqual(['new-shard', 'pine-hollow']);
    expect(names(document.all)).toEqual(expect.arrayContaining(['_future', 'proof-town', 'test-name']));
    expect(document.popular.map(card => card.enters)).toEqual([3, 2, 2]);
  }
  expect(uploads).toHaveBeenCalledTimes(1);
  expect(totals).toHaveBeenCalledTimes(1);
  serial++;
  slugs.splice(slugs.indexOf('new-shard'), 1);
  const next = parse(ZoneSelectSchema, await (await fetch(door)).json());
  expect(next.serial).toBe(6);
  expect(names(next.popular)).not.toContain('new-shard');
});

test('a catalogue outage leaves the live Featured list readable and the route checks Origin', async () => {
  const door = await open(zoneSelectRoute({
    channel: 'production', allowedOrigins: [staging], world: () => ({ serial: 4, slugs: ['nine-dragon-stack'] }),
    uploads: async () => { throw new Error('offline'); }, totals: async () => [], log: () => undefined,
  }));
  const denied = await fetch(door, { headers: { origin: 'https://elsewhere.example' } });
  expect(denied.status).toBe(403);
  expect(denied.headers.get('access-control-allow-origin')).toBeNull();
  expect((await fetch(door, { method: 'POST' })).status).toBe(405);
  const document = parse(ZoneSelectSchema, await (await fetch(door)).json());
  expect(document.channel).toBe('production');
  expect(names(document.featured)).toEqual(['nine-dragon-stack']);
  expect(document.new).toEqual([]);
});
