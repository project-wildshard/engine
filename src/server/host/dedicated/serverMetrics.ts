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
import { gcPauses, type GcReading } from './gcPauses';
import type { LinkEvents, LinkKind, LinkRow } from './linkEvents';
import type { StatsWord } from '@wildshard/engine/net/statsWord';
import type { ActorTags } from '@wildshard/engine/app/actor';
import type { World } from './world';

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
type MetricsWorld = Pick<World, 'health' | 'livePlayers'> & Partial<Pick<World, 'linkRows' | 'refusals'>>;
/** OB6: a page's reconnect reasons become label values; past this many distinct ones the rest count as `other`. */
const MAX_REASONS = 24;
/** OB5: round trips, in seconds: a LAN, a continent, the 9,000 km Cancún to Nuremberg, a bad cell link, a stall. */
const RTT_BUCKETS = [0.02, 0.05, 0.08, 0.1, 0.125, 0.15, 0.2, 0.3, 0.5, 0.75, 1, 2, 5];
/** OB6: frame times, in seconds: 120 Hz, 60, 30, the long-frame line, a hitch, a freeze. */
const FRAME_BUCKETS = [0.009, 0.017, 0.025, 0.034, 0.05, 0.067, 0.1, 0.2, 0.5, 1, 2];

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
  private readonly gcCount: Counter<'thread' | 'kind'>;
  private readonly gcSeconds: Counter<'thread' | 'kind'>;
  private readonly gcMax: Gauge<'thread'>;
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
  private readonly entries: Counter<'channel' | 'slug' | 'actor'>;
  private readonly boots: Histogram;
  private readonly crossings: Histogram<'moved'>;
  /** OB5/OB6: the door's link events, for `WorldOptions.link`. */
  readonly link: LinkEvents;
  private readonly reasons = new Set<string>();

  constructor(log: (line: Record<string, unknown>) => void, private readonly channel: string, build?: { readonly build: string; readonly serial?: number | string }) {
    this.log = log;
    const registers = [this.registry], readLag = loopLag(), readGc = gcPauses();
    this.scope.interval(LAG_MS, () => { this.mainLag = readLag(); this.gc('main', readGc()); });
    collectDefaultMetrics({ register: this.registry });
    // OB4: what this process runs, so the dashboard marks a release where the build changes.
    if (build !== undefined) new Gauge({ name: 'wildshard_build_info', help: 'The build this server runs (always 1).', labelNames: ['build', 'serial'], registers }).set({ build: build.build, serial: String(build.serial ?? '') }, 1);
    this.gcCount = new Counter({ name: 'wildshard_gc_pauses_total', help: 'OB4: garbage-collection pauses per thread and kind (a worker\'s from its 10 s readings).', labelNames: ['thread', 'kind'], registers });
    this.gcSeconds = new Counter({ name: 'wildshard_gc_pause_seconds_total', help: 'OB4: time paused for garbage collection per thread and kind.', labelNames: ['thread', 'kind'], registers });
    this.gcMax = new Gauge({ name: 'wildshard_gc_pause_max_seconds', help: 'OB4: the longest GC pause per thread in its last 10 s reading.', labelNames: ['thread'], registers });
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
    const zones = (): ReturnType<World['livePlayers']>['zones'] => this.world?.livePlayers().zones ?? {};
    this.registry.registerMetric(new Gauge({ name: 'wildshard_zone_players', help: 'Connected players in confirmed seats, by channel, zone and actor.', labelNames: ['channel', 'slug', 'actor'], registers: [],
      collect() {
        this.reset();
        for (const [slug, row] of Object.entries(zones())) {
          this.set({ channel, slug, actor: 'human' }, row.human);
          this.set({ channel, slug, actor: 'agent' }, row.agent);
        }
      } }));
    this.entries = new Counter({ name: 'wildshard_zone_entries_total', help: 'Confirmed zone arrivals since process start, by channel, zone and actor.', labelNames: ['channel', 'slug', 'actor'], registers });
    this.boots = new Histogram({ name: 'wildshard_cell_boot_seconds', help: 'How long a cell (or a worker\'s road) took to open: each `cell.booted`.', buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8, 16], registers });
    this.link = this.linkMetrics(registers);
    this.crossings = new Histogram({ name: 'wildshard_crossing_seconds', help: 'A crossing, from the source\'s ask to the worker\'s answer, by whether the seat moved.', labelNames: ['moved'], buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2], registers });
  }

  /** OB5/OB6: the link's families. Every label is a kind (human or agent, phone or desktop) or a reason, never a player. */
  private linkMetrics(registers: Registry[]): LinkEvents {
    const world = (): MetricsWorld | undefined => this.world, kinds = ['actor', 'device'] as const;
    let closedOut = 0, closedIn = 0, closedSkipped = 0;
    const live = (read: (row: LinkRow) => number): number => (world()?.linkRows?.() ?? []).reduce((total, row) => total + read(row), 0);
    new Gauge({ name: 'wildshard_sockets_open', help: 'OB5: game sockets open at the door, by human or agent and phone or desktop.', labelNames: kinds, registers,
      collect() { this.reset(); for (const row of world()?.linkRows?.() ?? []) this.inc({ actor: row.actor, device: row.device }); } });
    new Gauge({ name: 'wildshard_socket_buffered_bytes_max', help: 'OB5: the most bytes waiting for any one client (its send queue); frames skip past 16 KiB.', registers,
      collect() { this.set(Math.max(0, ...(world()?.linkRows?.() ?? []).map(row => row.buffered))); } });
    new Counter({ name: 'wildshard_socket_bytes_total', help: 'OB5: bytes the door\'s game sockets sent (out) and received (in).', labelNames: ['direction'], registers,
      collect() { this.reset(); this.inc({ direction: 'out' }, closedOut + live(row => row.sentBytes)); this.inc({ direction: 'in' }, closedIn + live(row => row.recvBytes)); } });
    new Counter({ name: 'wildshard_socket_skipped_frames_total', help: 'OB5: frames skipped because a client\'s send queue was full (backpressure).', registers,
      collect() { this.reset(); this.inc(closedSkipped + live(row => row.skipped)); } });
    new Counter({ name: 'wildshard_door_refusals_total', help: 'OB5: what the door refused, by reason (protocol errors, timeouts, limits).', labelNames: ['reason'], registers,
      collect() { this.reset(); for (const [reason, count] of Object.entries(world()?.refusals ?? {})) this.inc({ reason }, count); } });
    const closes = new Counter({ name: 'wildshard_socket_closes_total', help: 'OB5: game sockets closed, by reason (stalled, refused, replaced, restart, lost, closed ...).', labelNames: ['reason', ...kinds], registers });
    const rtt = new Histogram({ name: 'wildshard_client_rtt_seconds', help: 'OB5: each ping\'s round trip as the page measured it.', labelNames: kinds, buckets: RTT_BUCKETS, registers });
    const words = new Counter({ name: 'wildshard_client_stats_words_total', help: 'OB6: pages\' 10 s stats words heard.', labelNames: kinds, registers });
    const fps = new Histogram({ name: 'wildshard_client_fps', help: 'OB6: each page\'s frames per second over a 10 s word (visible time only).', labelNames: kinds, buckets: [5, 10, 15, 20, 25, 30, 40, 50, 60, 90, 120], registers });
    const frameP95 = new Histogram({ name: 'wildshard_client_frame_p95_seconds', help: 'OB6: each word\'s 95th-percentile frame interval.', labelNames: kinds, buckets: FRAME_BUCKETS, registers });
    const frameMax = new Histogram({ name: 'wildshard_client_frame_max_seconds', help: 'OB6: each word\'s longest frame.', labelNames: kinds, buckets: FRAME_BUCKETS, registers });
    const frames = new Counter({ name: 'wildshard_client_frames_total', help: 'OB6: frames pages drew.', labelNames: kinds, registers });
    const long = new Counter({ name: 'wildshard_client_long_frames_total', help: 'OB6: frames over 50 ms (a hitch a player feels).', labelNames: kinds, registers });
    const jitter = new Histogram({ name: 'wildshard_client_rtt_jitter_seconds', help: 'OB6: each word\'s mean change between consecutive round trips.', labelNames: kinds, buckets: [0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1], registers });
    const pageRtt = new Histogram({ name: 'wildshard_client_rtt_p95_seconds', help: 'OB6: each word\'s 95th-percentile round trip.', labelNames: kinds, buckets: RTT_BUCKETS, registers });
    const reconnects = new Counter({ name: 'wildshard_client_reconnects_total', help: 'OB6: links pages lost and redialled, by the redial\'s reason.', labelNames: ['reason', ...kinds], registers });
    const reason = (said: string): string => { if (this.reasons.has(said)) return said; if (this.reasons.size >= MAX_REASONS) return 'other'; this.reasons.add(said); return said; };
    return {
      rtt: (ms: number, kind: LinkKind) => { rtt.observe({ ...kind }, ms / 1000); },
      closed: (why: string, kind: LinkKind, stats, skipped: number) => { closes.inc({ reason: reason(why), ...kind }); closedOut += stats.sentBytes; closedIn += stats.recvBytes; closedSkipped += skipped; },
      stats: (word: StatsWord, kind: LinkKind) => {
        const labels = { ...kind };
        words.inc(labels); frames.inc(labels, word.frames); long.inc(labels, word.long);
        const visible = word.s - word.hidden;
        if (visible >= 1 && word.frames > 0) { fps.observe(labels, word.frames / visible); frameP95.observe(labels, word.p95 / 1000); frameMax.observe(labels, word.max / 1000); }
        if (word.jitter !== undefined) jitter.observe(labels, word.jitter / 1000);
        if (word.rtt95 !== undefined) pageRtt.observe(labels, word.rtt95 / 1000);
        for (const [why, count] of Object.entries(word.re ?? {})) if (count > 0) reconnects.inc({ reason: reason(why), ...kind }, count);
      },
    };
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
    if (row.gc !== undefined) this.gc(thread, row.gc);
  }
  /** OB4: one thread's GC pauses over its last reading. */
  private gc(thread: string, read: GcReading): void {
    let max = 0;
    for (const [kind, row] of Object.entries(read)) {
      if (row === undefined) continue;
      this.gcCount.inc({ thread, kind }, row.n); this.gcSeconds.inc({ thread, kind }, row.ms / 1000); max = Math.max(max, row.max);
    }
    this.gcMax.set({ thread }, max / 1000);
  }
  /** A cell, or a worker's road, opened in `ms`. */
  booted(ms: number): void { this.boots.observe(ms / 1000); }
  /** A crossing took `ms`, and the seat moved or stayed. */
  crossed(ms: number, moved: boolean): void { this.crossings.observe({ moved: String(moved) }, ms / 1000); }
  entered(slug: string, actor: ActorTags['actor']): void { this.entries.inc({ channel: this.channel, slug, actor }); }
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
