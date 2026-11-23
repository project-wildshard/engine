import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { afterEach, expect, test, vi } from 'vitest';
import { parse } from 'valibot';
import { zoneSelectPressRoute } from '../src/server/host/dedicated/zoneSelectPress';
import { MarkerSeats } from '../src/server/host/dedicated/markerSeats';
import { metricsCurrentRoute } from '../src/server/host/dedicated/metricsCurrentRoute';
import { zoneCatalogueUrl, zoneSelectRoute, zoneSelectTabs } from '../src/server/host/dedicated/zoneSelect';
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

async function open(route: ReturnType<typeof zoneSelectRoute>, path = '/zone-select'): Promise<URL> {
  const server = createServer((request, response) => { if (!route(request, response)) response.writeHead(404).end(); });
  running.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing Zone Select test address');
  return new URL(`http://127.0.0.1:${address.port}${path}`);
}

/** The placement file's `featured` (world data the API signs, OF31i2); engine keeps no list of its own (OF31i4). */
const PLACED_FEATURED = ['driftwood-isle', 'pine-hollow', 'nalati-grasslands', 'nine-dragon-stack', 'mossgate', 'brasscap-mesa', 'sunscar-dunes', 'far-reach'];

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
    channel: 'staging', allowedOrigins: [staging], world: () => ({ serial, slugs, featured: PLACED_FEATURED }),
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

test('the door records valid presses separately by the common actor marker and honours CORS', async () => {
  const press = vi.fn();
  const url = await open(zoneSelectPressRoute({ channel: 'staging', allowedOrigins: [staging],
    trustProxy: 'none', enterable: slug => slug === 'pine-hollow', press }), '/zone-select/enter');
  const body = JSON.stringify({ slug: 'pine-hollow', channel: 'staging', audience: 'human' });
  const allowed = await fetch(url, { method: 'OPTIONS', headers: { origin: staging } });
  expect(allowed.status).toBe(204);
  expect(allowed.headers.get('access-control-allow-origin')).toBe(staging);
  expect(allowed.headers.get('access-control-allow-methods')).toBe('POST');
  expect(allowed.headers.get('access-control-allow-headers')).toContain('x-wildshard-agent');
  expect((await fetch(url, { method: 'POST', body, headers: { origin: 'https://foreign.example' } })).status).toBe(403);
  expect((await fetch(url, { method: 'POST', body })).status).toBe(403);
  expect((await fetch(url, { method: 'POST', body: '{', headers: { origin: staging } })).status).toBe(400);
  expect((await fetch(url, { method: 'POST', body: '0'.repeat(1024), headers: { origin: staging } })).status).toBe(400);
  expect((await fetch(url, { method: 'GET', headers: { origin: staging } })).status).toBe(405);
  const human = { origin: staging, 'user-agent': 'Mozilla/5.0 Safari/605.1' };
  for (const dropped of [body.replace('pine-hollow', 'unknown'), body.replace('staging', 'production')]) {
    expect((await fetch(url, { method: 'POST', body: dropped, headers: human })).status).toBe(204);
  }
  expect(press).not.toHaveBeenCalled();
  expect((await fetch(url, { method: 'POST', body, headers: human })).status).toBe(204);
  expect((await fetch(url, { method: 'POST', body, headers: { ...human, 'x-wildshard-agent': 'header-lane' } })).status).toBe(204);
  url.searchParams.set('agent', 'query-lane');
  expect((await fetch(url, { method: 'POST', body, headers: human })).status).toBe(204);
  expect(press.mock.calls).toEqual([
    ['pine-hollow', { actor: 'human' }],
    ['pine-hollow', { actor: 'agent', lane: 'header-lane' }],
    ['pine-hollow', { actor: 'agent', lane: 'query-lane' }],
  ]);
});

test('the press funnel drops the 31st request per address until a new minute', async () => {
  let now = 12_000;
  const press = vi.fn();
  const url = await open(zoneSelectPressRoute({ channel: 'staging', allowedOrigins: [staging],
    trustProxy: 'none', enterable: () => true, press, now: () => now }), '/zone-select/enter');
  const send = async (): Promise<number> => (await fetch(url, {
    method: 'POST', body: '{"slug":"pine-hollow","channel":"staging"}', headers: { origin: staging },
  })).status;
  for (let n = 0; n < 31; n++) expect(await send()).toBe(204);
  expect(press).toHaveBeenCalledTimes(30);
  now = 60_000;
  expect(await send()).toBe(204);
  expect(press).toHaveBeenCalledTimes(31);
});


test('the metrics door reads only the requested window and the live seat totals', async () => {
  const entries = vi.fn(async (days: number) => [{ slug: 'nine-dragon-stack', humans: days, agents: 1, uniqueHumans: 2 }]);
  const door = await open(metricsCurrentRoute({
    channel: 'staging', now: () => 1000, entries, log: () => undefined,
    live: () => ({ humans: 2, agents: 1, zones: { 'nine-dragon-stack': { human: 2, agent: 0 }, _road: { human: 0, agent: 1 } } }),
    selection: async totals => zoneSelectTabs('staging', { serial: 4, slugs: ['pine-hollow', 'nine-dragon-stack', '_private'] }, [], totals),
  }), '/metrics/current/7');
  const responses = await Promise.all([fetch(door), fetch(door)]);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      channel: 'staging', days: 7, at: 1000, live: { humans: 2, agents: 1 },
      arrivals: [{ slug: 'nine-dragon-stack', humans: 7, agents: 1 }], popular: ['nine-dragon-stack', 'pine-hollow'],
    });
  }
  expect(entries).toHaveBeenCalledExactlyOnceWith(7);
  expect((await fetch(new URL('/metrics/current/2', door))).status).toBe(404);
  expect((await fetch(door, { method: 'POST' })).status).toBe(405);
});

