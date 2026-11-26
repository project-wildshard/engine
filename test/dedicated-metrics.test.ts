import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { ServerReports } from '../src/server/host/dedicated/serverReports';
import { ZoneEntries } from '../src/server/host/dedicated/zoneEntries';
import { memoryZoneEntryStore } from '../src/server/host/dedicated/saves/zoneEntries';
import { gatewayDoor } from './fixtures/dedicated/gatewayDoor';
import { ServerMetrics, metricsPort } from '../src/server/host/dedicated/serverMetrics';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { loadScaledMs } from './fixtures/loadBudget';

// SERVER-CELLS SC1 (J328): the dedicated server's `/metrics`, Prometheus text on 127.0.0.1 only behind METRICS_PORT. A two-cell world on
// one worker with its road, as main.ts wires it: the scrape names every family, from the process's own numbers to a crossing's time.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', ROAD = roadName(HOME);
const FAMILIES = [
  // The metrics client's defaults: the process monitor's.
  'process_cpu_seconds_total', 'process_resident_memory_bytes', 'nodejs_heap_size_used_bytes', 'nodejs_eventloop_lag_p99_seconds',
  // The server's own.
  'wildshard_eventloop_lag_seconds', 'wildshard_thread_memory_bytes', 'wildshard_tick_seconds', 'wildshard_cell_tick_seconds', 'wildshard_ticks_per_second', 'wildshard_tick_drops_total',
  'wildshard_cells_resident', 'wildshard_cells_awake', 'wildshard_players', 'wildshard_players_held', 'wildshard_cell_boot_seconds', 'wildshard_crossing_seconds',
  // MMO-OBSERVABILITY OB4/OB5: every thread's GC, and the door's links.
  'wildshard_gc_pauses_total', 'wildshard_gc_pause_seconds_total', 'wildshard_gc_pause_max_seconds', 'wildshard_sockets_open', 'wildshard_socket_closes_total',
  'wildshard_socket_bytes_total', 'wildshard_socket_buffered_bytes_max', 'wildshard_door_refusals_total', 'wildshard_client_rtt_seconds',
];
let bench: RoomBench | undefined, metrics: ServerMetrics | undefined;
const lines: Record<string, unknown>[] = [];
const bots: RoomBot[] = [];
// QA-11-22 row 12: every fence here is a real clock on worker threads and sockets, so it stretches with the machine's load (a
// file-level red at load 44 during another lane's gate, 5 of 5 green alone); what each wait proves stays the same.
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; await metrics?.close(); metrics = undefined; }, loadScaledMs(10_000));

