// E7.8a: what the server tells `api.wildshard.io` (J94): a `kind: 'room'` record each minute with players, and errors as they happen, with the build. No player data. A report that
// fails is logged and forgotten, so no tick and no save waits on one. `api-server`'s telemetry takes this kind only once `cleanTelemetryRecord` lists it.
import { Scope } from '@wildshard/engine/app/scope';
import type { WorkerReading } from './cellProtocol';
import type { ServerSentry } from './serverSentry';

/** How often a record goes, in ms. */
const RECORD_MS = 60_000;
/** A report's wait. */
const POST_MS = 3000;

/** How the reports are built. */
export interface ServerReportsOptions {
  readonly build: string; readonly channel: string;
  /** `/api/telemetry` and `/api/errors`. Unset, that report stays home. */
  readonly telemetryUrl: string | undefined; readonly errorsUrl: string | undefined;
  /** Which sitting a record belongs to. */
  readonly tag: string | undefined;
  readonly log: (line: Record<string, unknown>) => void;
  readonly everyMs?: number;
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
  private players = 0;
  private held = 0;
  constructor(options: ServerReportsOptions) {
    this.options = options;
    if (options.telemetryUrl !== undefined) this.scope.interval(options.everyMs ?? RECORD_MS, () => { this.record(); });
  }
  /** One worker's 10 s reading. */
  heard(index: number, reading: WorkerReading): void {
    this.rows.push(reading); this.latest.set(index, reading);
    const now = [...this.latest.values()];
    this.players = Math.max(this.players, total(now, row => row.players)); this.held = Math.max(this.held, total(now, row => row.held));
  }
  /** Something uncaught, or a worker that failed. */
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
    if (telemetryUrl === undefined || players + held === 0) return;
    this.post(telemetryUrl, { kind: 'room', build, install: `server-${channel}`, ...(tag === undefined ? {} : { tag }), readings: rows.length, players, held, awake: total(latest, row => row.awake), cells: total(latest, row => row.cells),
      ticks: total(rows, row => row.ticks), ticksPerSecond: rows.reduce((low, row) => Math.min(low, row.ticksPerSecond), Number.POSITIVE_INFINITY), p50: peak(rows, row => row.p50), p95: peak(rows, row => row.p95), p99: peak(rows, row => row.p99), max: peak(rows, row => row.max),
      drops: total(rows, row => row.drops), rss: peak(rows, row => row.rss), heap: peak(rows, row => row.heap), refused: total(latest, row => row.refused), dropped: total(latest, row => row.dropped),
      frameBytes: total(latest, row => row.frameBytes), eventBytes: total(latest, row => row.eventBytes) });
  }
  private post(url: string, body: unknown): void {
    const sent = this.send(url, body).finally(() => { this.flying.delete(sent); });
    this.flying.add(sent);
  }
  private async send(url: string, body: unknown): Promise<void> {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(POST_MS) });
      if (!response.ok) this.options.log({ at: 'report.failed', url, status: response.status });
    } catch (error) { this.options.log({ at: 'report.failed', url, error: String(error) }); }
  }
}
