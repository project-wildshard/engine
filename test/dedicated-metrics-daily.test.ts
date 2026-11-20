import { once } from 'node:events';
import { createServer } from 'node:http';
import { expect, test } from 'vitest';
import { roomMetricsDailyRoute } from '../src/server/host/dedicated/metricsDailyRoute';
import { readRoomMetricDay } from '../src/server/host/dedicated/saves/metricsDailyStore';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { openPglite } from './fixtures/pgliteDatabase';

test('daily room aggregates combine arrival and press counts and keep seat identities private', async () => {
  const db = await openPglite(), day = '2026-11-19', slug = 'driftwood-isle', from = Date.parse(day);
  await migrate(db);
  await db.exec(`insert into human_players (channel, day, player_key) values
    ('staging', '${day}', 'account-key'), ('production', '${day}', 'private-prod-key');
    insert into zone_enters (channel, day, slug, humans, agents) values ('staging', '${day}', '${slug}', 3, 1);
    insert into zone_select_presses (channel, day, slug, humans, agents) values ('staging', '${day}', '${slug}', 4, 8);
    insert into metrics_daily values ('staging', '${day}', 'death', '${slug}', 'human', '', 2);
    insert into metric_sessions values
    ('staging', '00000000-0000-0000-0000-000000000001', 'account-key', 'human', null, ${from - 1000}, ${from + 1000}, 1, 0, 0, 0, 0),
    ('staging', '00000000-0000-0000-0000-000000000002', 'agent-key', 'agent', 'smoke', ${from + 1000}, ${from + 2000}, 1, 0, 0, 0, 0);`);
  const route = roomMetricsDailyRoute({ channel: 'staging', read: readRoomMetricDay(db), log: () => undefined, now: () => from + 2000 });
  const server = createServer((request, response) => { if (!route(request, response)) response.writeHead(404).end(); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address();
  if (port === null || typeof port === 'string') throw new Error('No test port');
  const base = `http://127.0.0.1:${String(port.port)}`, endpoint = `${base}/metrics/daily/${day}`;
  try {
    const response = await fetch(endpoint);
    expect(response.status).toBe(200);
    const result = await response.json() as Awaited<ReturnType<ReturnType<typeof readRoomMetricDay>>>;
    expect({ ...result, metrics: result.metrics.filter(row => row.metric === 'dau' || row.metric === 'death') }).toEqual({
      channel: 'staging', day,
      metrics: [
        { metric: 'dau', slug: '', actor: 'agent', lane: '', value: 1 },
        { metric: 'dau', slug: '', actor: 'agent', lane: 'smoke', value: 1 },
        { metric: 'dau', slug: '', actor: 'human', lane: '', value: 1 },
        { metric: 'death', slug, actor: 'human', lane: '', value: 2 },
      ],
      zones: [{ slug, humans: 3, agents: 1, humanPresses: 4, agentPresses: 8 }],
    });
    expect((await fetch(`${base}/metrics/daily/2026-02-31`)).status).toBe(400);
    expect((await fetch(endpoint, { method: 'POST' })).status).toBe(405);
    expect((await fetch(`${base}/metrics`)).status).toBe(404);
  } finally {
    server.close();
    server.closeAllConnections();
    await once(server, 'close');
    await db.close();
  }
});
