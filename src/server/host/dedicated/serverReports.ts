// E7.8a: what the server tells `api.wildshard.io` (J94): a `kind: 'room'` record each minute with players, and errors as they happen, with the build. No player data. A report that
// fails is logged and forgotten, so no tick and no save waits on one. `api-server`'s telemetry takes this kind only once `cleanTelemetryRecord` lists it.
import { Scope } from '@wildshard/engine/app/scope';
import type { WorkerReading } from './cellProtocol';
import type { ServerSentry } from './serverSentry';
import type { World } from './world';
import type { RoomSessionSummary } from './roomSessions';
import type { RoomGameCount } from './roomGameMetrics';

/** How often a record goes, in ms. */
const RECORD_MS = 60_000;
/** A report's wait. */
const POST_MS = 3000;
const METRIC_ROWS_PER_REPORT = 48;

/** How the reports are built. */
export interface ServerReportsOptions {
  readonly build: string; readonly channel: string;
  /** `/api/telemetry` and `/api/errors`. Unset, that report stays home. */
  readonly telemetryUrl: string | undefined; readonly errorsUrl: string | undefined;
  /** Which sitting a record belongs to. */
  readonly tag: string | undefined;
  readonly log: (line: Record<string, unknown>) => void;
  readonly everyMs?: number;
  readonly roomMetricsToken?: string;
  /** SENTRY-TRIAGE S8: errors also go to Sentry when the channel's env names a DSN. */
  readonly sentry?: ServerSentry | undefined;
}
const peak = (rows: readonly WorkerReading[], read: (row: WorkerReading) => number): number => rows.reduce((top, row) => Math.max(top, read(row)), 0);
const total = (rows: readonly WorkerReading[], read: (row: WorkerReading) => number): number => rows.reduce((sum, row) => sum + read(row), 0);

