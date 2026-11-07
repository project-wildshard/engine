import type {NativeSizeMatch, NativeSizeSnapshot} from './native-sizes.ts';
import type {PostControl} from './post-control.ts';
import type {PlayReading} from './play.ts';
/** The measuring protocol is data, never a CI verdict or a game setting. */
export interface Profile {cpu: number; down: number; up: number; latency: number}
export const profiles: Record<string, Profile> = {
  phone: {cpu: 10, down: 10_000_000 / 8, up: 2_000_000 / 8, latency: 100},
  lte: {cpu: 6, down: 20_000_000 / 8, up: 5_000_000 / 8, latency: 60},
  desktop: {cpu: 1, down: -1, up: -1, latency: 0},
};
export interface Row {key: string; label: string; start: number | null; end: number | null; duration: number; wallMs: number | null;
  state?: 'todo' | 'on' | 'ok'; startBasis?: 'native' | 'observed'; endBasis?: 'native' | 'observed'; detail?: string}
export interface ErrorRow {message: string; source: string; url: string; at: number}
/** Bytes are native encoded body transfer, not decoded or cached payload size.
 * SW/cache/local zero-transfer responses do not duplicate a worker's fetch. */
export interface RequestRow {url: string; start: number; end: number | null; source: 'worker' | 'service-worker' | 'network'; bytes: number | null; headerBytes?: number; status: number; failure: string | null;
  accounting?: 'pending' | 'complete' | 'incomplete'; accountingError?: string;
  sizeBasis?: 'native-encoded' | 'native-events';
  decodedBytes?: number; transferBytes?: number; bodyBasis?: 'native-data' | 'native-identity' | 'response-body' | 'http-no-body' | 'content-length-identity' | 'native-aborted' | 'native-body' | 'no-response'; nativeRequestId?: string; sizeComplete?: boolean;
  nativeSizes?: {responseBodySize: number | null; responseHeadersSize: number | null}; nativeMatch?: NativeSizeMatch; nativeResult?: NativeSizeSnapshot | null}
/** Finished requests require real wire and decoded-body sizes. Still-running
 * requests retain their separate inFlight count; failures remain on each row. */
export interface RequestAccounting {complete: boolean; pending: number; incomplete: number; deadlineMs: number; inFlight?: number;}
export interface Mark {name: string; start: number; duration: number; detail: unknown}
export interface PanelCounters {declaredBytes: number | null; pendingBytes: number | null; entryDownloadBytes: number | null; restoredBytes?: number | null;
  readBytes?: number | null; readCachedBytes?: number | null; readUnknownSourceBytes?: number | null; readsClosed?: boolean}
export interface PanelRow {at: number; clock: string; download: number | null; downloadFact?: string; header: string; wait: string; step: string; activeLabel: string | null; documentToken?: string; navigation?: boolean; content?: PanelCounters}
/** Admit a passive old-document sample without granting control to that document. */
export function readNavigationPanel(input: unknown): PanelRow | null {
  const row = record(input), {at, clock, download, downloadFact, header, wait, step, activeLabel, documentToken, navigation} = row;
  if (typeof at !== 'number' || !Number.isFinite(at) || typeof clock !== 'string'
    || download !== null && (typeof download !== 'number' || !Number.isFinite(download) || download < 0 || download > 100)
    || typeof downloadFact !== 'string' || typeof header !== 'string' || typeof wait !== 'string' || typeof step !== 'string'
    || activeLabel !== null && typeof activeLabel !== 'string' || typeof documentToken !== 'string' || documentToken === '' || navigation !== true) return null;
  let content: PanelCounters | undefined;
  if (row['content'] !== undefined) {
    const counters = record(row['content']), {declaredBytes, pendingBytes, entryDownloadBytes} = counters;
    const bytes = (value: unknown): value is number | null => value === null || typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
    if (!bytes(declaredBytes) || !bytes(pendingBytes) || !bytes(entryDownloadBytes)) return null;
    content = {declaredBytes, pendingBytes, entryDownloadBytes};
  }
  return {at, clock, download, downloadFact, header, wait, step, activeLabel, documentToken, navigation, ...(content === undefined ? {} : {content})};
}
export interface ControlWitness {
  at: number; documentToken: string; timeOrigin: number; initialURL: string; url: string; initialChunk: string | null;
  expectedShard: string | null; shard: string | null; titleFirst: boolean; entered: boolean; paused: boolean | null;
  clockPaused: boolean | null; frameGate: boolean; frames: number | null; appState: string | null;
  gridHome: {instance: string | null; slug: string | null; current: string | null; inside: string | null; ready: boolean; entered: boolean} | null;
  hudVisible: boolean; canvasVisible: boolean; covers: string[]; blockers: string[]; valid: boolean;
}
export interface Capture {tap: number | null; control: number | null; controlEventAt?: number; controlWitness?: ControlWitness;
  lastWitness?: ControlWitness; qualified?: boolean; fatal?: string; stoppedAt?: number; rows: Row[]; measures: Mark[];
  longTasks: Mark[]; frameGaps: {start: number; duration: number}[]; errors: string[]; errorDetails?: ErrorRow[]; panels?: PanelRow[]; rowCoverage: string}
