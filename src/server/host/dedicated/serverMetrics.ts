// SERVER-CELLS SC1 (J328): the dedicated server's `/metrics`, Prometheus text on 127.0.0.1 only, on `METRICS_PORT` (unset: off). The
// process's own numbers come from the metrics client's defaults; the rest is read from what the door already hears: each worker's 10 s
// reading (tick times, ticks per second, drops, cells awake, players, its heap and its event-loop lag), each `cell.booted`, each crossing,
// and `/health`'s table for the cells each worker holds. Nothing here alters a reply or a tick, and nothing leaves loopback.
// oxlint-disable-next-line import/no-nodejs-modules -- Its own loopback port.
import { createServer, type Server, type ServerResponse } from 'node:http';
// oxlint-disable-next-line import/no-nodejs-modules -- The port it ended up on.
import type { AddressInfo } from 'node:net';
import { Scope } from '@wildshard/engine/app/scope';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { WorkerReading } from './cellProtocol';
import { loopLag, type LoopLag } from './loopLag';

/** Only loopback: the box's Prometheus scrapes it there (SC2), and nothing else may. */
const HOST = '127.0.0.1';
/** The main thread's lag window, as long as a worker's reading, so a second scraper never shortens it. */
const LAG_MS = 10_000;

/** `METRICS_PORT`: unset or blank is off; 0 asks for any free port (a proof's); anything else must be a port, or the server refuses to start. */
export function metricsPort(env: Readonly<Record<string, string | undefined>>): number | undefined {
  const value = env['METRICS_PORT'];
  if (value === undefined || value.trim() === '') return undefined;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) throw new Error(`METRICS_PORT ${value} is not a port`);
  return port;
}

/** What `/metrics` reads of the world when scraped: `/health`'s table, each open cell and the worker it runs on. */
export interface MetricsWorld { health: () => { readonly table: Readonly<Record<string, number>> } }

/** The server's metrics: fed by the door's callbacks, served on loopback once `listen` is called. */
export class ServerMetrics {
  readonly registry: Registry = new Registry();
  private world: MetricsWorld | undefined;
  private server: Server | undefined;
  private readonly log: (line: Record<string, unknown>) => void;
  /** The main thread's lag over its last whole window. */
  private mainLag: LoopLag = { p50: 0, p99: 0, max: 0 };
  private readonly scope = new Scope('dedicated.metrics');
  private readonly lag: Gauge<'thread' | 'quantile'>;
  private readonly memory: Gauge<'thread' | 'kind'>;
  private readonly tick: Gauge<'worker' | 'quantile'>;
  private readonly cellTick: Gauge<'cell'>;
  /** Each worker's cells awake in its last reading. */
  private readonly ticking = new Map<number, ReadonlySet<string>>();
  private readonly rate: Gauge<'worker'>;
  private readonly drops: Counter<'worker'>;
  private readonly awake: Gauge<'worker'>;
  private readonly players: Gauge<'worker'>;
  private readonly held: Gauge<'worker'>;
  private readonly boots: Histogram;
  private readonly crossings: Histogram<'moved'>;