test('marker audit holds mismatches with their confirmed seat and forgets old buckets', async () => {
  let now = 0;
  const audit = new MarkerSeats(() => now);
  const minute = audit.seated();
  expect(audit.leak(minute, { actor: 'agent', lane: 'web-smoke', why: 'user-agent' }, 'human')).toBe(true);
  expect(audit.leak(minute, { actor: 'agent', why: 'automated-ua' }, undefined)).toBe(false);
  const door = await open(metricsCurrentRoute({
    channel: 'staging', entries: async () => [], selection: async () => ({ popular: [] }),
    live: () => ({ humans: 0, agents: 0, zones: {} }), log: () => undefined,
    markers: () => audit.read(),
  }), '/metrics/markers');
  expect(await (await fetch(door)).json()).toEqual({ channel: 'staging', since: 0, seats: 1, leaks: 1, lanes: { 'web-smoke': 1 } });
  now = 3_600_000;
  expect(audit.read()).toEqual({ since: 60_000, seats: 0, leaks: 0, lanes: {} });
});

test('the box reads upload metadata from the API, never from the signed placement host', () => {
  expect(zoneCatalogueUrl('https://packs.wildshard.io/releases/staging-placements.json').href).toBe('https://api.wildshard.io/api/catalogue');
  expect(zoneCatalogueUrl(undefined).href).toBe('https://api.wildshard.io/api/catalogue');
  expect(zoneCatalogueUrl('http://127.0.0.1:8787/releases/staging-placements.json').href).toBe('http://127.0.0.1:8787/api/catalogue');
});

// QA-FEEDBACK-2026-11-23-b row 4 (Jake ~12:20 Cancún: "one plot thin ice should not show up in popular lol whats your problem"; J498):
// Featured, Popular and New name only real zones; a placeholder open plot or a test shard, placed or not, never reaches them.
test('row 4: no placeholder open plot or test shard reaches Featured, Popular or New, however many entered it', () => {
  const junk = ['open-plot-thin-ice', 'open-plot-desert-ruin', 'blender-template', 'walkin-proof-20261113', 'f30-clean'];
  const uploads = [...junk, 'pine-hollow'].map(slug => ({ slug, name: `${slug} name`, firstUploadedAt: '2026-11-20T12:00:00.000Z' }));
  const totals = junk.map(slug => ({ slug, humans: 50, agents: 0, uniqueHumans: 50 }));
  const tabs = zoneSelectTabs('staging', { serial: 1, slugs: [...junk, 'pine-hollow'], featured: [...junk, 'pine-hollow'] }, uploads, totals);
  for (const list of [tabs.featured, tabs.popular, tabs.new]) expect(list.map(card => card.slug)).toEqual(['pine-hollow']);
  expect(tabs.all.map(card => card.slug)).toEqual(expect.arrayContaining(junk));
});

// QA 11-23-b row 26 (J453, J498): staging v0.1.76's grid placed the hidden test shards Pastel Plain and Ink-Cel Valley, and the
// door's Popular and New listed them by their upload names. A test shard on the grid is in All only.
test('row 26: a test shard the grid places is in no player list, however many arrivals it has', () => {
  const live = { serial: 93, slugs: ['driftwood-isle', 'mossgate', 'pastel-plain', 'ink-cel-valley', 'cinder-orchard'], featured: PLACED_FEATURED };
  const uploads = [
    { slug: 'mossgate', name: 'Mossgate Hollow', firstUploadedAt: '2026-11-19T12:00:00.000Z' },
    { slug: 'pastel-plain', name: 'Pastel Plain', firstUploadedAt: '2026-11-22T12:00:00.000Z' },
    { slug: 'ink-cel-valley', name: 'Ink-Cel Valley', firstUploadedAt: '2026-11-22T13:00:00.000Z' },
    { slug: 'cinder-orchard', name: 'Cinder Orchard', firstUploadedAt: '2026-11-19T11:00:00.000Z' },
  ];
  const counts = [{ slug: 'pastel-plain', humans: 9, agents: 0, uniqueHumans: 9 }, { slug: 'mossgate', humans: 1, agents: 0, uniqueHumans: 1 }];
  const tabs = zoneSelectTabs('staging', live, uploads, counts);
  for (const list of [tabs.featured, tabs.popular, tabs.new]) expect(names(list)).not.toEqual(expect.arrayContaining(['pastel-plain']));
  expect(names(tabs.popular)).toEqual(['mossgate', 'driftwood-isle']);
  expect(names(tabs.new)).toEqual(['mossgate']);
  expect(names(tabs.all)).toEqual(expect.arrayContaining(['pastel-plain', 'ink-cel-valley', 'cinder-orchard']));
});
