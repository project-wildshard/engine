import type {Request, Response} from 'playwright';
import {record} from './model.ts';

export interface NativeSizes {decodedBytes?: number; encodedBytes?: number; transferBytes?: number; requestId: string; partial?: boolean; facadeOf?: string; readBody?: () => Promise<number>}
/** A fixed-field diagnostic, never another matching authority or an event log. */
export interface NativeMatchEntry {
  requestId: string; worker: boolean; fromServiceWorker: boolean; complete: boolean; failed: boolean; cached: boolean; revalidated: boolean; hasData: boolean;
  start: number; end: number | null; status: number | null; initial: number | null;
  transfer: number | null; encodedChunks: number; decodedChunks: number;
  headers: Readonly<Record<string, string>>; truncated: boolean;
}
export interface NativeSizeMatch {
  outcome: 'matched' | 'unmatched' | 'ambiguous' | 'unfinished' | 'facade-unmatched' | 'facade-ambiguous' | 'facade-matched';
  basis: 'clock' | 'validated-overlap' | 'retained' | 'none'; candidates: number;
  entry?: NativeMatchEntry; workerFetch?: NativeMatchEntry; alternatives?: readonly NativeMatchEntry[];
}
export interface NativeSizeObservation {sizes: NativeSizes | null; match: NativeSizeMatch}
/** Function-free native result retained before accounting can refuse it. */
export interface NativeSizeSnapshot {requestId: string; decodedBytes: number | null; encodedBytes: number | null; transferBytes: number | null; partial: boolean; facadeOf: string | null; bodyReader: boolean}
export function nativeSizeSnapshot(sizes: NativeSizes): NativeSizeSnapshot {
  return {requestId: sizes.requestId.slice(0, 512), decodedBytes: sizes.decodedBytes ?? null,
    encodedBytes: sizes.encodedBytes ?? null, transferBytes: sizes.transferBytes ?? null,
    partial: sizes.partial === true, facadeOf: sizes.facadeOf?.slice(0, 512) ?? null, bodyReader: sizes.readBody !== undefined};
}
function matchEntry(entry: Entry): NativeMatchEntry {
  return {requestId: entry.key.slice(0, 512), worker: entry.worker, fromServiceWorker: entry.sw, complete: entry.complete,
    failed: entry.failed === true, cached: entry.cached, revalidated: entry.revalidated === true, hasData: entry.chunks,
    start: entry.start, end: entry.end ?? null, status: entry.status ?? null, initial: entry.initial ?? null,
    transfer: entry.transfer ?? null, encodedChunks: entry.encoded, decodedChunks: entry.decoded,
    headers: Object.fromEntries(Object.entries(entry.headers).map(([name, value]) => [name, value.slice(0, 512)])),
    truncated: entry.key.length > 512 || Object.values(entry.headers).some(value => value.length > 512)};
}
interface Entry {
  key: string; session: string; protocolId: string; seenData: Set<string>; worker: boolean; url: string; method: string; start: number; timestamp?: number; timedStart?: number; end?: number; status?: number;
  headers: Record<string, string>; decoded: number; encoded: number; chunks: boolean; cached: boolean; sw: boolean;
  initial?: number; transfer?: number; complete: boolean; revalidated?: boolean; failed?: boolean;
}
function size(value: unknown): value is number {return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;}
/** Passive CDP ledger. Redirect hops keep separate entries; matching requires
 * URL, method, owner kind and the native request's own wall-clock start. */