/** One scrape, as `name{labels}` → value. */
async function scrape(port: number): Promise<{ readonly text: string; readonly rows: ReadonlyMap<string, number> }> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/metrics`), text = await response.text();
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toMatch(/^text\/plain/u);
  const rows = new Map(text.split('\n').filter(line => line !== '' && !line.startsWith('#')).map(line => { const at = line.lastIndexOf(' '); return [line.slice(0, at), Number(line.slice(at + 1))] as const; }));
  return { text, rows };
}
const value = (rows: ReadonlyMap<string, number>, name: string): number => [...rows].filter(([key]) => key === name || key.startsWith(`${name}{`)).reduce((total, [, read]) => total + read, 0);

test('METRICS_PORT: unset or blank is off, a port is a port, anything else refuses', () => {
  expect(metricsPort({})).toBeUndefined();
  expect(metricsPort({ METRICS_PORT: '' })).toBeUndefined();
  expect(metricsPort({ METRICS_PORT: '9464' })).toBe(9464);
  expect(metricsPort({ METRICS_PORT: '0' })).toBe(0);
  expect(() => metricsPort({ METRICS_PORT: 'yes' })).toThrow(/not a port/u);
  expect(() => metricsPort({ METRICS_PORT: '70000' })).toThrow(/not a port/u);
});

test('a two-cell world serves every family on 127.0.0.1 only, from boot to a crossing', { timeout: loadScaledMs(120_000) }, async () => {
  const port = metricsPort({ METRICS_PORT: '0' }) ?? -1, served = new ServerMetrics(line => { lines.push(line); }, 'staging');
  metrics = served;
  bench = await roomBench({ cells: [HOME, SOUTH], workers: 1, crossing: true, readingMs: 250,
    reading: (index, row) => { served.reading(index, row); }, link: served.link, booted: (_index, _slug, ms) => { served.booted(ms); }, crossed: (ms, moved) => { served.crossed(ms, moved); } });
  served.watch(bench.world);
  const at = await served.listen(port);
  expect(at).toBeGreaterThan(0);
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A');
  bots.push(a);
  expect(await a.arrived()).toBe(true);
  // A reading with the player in Driftwood (every 250 ms here): one cell awake.
  await vi.waitFor(async () => { const { rows } = await scrape(at); expect(value(rows, 'wildshard_players')).toBe(1); expect(value(rows, 'wildshard_cells_awake')).toBe(1); }, { timeout: loadScaledMs(10_000), interval: 100 });
  // OB5: the door counts the open link, and hears the bot's own round trips (it pings each second); OB4: the worker's GC is read.
  await vi.waitFor(async () => { const { rows } = await scrape(at); expect(value(rows, 'wildshard_sockets_open')).toBe(1); expect(value(rows, 'wildshard_client_rtt_seconds_count')).toBeGreaterThan(0); expect(value(rows, 'wildshard_gc_pauses_total')).toBeGreaterThan(0); }, { timeout: loadScaledMs(10_000), interval: 200 });
  expect(value((await scrape(at)).rows, 'wildshard_socket_bytes_total')).toBeGreaterThan(0);
  // SC8: the awake cell's own tick time, by name (what the worker table's weights are read from).
  expect((await scrape(at)).rows.get(`wildshard_cell_tick_seconds{cell="${HOME}"}`)).toBeGreaterThan(0);
  // Off Driftwood's south edge onto the road: one crossing, timed by the door.
  const home = bench.room(HOME), body = home?.bodyOf('device:a');
  if (body === undefined) throw new Error('A stands in Driftwood');
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await vi.waitFor(() => { expect(bench?.road(ROAD)?.holds('device:a')).toBe(true); }, { timeout: loadScaledMs(10_000) });
  // On the road the player still counts, and no cell is awake: the road is no cell.
  await vi.waitFor(async () => { const { rows } = await scrape(at); expect(value(rows, 'wildshard_players')).toBe(1); expect(value(rows, 'wildshard_cells_awake')).toBe(0); }, { timeout: loadScaledMs(10_000), interval: 100 });
  const { text, rows } = await scrape(at);
  for (const family of FAMILIES) expect(text, family).toMatch(new RegExp(`^# TYPE ${family} `, 'mu'));
  expect(rows.get('wildshard_cells_resident{worker="0"}'), 'both cells on the one worker').toBe(2);
  expect(rows.get('wildshard_cell_boot_seconds_count'), 'two cells and the road opened').toBe(3);
  expect(rows.get('wildshard_crossing_seconds_count{moved="true"}')).toBe(1);
  expect(rows.get('wildshard_ticks_per_second{worker="0"}')).toBeGreaterThan(0);
  expect(rows.get('wildshard_tick_seconds{worker="0",quantile="0.95"}')).toBeGreaterThan(0);
  for (const thread of ['main', 'worker-0']) {
    expect(rows.get(`wildshard_eventloop_lag_seconds{thread="${thread}",quantile="0.99"}`), thread).toBeGreaterThanOrEqual(0);
    expect(rows.get(`wildshard_thread_memory_bytes{thread="${thread}",kind="heap"}`), thread).toBeGreaterThan(0);
  }
  expect(value(rows, 'process_resident_memory_bytes')).toBeGreaterThan(0);
  // Only `/metrics`, only GET.
  expect((await fetch(`http://127.0.0.1:${String(at)}/health`)).status).toBe(404);
  expect((await fetch(`http://127.0.0.1:${String(at)}/metrics`, { method: 'POST' })).status).toBe(404);
  a.drop();
  await vi.waitFor(() => { expect(bench?.world.health()).toMatchObject({ players: 1, humans: 0, agents: 0 }); }, { timeout: loadScaledMs(1000) });
  // OB5: the drop is a close with its reason
  await vi.waitFor(async () => { expect(value((await scrape(at)).rows, 'wildshard_socket_closes_total')).toBeGreaterThan(0); }, { timeout: loadScaledMs(5000), interval: 100 });
  const back = new RoomBot(`${bench.url}?agent=metrics-proof`, 'bench', 'device:a', 'A');
  bots.push(back);
  expect(await back.arrived()).toBe(true);
  await vi.waitFor(() => { expect(bench?.world.livePlayers()).toEqual({ humans: 0, agents: 1, zones: { _road: { human: 0, agent: 1 } } }); }, { timeout: loadScaledMs(1000) });
  expect(bench.crashes).toEqual([]);
  expect(lines, 'no metrics.error').toEqual([]);
});