/** A minute of readings, as one record. */
export class ServerReports {
  private readonly options: ServerReportsOptions;
  private readonly scope = new Scope('dedicated.reports');
  private rows: WorkerReading[] = [];
  /** Each worker's newest reading: `refused`, `dropped` and the byte counts in it are running totals. */
  private readonly latest = new Map<number, WorkerReading>();
  private readonly flying = new Set<Promise<void>>();
  private world: Pick<World, 'livePlayers'> | undefined;
  private lastActive = false;
  private readonly ended: RoomSessionSummary[] = [];
  private readonly gameEvents: RoomGameCount[] = [];
  private players = 0;
  private held = 0;
  constructor(options: ServerReportsOptions) {
    this.options = options;
    if (options.telemetryUrl !== undefined) this.scope.interval(options.everyMs ?? RECORD_MS, () => { this.record(); });
  }
  watch(world: Pick<World, 'livePlayers'>): void { this.world = world; }
  sessions(rows: readonly RoomSessionSummary[]): void {
    if (this.options.telemetryUrl === undefined) return;
    const room = Math.max(0, METRIC_ROWS_PER_REPORT * 60 - this.ended.length);
    this.ended.push(...rows.slice(0, room));
    if (rows.length > room) this.options.log({ at: 'report.sessions-backlog', discarded: rows.length - room });
  }
  game(rows: readonly RoomGameCount[]): void {
    if (this.options.telemetryUrl === undefined) return;
    const room = Math.max(0, METRIC_ROWS_PER_REPORT * 60 - this.gameEvents.length);
    this.gameEvents.push(...rows.slice(0, room));
    if (rows.length > room) this.options.log({ at: 'report.game-backlog', discarded: rows.length - room });
  }
  flushGameMetrics(): void {
    while (this.ended.length > 0 || this.gameEvents.length > 0) this.record();
  }
  /** One worker's 10 s reading. */
  heard(index: number, reading: WorkerReading): void {
    this.rows.push(reading); this.latest.set(index, reading);
    const now = [...this.latest.values()];
    this.players = Math.max(this.players, total(now, row => row.players)); this.held = Math.max(this.held, total(now, row => row.held));
  }
  /** Something uncaught, or a worker that failed. */
  /** WR7: a save at this server's own version that does not parse: the save contract broke. Not fatal: the player boots from `previous`. */
  contract(issue: string): void {
    const { build, errorsUrl } = this.options;
    if (errorsUrl !== undefined) this.post(errorsUrl, { message: `save contract failure: ${issue}`, stack: '', fatal: false, system: 'save-contract', context: { build } });
    this.options.sentry?.capture(new Error(`save contract failure: ${issue}`), { system: 'save-contract', fatal: false });
  }
  error(error: unknown): void {
    const { build, errorsUrl } = this.options, stack = error instanceof Error ? error.stack ?? '' : '';
    if (errorsUrl !== undefined) this.post(errorsUrl, { message: String(error), stack, fatal: true, system: 'server', context: { build } });
    this.options.sentry?.capture(error, { system: 'server', fatal: true });
  }
  /** Every report on its way has landed or failed: an ending process waits for this. */
  async settled(): Promise<void> { await Promise.all([...this.flying, this.options.sentry?.flush()]); }
  dispose(): void { this.scope.dispose(); }
  private record(): void {
    const { build, channel, tag, telemetryUrl } = this.options, rows = this.rows.splice(0), { players, held } = this, latest = [...this.latest.values()];
    this.players = 0; this.held = 0;
    const live = this.world?.livePlayers();
    const active = players + held + (live?.humans ?? 0) + (live?.agents ?? 0) > 0;
    const sessions = this.ended.splice(0, METRIC_ROWS_PER_REPORT);
    const gameEvents = this.gameEvents.splice(0, METRIC_ROWS_PER_REPORT - sessions.length);
    const metrics = sessions.length + gameEvents.length > 0;
    const due = active || this.lastActive || metrics;
    this.lastActive = active;
    if (telemetryUrl === undefined || !due) return;
    this.post(telemetryUrl, { kind: 'room', build, install: `server-${channel}`, ...(tag === undefined ? {} : { tag }), readings: rows.length, players, held, ...(live === undefined ? {} : { zones: live.zones }), ...(sessions.length === 0 ? {} : { sessions }), ...(gameEvents.length === 0 ? {} : { gameEvents }), awake: total(latest, row => row.awake), cells: total(latest, row => row.cells),
      ticks: total(rows, row => row.ticks), ticksPerSecond: rows.length === 0 ? 0 : rows.reduce((low, row) => Math.min(low, row.ticksPerSecond), Number.POSITIVE_INFINITY), p50: peak(rows, row => row.p50), p95: peak(rows, row => row.p95), p99: peak(rows, row => row.p99), max: peak(rows, row => row.max),
      drops: total(rows, row => row.drops), rss: peak(rows, row => row.rss), heap: peak(rows, row => row.heap), refused: total(latest, row => row.refused), dropped: total(latest, row => row.dropped),
      frameBytes: total(latest, row => row.frameBytes), eventBytes: total(latest, row => row.eventBytes) }, metrics ? this.options.roomMetricsToken : undefined);
  }
  private post(url: string, body: unknown, roomToken?: string): void {
    const sent = this.send(url, body, roomToken).finally(() => { this.flying.delete(sent); });
    this.flying.add(sent);
  }
  private async send(url: string, body: unknown, roomToken: string | undefined): Promise<void> {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(roomToken === undefined ? {} : { 'x-wildshard-room-metrics': roomToken }) }, body: JSON.stringify(body), signal: AbortSignal.timeout(POST_MS), ...(roomToken === undefined ? {} : { redirect: 'error' }) });
      if (!response.ok) this.options.log({ at: 'report.failed', url, status: response.status });
    } catch (error) { this.options.log({ at: 'report.failed', url, error: String(error) }); }
  }
}
