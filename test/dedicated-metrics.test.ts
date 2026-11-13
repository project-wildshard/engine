import { afterEach, expect, test, vi } from 'vitest';
import { CHUNK_HALF } from '../src/shared/engine/core/config';
import { roadName } from '../src/server/host/dedicated/gridCells';
import { ServerMetrics, metricsPort } from '../src/server/host/dedicated/serverMetrics';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// SERVER-CELLS SC1 (J328): the dedicated server's `/metrics`, Prometheus text on 127.0.0.1 only behind METRICS_PORT. A two-cell world on
// one worker with its road, as main.ts wires it: the scrape names every family, from the process's own numbers to a crossing's time.
const HOME = 'driftwood-isle', SOUTH = 'far-reach', ROAD = roadName(HOME);
const FAMILIES = [
  // The metrics client's defaults: the process monitor's.
  'process_cpu_seconds_total', 'process_resident_memory_bytes', 'nodejs_heap_size_used_bytes', 'nodejs_eventloop_lag_p99_seconds',
  // The server's own.
  'wildshard_eventloop_lag_seconds', 'wildshard_thread_memory_bytes', 'wildshard_tick_seconds', 'wildshard_ticks_per_second', 'wildshard_tick_drops_total',
  'wildshard_cells_resident', 'wildshard_cells_awake', 'wildshard_players', 'wildshard_players_held', 'wildshard_cell_boot_seconds', 'wildshard_crossing_seconds',
];
let bench: RoomBench | undefined, metrics: ServerMetrics | undefined;
const lines: Record<string, unknown>[] = [];
const bots: RoomBot[] = [];
afterEach(async () => { for (const row of bots.splice(0)) row.drop(); await bench?.close(); bench = undefined; await metrics?.close(); metrics = undefined; });

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

test('a two-cell world serves every family on 127.0.0.1 only, from boot to a crossing', { timeout: 120_000 }, async () => {
  const port = metricsPort({ METRICS_PORT: '0' }) ?? -1, served = new ServerMetrics(line => { lines.push(line); });
  metrics = served;
  bench = await roomBench({ cells: [HOME, SOUTH], workers: 1, crossing: true, readingMs: 250,
    reading: (index, row) => { served.reading(index, row); }, booted: (_index, _slug, ms) => { served.booted(ms); }, crossed: (ms, moved) => { served.crossed(ms, moved); } });
  served.watch(bench.world);
  const at = await served.listen(port);
  expect(at).toBeGreaterThan(0);
  const a = new RoomBot(bench.url, 'bench', 'device:a', 'A');
  bots.push(a);
  expect(await a.arrived()).toBe(true);
  // A reading with the player in Driftwood (every 250 ms here): one cell awake.
  await vi.waitFor(async () => { const { rows } = await scrape(at); expect(value(rows, 'wildshard_players')).toBe(1); expect(value(rows, 'wildshard_cells_awake')).toBe(1); }, { timeout: 10_000, interval: 100 });
  // Off Driftwood's south edge onto the road: one crossing, timed by the door.
  const home = bench.room(HOME), body = home?.bodyOf('device:a');
  if (body === undefined) throw new Error('A stands in Driftwood');
  body.resetPose({ x: 0, y: body.position.y, z: -(CHUNK_HALF + 3) }, body.yaw);
  await vi.waitFor(() => { expect(bench?.road(ROAD)?.holds('device:a')).toBe(true); }, { timeout: 10_000 });
  // On the road the player still counts, and no cell is awake: the road is no cell.
  await vi.waitFor(async () => { const { rows } = await scrape(at); expect(value(rows, 'wildshard_players')).toBe(1); expect(value(rows, 'wildshard_cells_awake')).toBe(0); }, { timeout: 10_000, interval: 100 });
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
  expect(bench.crashes).toEqual([]);
  expect(lines, 'no metrics.error').toEqual([]);
});

test('it listens on loopback only', async () => {
  const served = new ServerMetrics(line => { lines.push(line); });
  metrics = served;
  const at = await served.listen(0), { networkInterfaces } = await import('node:os');
  const outside = Object.values(networkInterfaces()).flat().find(row => row !== undefined && row.family === 'IPv4' && !row.internal)?.address;
  if (outside !== undefined) await expect(fetch(`http://${outside}:${String(at)}/metrics`)).rejects.toThrow();
  expect((await fetch(`http://127.0.0.1:${String(at)}/metrics`)).status).toBe(200);
});