export class NativeSizeLedger {
  constructor(private readonly bodyReader?: (session: string, id: string, url: string, headers: Readonly<Record<string, string>>) => Promise<number>) {}
  private readonly active = new Map<string, Entry>();
  private readonly entries: Entry[] = [];
  private readonly requests = new WeakMap<Request, Entry>();
  private readonly claimed = new Set<Entry>();
  event(session: string, worker: boolean, method: string, input: unknown): void {
    const data = record(input), id = data['requestId'];
    if (typeof id !== 'string') return;
    const key = `${session}:${id}`;
    if (method === 'Network.requestWillBeSent') {
      const previous = this.active.get(key), redirect = record(data['redirectResponse']);
      if (previous !== undefined && data['redirectResponse'] !== undefined) {
        if (size(redirect['encodedDataLength'])) previous.transfer = redirect['encodedDataLength'];
        previous.complete = true;
      }
      const request = record(data['request']), url = request['url'], verb = request['method'], wall = data['wallTime'];
      if (typeof url !== 'string' || typeof verb !== 'string' || typeof wall !== 'number' || !Number.isFinite(wall)) return;
      const migrated = this.entries.find(row => row.protocolId === id && row.url === url && row.method === verb && row.worker === worker && Math.abs(row.start - wall * 1000) < 0.001);
      if (migrated !== undefined) {this.active.set(key, migrated); return;}
      const entry: Entry = {key: `${key}:${this.entries.length}`, session, protocolId: id, seenData: new Set(), worker, url, method: verb, start: wall * 1000,
        headers: {}, decoded: 0, encoded: 0, chunks: false, cached: false, sw: false, complete: false};
      if (typeof data['timestamp'] === 'number') entry.timestamp = data['timestamp'];
      this.entries.push(entry); this.active.set(key, entry); return;
    }
    const entry = this.active.get(key); if (entry === undefined) return;
    entry.session = session;
    if (method === 'Network.responseReceived') {
      const response = record(data['response']);
      if (typeof response['status'] === 'number') entry.status = response['status'];
      for (const [name, value] of Object.entries(record(response['headers'])))
        if (typeof value === 'string' && ['etag', 'last-modified', 'content-type', 'content-encoding', 'content-length'].includes(name.toLowerCase())) entry.headers[name.toLowerCase()] = value;
      entry.cached ||= response['fromDiskCache'] === true || response['fromPrefetchCache'] === true;
      entry.sw = response['fromServiceWorker'] === true;
      if (size(response['encodedDataLength'])) entry.initial = response['encodedDataLength'];
      const timing = record(response['timing']), requestTime = timing['requestTime'];
      // Playwright uses response.requestTime, not requestWillBeSent.wallTime,
      // whenever network timing is available. Retain both native bases.
      if (typeof requestTime === 'number' && Number.isFinite(requestTime) && entry.timestamp !== undefined)
        entry.timedStart = entry.start + (requestTime - entry.timestamp) * 1000;
    } else if (method === 'Network.responseReceivedExtraInfo') {
      entry.revalidated = data['statusCode'] === 304;
    } else if (method === 'Network.requestServedFromCache') entry.cached = true;
    else if (method === 'Network.dataReceived') {
      if (typeof data['timestamp'] === 'number') {
        const token = `${data['timestamp']}:${String(data['dataLength'])}:${String(data['encodedDataLength'])}`;
        if (entry.seenData.has(token)) return; entry.seenData.add(token);
      }
      if (size(data['dataLength'])) {entry.decoded += data['dataLength']; entry.chunks = true;}
      if (size(data['encodedDataLength'])) entry.encoded += data['encodedDataLength'];
    } else if (method === 'Network.loadingFailed') {
      this.finishTime(entry, data);
      entry.failed = true; entry.complete = true;
      entry.transfer = (entry.initial ?? 0) + entry.encoded;
    } else if (method === 'Network.loadingFinished') {
      this.finishTime(entry, data);
      if (size(data['encodedDataLength'])) entry.transfer = data['encodedDataLength'];
      // A blob/data URL reads local content; it performs no network transfer.
      else if (/^(?:blob|data):/u.test(entry.url)) entry.transfer = 0;
      entry.complete = true;
    }
  }
  private finishTime(entry: Entry, data: Record<string, unknown>): void {
    const timestamp = data['timestamp'];
    if (typeof timestamp === 'number' && Number.isFinite(timestamp) && entry.timestamp !== undefined)
      entry.end = entry.start + (timestamp - entry.timestamp) * 1000;
  }
  private overlaps(row: Entry, request: Request, response: Response): boolean {
    const timing = request.timing(), start = timing.startTime, end = start + timing.responseEnd;
    // Separate CDP connections can report different wall-clock bases. A
    // drifted join needs overlapping completed lifetimes and exact validators
    // plus every retained representation header; a nearest URL is insufficient.
    if (!(start > 0 && timing.responseEnd >= 0 && Number.isFinite(end) && row.end !== undefined
      && row.start <= end && start <= row.end && row.status === response.status())) return false;
    const headers = response.headers();
    if (row.headers['etag'] === undefined && row.headers['last-modified'] === undefined) return false;
    return ['etag', 'last-modified', 'content-type', 'content-encoding', 'content-length']
      .every(name => row.headers[name] === headers[name]);
  }
  private sizes(entry: Entry): NativeSizes {
    let encoded: number | undefined;
    if (entry.failed) encoded = entry.encoded;
    else if (entry.transfer === 0 || entry.revalidated) encoded = 0;
    else if (entry.transfer !== undefined && entry.initial !== undefined && entry.transfer >= entry.initial) encoded = entry.transfer - entry.initial;
    else if (entry.encoded > 0) encoded = entry.encoded;
    // A completed uncached POST with no encoded body and no data events is
    // empty (e.g. the preview's 405 telemetry reply), not an unread cached GET.
    const emptyPost = entry.method === 'POST' && !entry.cached && !entry.sw && encoded === 0;
    const reader = this.bodyReader, selected = entry;
    return {requestId: entry.key, ...(reader === undefined ? {} : {readBody: () => reader(selected.session, selected.protocolId, selected.url, selected.headers)}),
      ...(entry.failed ? {partial: true} : {}), ...((entry.chunks || entry.failed || emptyPost) ? {decodedBytes: entry.decoded} : {}),
      ...(encoded === undefined ? {} : {encodedBytes: encoded}), ...(entry.transfer === undefined ? {} : {transferBytes: entry.transfer})};
  }
  /** Native wire belongs to the worker request, not its page-facing SW response.
   * A recovery needs a unique completed worker lifetime, exact method/status and
   * all representation headers plus a validator. The worker remains claimable
   * by its own Playwright Request so its physical transfer is counted once. */
  private facade(request: Request, response: Response | null | undefined, entry: Entry | undefined,
    basis: NativeSizeMatch['basis']): NativeSizeObservation | undefined {
    if (request.serviceWorker() !== null || request.method() !== 'GET' || response?.fromServiceWorker() !== true) return undefined;
    // CDP sometimes emits only the page's request start for a SW facade. Its
    // completed Playwright response still supplies the lifetime and validators;
    // partial or contradictory native response evidence never takes this path.
    const startOnly = entry !== undefined && !entry.complete && !entry.failed && entry.status === undefined
      && Object.keys(entry.headers).length === 0 && !entry.chunks && entry.initial === undefined && entry.transfer === undefined;
    const timing = request.timing(), start = startOnly ? timing.startTime : entry?.start ?? timing.startTime,
      end = startOnly ? timing.startTime + timing.responseEnd : entry?.end ?? timing.startTime + timing.responseEnd;
    const eligible = this.entries.filter(row => row.worker && row.url === request.url() && row.method === request.method());
    const workers = eligible.filter(row => row.complete && !row.failed && !row.sw && (entry === undefined || startOnly || entry.sw && this.overlaps(entry, request, response))
      && timing.responseEnd >= 0 && row.end !== undefined && row.start >= start && row.end <= end
      && this.overlaps(row, request, response));
    const match = {basis, candidates: workers.length, ...(entry === undefined ? {} : {entry: matchEntry(entry)}),
      ...(workers.length === 1 ? {} : {alternatives: eligible.slice(0, 2).map(matchEntry)})};
    const original = entry === undefined || !entry.complete ? null : this.sizes(entry);
    if (workers.length !== 1) return {sizes: original, match: {...match, outcome: workers.length === 0 ? 'facade-unmatched' : 'facade-ambiguous'}};
    const worker = workers[0]; if (worker === undefined) return undefined;
    const physical = this.sizes(worker);
    if (!size(physical.transferBytes) || !size(physical.encodedBytes) || physical.encodedBytes > physical.transferBytes)
      return {sizes: original, match: {...match, outcome: 'facade-unmatched', workerFetch: matchEntry(worker)}};
    const sizes: NativeSizes = {requestId: entry?.key ?? worker.key, facadeOf: worker.key, encodedBytes: 0, transferBytes: 0,
      ...(physical.decodedBytes === undefined ? {} : {decodedBytes: physical.decodedBytes}),
      ...(physical.readBody === undefined ? {} : {readBody: physical.readBody})};
    return {sizes, match: {...match, outcome: 'facade-matched', workerFetch: matchEntry(worker)}};
  }
  observe(request: Request, response?: Response | null): NativeSizeObservation {
    let entry = this.requests.get(request), basis: NativeSizeMatch['basis'] = 'retained';
    if (entry === undefined) {
      const start = request.timing().startTime, worker = request.serviceWorker() !== null;
      const distance = (row: Entry): number => Math.min(Math.abs(row.start - start), Math.abs((row.timedStart ?? row.start) - start));
      const eligible = this.entries.filter(row => !this.claimed.has(row) && row.url === request.url()
        && row.method === request.method() && row.worker === worker);
      const candidates = eligible.filter(row => distance(row) < 1).sort((a, b) => distance(a) - distance(b));
      let first = candidates[0]; const second = candidates[1]; basis = 'clock';
      if (first !== undefined && second !== undefined && distance(first) === distance(second))
        return {sizes: null, match: {outcome: 'ambiguous', basis, candidates: candidates.length, alternatives: candidates.slice(0, 2).map(matchEntry)}};
      if (first === undefined && response !== undefined && response !== null) {
        const overlapping = eligible.filter(row => this.overlaps(row, request, response)); basis = 'validated-overlap';
        if (overlapping.length > 1) return {sizes: null, match: {outcome: 'ambiguous', basis, candidates: overlapping.length, alternatives: overlapping.slice(0, 2).map(matchEntry)}};
        first = overlapping[0];
      }
      if (first === undefined) return this.facade(request, response, undefined, 'validated-overlap')
        ?? {sizes: null, match: {outcome: 'unmatched', basis: 'none', candidates: 0, alternatives: eligible.slice(0, 2).map(matchEntry)}};
      entry = first; this.claimed.add(entry); this.requests.set(request, entry);
    }
    if (!entry.complete) return this.facade(request, response, entry, basis)
      ?? {sizes: null, match: {outcome: 'unfinished', basis, candidates: 1, entry: matchEntry(entry)}};
    const sizes = this.sizes(entry);
    if (!size(sizes.transferBytes) || !size(sizes.encodedBytes) || sizes.encodedBytes > sizes.transferBytes) {
      const facade = this.facade(request, response, entry, basis); if (facade !== undefined) return facade;
    }
    return {sizes, match: {outcome: 'matched', basis, candidates: 1, entry: matchEntry(entry)}};
  }
  read(request: Request, response?: Response | null): NativeSizes | null {return this.observe(request, response).sizes;}
}