/** A later document, cover or retired world cannot complete an earlier visit. */
export function controlQualification(capture: Capture, documentToken: string | null): string | null {
  if (capture.fatal !== undefined) return `Application load failed: ${capture.fatal}`;
  if (capture.control === null) return (capture.lastWitness?.blockers.length ?? 0) > 0
    ? capture.lastWitness?.blockers.join('; ') ?? 'No native entered-control boundary' : 'No native entered-control boundary';
  const first = capture.controlWitness, last = capture.lastWitness;
  if (documentToken === null || first === undefined || last === undefined || first.documentToken !== documentToken || last.documentToken !== documentToken)
    return 'Entry document changed or has no native control witness';
  if (!first.valid || !last.valid) return last.blockers.join('; ') || 'Entered control is no longer uncovered';
  return null;
}
/** The shared downlink's own count of the transport bytes it delivered (scripts/phone-loading/link.ts: bodies on
 * plain HTTP, whole TLS streams on CONNECT), from the visit's start (title dwell included) and from the tap, each up to
 * control. It is not per target: the rows' native wire bytes say which target fetched what. */
export interface LinkSummary {shared: true; bytesPerSecond: number; visitBytes: number; tapToControlBytes: number | null; peakBytesPerSecond: number; errors: string[]}
export interface Run extends Capture {schema: 1; build: string; engine: string; flow: string; cache: string; preset: string; at: string; url: string; profile: Profile; applied: {pageCPU: boolean; pageNetwork: boolean; workerNetwork: boolean; notes: string[]}; requests: RequestRow[];
  /** Requests begun during the title dwell, before the tap (the worker's precache starts there). */
  titleRequests?: RequestRow[]; link?: LinkSummary | null;
  requestAccounting?: RequestAccounting; totalMs: number | null; postControl?: PostControl | null; play?: PlayReading; video?: string; contactSheet?: string}