test('it listens on loopback only', { timeout: loadScaledMs(30_000) }, async () => {
  const served = new ServerMetrics(line => { lines.push(line); }, 'staging');
  metrics = served;
  const at = await served.listen(0), { networkInterfaces } = await import('node:os');
  const outside = Object.values(networkInterfaces()).flat().find(row => row !== undefined && row.family === 'IPv4' && !row.internal)?.address;
  if (outside !== undefined) await expect(fetch(`http://${outside}:${String(at)}/metrics`)).rejects.toThrow();
  expect((await fetch(`http://127.0.0.1:${String(at)}/metrics`)).status).toBe(200);
});

test('the scrape and health count confirmed linked humans and agents by zone', { timeout: loadScaledMs(30_000) }, async () => {
  const served = new ServerMetrics(() => undefined, 'staging');
  metrics = served;
  const arrivals = new ZoneEntries(memoryZoneEntryStore(), 'staging', 'test', () => undefined);
  const door = await gatewayDoor({ cells: [HOME, SOUTH], entered(seat, slug, actor) {
    if (arrivals.entered(seat, slug, actor)) served.entered(slug, actor.actor);
  } });
  try {
    served.watch(door.world);
    const port = await served.listen(0);
    expect(await door.admit('203.0.113.1', 'device:person', { 'user-agent': 'Mozilla/5.0 iPhone Safari/604.1' }, '', [], { cell: HOME, spawn: true })).toBe(true);
    expect(await door.admit('203.0.113.2', 'device:bot', {}, '?agent=metrics-proof', [], { cell: SOUTH, spawn: true })).toBe(true);
    expect(door.world.health()).toMatchObject({ players: 2, humans: 0, agents: 0 });
    for (const { device, slug, body, admission } of door.seats) {
      if (admission === undefined) throw new Error('Seat has no admission');
      door.heard({ kind: 'seated', slug, device, body, admission, seats: 2 });
    }
    expect(door.world.health()).toMatchObject({ players: 2, humans: 1, agents: 1 });
    const { rows } = await scrape(port);
    for (const [slug, actor] of [[HOME, 'human'], [SOUTH, 'agent']]) {
      const labels = `{channel="staging",slug="${slug}",actor="${actor}"}`;
      expect(rows.get(`wildshard_zone_players${labels}`)).toBe(1);
      expect(rows.get(`wildshard_zone_entries_total${labels}`)).toBe(1);
    }
    door.heard({ kind: 'left', device: 'device:person', slug: HOME, seats: 1 });
    expect((await scrape(port)).rows.has(`wildshard_zone_players{channel="staging",slug="${HOME}",actor="human"}`)).toBe(false);
    expect(door.world.health()).toMatchObject({ humans: 0, agents: 1 });
  } finally { await door.close(); }
});

test('the room minute sends zone counts and clears the last occupied minute', async () => {
  vi.useFakeTimers();
  const posts: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => {
    posts.push(JSON.parse(String(options.body)) as unknown);
    return Promise.resolve(new Response());
  }));
  const reports = new ServerReports({
    build: 'test', channel: 'staging', telemetryUrl: 'http://127.0.0.1/telemetry', errorsUrl: undefined, tag: undefined,
    log: () => undefined, everyMs: 1000,
  });
  let occupied = true;
  reports.watch({ livePlayers: () => occupied ? { humans: 1, agents: 1, zones: { [HOME]: { human: 1, agent: 0 }, [SOUTH]: { human: 0, agent: 1 } } } : { humans: 0, agents: 0, zones: {} } });
  try {
    await vi.advanceTimersByTimeAsync(1000);
    occupied = false;
    await vi.advanceTimersByTimeAsync(2000);
    expect(posts).toEqual([
      expect.objectContaining({ kind: 'room', zones: { [HOME]: { human: 1, agent: 0 }, [SOUTH]: { human: 0, agent: 1 } } }),
      expect.objectContaining({ kind: 'room', zones: {}, ticksPerSecond: 0 }),
    ]);
  } finally {
    reports.dispose();
    await reports.settled();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});