  constructor(log: (line: Record<string, unknown>) => void) {
    this.log = log;
    const registers = [this.registry], readLag = loopLag();
    this.scope.interval(LAG_MS, () => { this.mainLag = readLag(); });
    collectDefaultMetrics({ register: this.registry });
    // A metric's `collect` runs with the metric as `this`: these read the server's own state.
    const mainLag = (): LoopLag => this.mainLag, table = (): Readonly<Record<string, number>> => this.world?.health().table ?? {};
    this.lag = new Gauge({ name: 'wildshard_eventloop_lag_seconds', help: 'Event-loop lag per thread over its last 10 s window.', labelNames: ['thread', 'quantile'], registers,
      collect() { const { p50, p99, max } = mainLag(); this.set({ thread: 'main', quantile: '0.5' }, p50 / 1000); this.set({ thread: 'main', quantile: '0.99' }, p99 / 1000); this.set({ thread: 'main', quantile: '1' }, max / 1000); } });
    this.memory = new Gauge({ name: 'wildshard_thread_memory_bytes', help: 'Each thread\'s own heap, external and array-buffer bytes (a worker\'s from its last reading).', labelNames: ['thread', 'kind'], registers,
      collect() { const own = process.memoryUsage(); this.set({ thread: 'main', kind: 'heap' }, own.heapUsed); this.set({ thread: 'main', kind: 'external' }, own.external); this.set({ thread: 'main', kind: 'arrayBuffers' }, own.arrayBuffers); } });
    this.tick = new Gauge({ name: 'wildshard_tick_seconds', help: 'Tick time per worker over its last 10 s reading.', labelNames: ['worker', 'quantile'], registers });
    this.cellTick = new Gauge({ name: 'wildshard_cell_tick_seconds', help: 'SC8: each awake cell\'s mean tick time over its worker\'s last 10 s reading (its awake cost).', labelNames: ['cell'], registers });
    this.rate = new Gauge({ name: 'wildshard_ticks_per_second', help: 'Ticks per second per worker over its last 10 s reading.', labelNames: ['worker'], registers });
    this.drops = new Counter({ name: 'wildshard_tick_drops_total', help: 'Ticks a worker\'s clock dropped to catch up.', labelNames: ['worker'], registers });
    this.registry.registerMetric(new Gauge({ name: 'wildshard_cells_resident', help: 'Cells open in memory, per worker (from /health\'s table).', labelNames: ['worker'], registers: [],
      collect() {
        this.reset();
        const counts = new Map<number, number>();
        for (const index of Object.values(table())) counts.set(index, (counts.get(index) ?? 0) + 1);
        for (const [index, count] of counts) this.set({ worker: String(index) }, count);
      } }));
    this.awake = new Gauge({ name: 'wildshard_cells_awake', help: 'Cells with someone in them, ticking, per worker.', labelNames: ['worker'], registers });
    this.players = new Gauge({ name: 'wildshard_players', help: 'Players seated, per worker.', labelNames: ['worker'], registers });
    this.held = new Gauge({ name: 'wildshard_players_held', help: 'Bodies held for a dropped player, per worker.', labelNames: ['worker'], registers });
    this.boots = new Histogram({ name: 'wildshard_cell_boot_seconds', help: 'How long a cell (or a worker\'s road) took to open: each `cell.booted`.', buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16], registers });
    this.crossings = new Histogram({ name: 'wildshard_crossing_seconds', help: 'A crossing, from the source\'s ask to the worker\'s answer, by whether the seat moved.', labelNames: ['moved'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2], registers });
  }

  /** The world whose table says which cells each worker holds. */
  watch(world: MetricsWorld): void { this.world = world; }
  /** One worker's 10 s reading. */
  reading(index: number, row: WorkerReading): void {
    const worker = String(index);
    for (const [quantile, ms] of [['0.5', row.p50], ['0.95', row.p95], ['0.99', row.p99], ['1', row.max]] as const) this.tick.set({ worker, quantile }, ms / 1000);
    this.rate.set({ worker }, row.ticksPerSecond);
    // a cell gone back to sleep stops reporting its last awake cost (review SHOULD)
    const awake = new Set(Object.keys(row.cellMs ?? {}));
    for (const cell of this.ticking.get(index) ?? []) if (!awake.has(cell)) this.cellTick.remove({ cell });
    this.ticking.set(index, awake);
    for (const [cell, ms] of Object.entries(row.cellMs ?? {})) this.cellTick.set({ cell }, ms / 1000);
    this.drops.inc({ worker }, Math.max(0, row.drops));
    this.awake.set({ worker }, row.awake);
    this.players.set({ worker }, row.players);
    this.held.set({ worker }, row.held);
    const thread = `worker-${worker}`;
    this.memory.set({ thread, kind: 'heap' }, row.heap);
    if (row.external !== undefined) this.memory.set({ thread, kind: 'external' }, row.external);
    if (row.arrayBuffers !== undefined) this.memory.set({ thread, kind: 'arrayBuffers' }, row.arrayBuffers);
    if (row.lag !== undefined) for (const [quantile, ms] of [['0.5', row.lag.p50], ['0.99', row.lag.p99], ['1', row.lag.max]] as const) this.lag.set({ thread, quantile }, ms / 1000);
  }
  /** A cell, or a worker's road, opened in `ms`. */
  booted(ms: number): void { this.boots.observe(ms / 1000); }
  /** A crossing took `ms`, and the seat moved or stayed. */
  crossed(ms: number, moved: boolean): void { this.crossings.observe({ moved: String(moved) }, ms / 1000); }
  /** The scrape. */
  text(): Promise<string> { return this.registry.metrics(); }
  /** One `/metrics` answer: a scrape that fails says why, and the game never hears of it. */
  private async answer(response: ServerResponse): Promise<void> {
    try { const text = await this.text(); response.writeHead(200, { 'content-type': this.registry.contentType }).end(text); }
    catch (error) { response.writeHead(500).end(String(error)); }
  }

  /** Serve `/metrics` on 127.0.0.1:`port`; answers the port it listens on. */
  async listen(port: number): Promise<number> {
    const server = this.server = createServer((request, response) => {
      if (request.method !== 'GET' || request.url !== '/metrics') { response.writeHead(404).end(); return; }
      void this.answer(response);
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, HOST, () => { server.off('error', reject); resolve(); }); });
    // Once up, a failure on this side port is a line, never a crash of the game; and it never keeps the process alive.
    server.on('error', error => { this.log({ at: 'metrics.error', error: String(error) }); });
    server.unref();
    return (server.address() as AddressInfo).port;
  }
  async close(): Promise<void> {
    this.scope.dispose();
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => { resolve(); }); });
  }
}