export function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
}
export function comparisons(current: Run, previous: unknown): string[] {
  const outer = record(previous);
  const candidates: unknown[] = Array.isArray(outer['runs']) ? outer['runs'] : [previous];
  const old = candidates.map(record).find(row => row['engine'] === current.engine && row['flow'] === current.flow
    && row['cache'] === current.cache && row['preset'] === current.preset);
  if (old === undefined) return ['No matching engine/flow/cache/preset baseline'];
  const warnings: string[] = [];
  if (typeof old['totalMs'] === 'number' && current.totalMs !== null && current.totalMs > old['totalMs'] * 1.1)
    warnings.push(`total +${((current.totalMs / old['totalMs'] - 1) * 100).toFixed(1)}%`);
  const oldRows = Array.isArray(old['rows']) ? old['rows'].map(record) : [];
  for (const row of current.rows) {
    const before = oldRows.find(value => value['key'] === row.key);
    if (typeof before?.['duration'] === 'number' && row.duration > before['duration'] + 1000)
      warnings.push(`${row.key} +${((row.duration - before['duration']) / 1000).toFixed(2)}s`);
  }
  return warnings;
}
export function printRun(run: Run): void {
  // Unknown sizes and requests still open at control are counted, never read as zero bytes.
  const summary = (source: RequestRow['source'], from = run.requests) => {
    const rows = from.filter(row => row.source === source);
    const wireUnknown = rows.filter(row => row.transferBytes === undefined).length;
    const bodyUnknown = rows.filter(row => row.decodedBytes === undefined).length;
    const open = run.control === null ? 0 : rows.filter(row => row.end === null || row.end > (run.control ?? 0)).length;
    return `${rows.length} / ${(rows.reduce((sum, row) => sum + (row.transferBytes ?? 0), 0) / 1e6).toFixed(3)} MB transferred / ${(rows.reduce((sum, row) => sum + (row.decodedBytes ?? 0), 0) / 1e6).toFixed(3)} MB body${wireUnknown + bodyUnknown === 0 ? '' : ` + pending sizes (${wireUnknown} wire/${bodyUnknown} body)`}${open === 0 ? '' : `, ${open} open at control`}`;
  };
  console.log(`\n${run.engine} ${run.flow} ${run.cache} ${run.build} [${run.preset}]`);
  const play = run.play;
  if (play !== undefined) console.log(`play ${play.seconds} s: ${play.fps} fps (1st s ${play.firstSecondFps}, settled ${play.settledFps}, lowest of first 5 ${play.lowestFirst5}) longest ${play.longestFrameMs} ms, ${play.framesOver250} > 250 ms (page ${play.pageGapsOver250}); walk ${play.motion.walkM} m, boost ${play.motion.boostM} m @ ${play.motion.boostTopMps} m/s; pass ${JSON.stringify(play.pass)}`);
  console.table([{seconds: run.totalMs === null ? 'INCOMPLETE' : (run.totalMs / 1000).toFixed(3),
    world: run.controlWitness?.gridHome?.slug ?? run.controlWitness?.shard ?? run.lastWitness?.shard ?? 'unqualified',
    'page network': summary('network'), 'worker network': summary('worker'), 'page via SW': summary('service-worker'),
    'title worker': summary('worker', run.titleRequests ?? []), 'title page': summary('network', run.titleRequests ?? []),
    link: run.link === undefined || run.link === null ? 'per-target CDP' : `shared ${(run.link.bytesPerSecond / 1e6).toFixed(2)} MB/s: ${(run.link.visitBytes / 1e6).toFixed(3)} MB visit, ${((run.link.tapToControlBytes ?? 0) / 1e6).toFixed(3)} MB tap-control, peak ${(run.link.peakBytesPerSecond / 1e6).toFixed(2)} MB/s`,
    accounting: run.requestAccounting?.complete === false ? `INCOMPLETE (${run.requestAccounting.incomplete} rows, ${run.requestAccounting.pending} timed out)`
      : `settled${run.requestAccounting?.inFlight === undefined ? '' : ` (${run.requestAccounting.inFlight} requests still in flight)`}`,
    longTasks: run.longTasks.length, frameGaps: run.frameGaps.length, errors: run.errors.length}]);
  const secondsAt = (at: number | null): string => at === null ? 'pending' : ((at - (run.tap ?? 0)) / 1000).toFixed(3);
  console.table(run.rows.filter(row => row.state !== 'todo').map(row => ({step: row.label, 'start +s': secondsAt(row.start), 'end +s': secondsAt(row.end),
    'exclusive s': (row.duration / 1000).toFixed(3), 'wall s': row.wallMs === null ? 'unknown' : (row.wallMs / 1000).toFixed(3),
    boundaries: `${row.startBasis ?? 'unknown'} / ${row.endBasis ?? 'pending'}`})));
  if (run.errors.length > 0) console.table(run.errorDetails ?? run.errors.map(message => ({message, source: 'legacy capture', url: ''})));
}
