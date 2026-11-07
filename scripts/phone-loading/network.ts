import type {Request, Response} from 'playwright';
import {nativeSizeSnapshot, type NativeSizes, type NativeSizeObservation} from './native-sizes.ts';
import type {ErrorRow, RequestAccounting, RequestRow} from './model.ts';

const ACCOUNTING_DEADLINE_MS = 5000;
interface Job {row: RequestRow; stage: string; active: boolean; done: Promise<void>}
function measured(value: unknown): value is number {return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;}
/** Keep encoded transfer and the decoded HTTP body separate. Body fallbacks
 * preserve the original response while its target lives; native body reads
 * never fetch the resource again. */
async function accountSizes(row: RequestRow, request: Request, response: Response | null,
  body: unknown, headers: unknown, native: NativeSizes | null, stage: (value: string) => void): Promise<Partial<RequestRow>> {
  row.nativeSizes = {responseBodySize: typeof body === 'number' && Number.isFinite(body) ? body : null,
    responseHeadersSize: typeof headers === 'number' && Number.isFinite(headers) ? headers : null};
  for (const value of [body, headers]) if (value !== undefined && value !== null && (typeof value !== 'number' || !Number.isSafeInteger(value)))
    throw new Error(`Invalid native request sizes: body=${String(body)}, headers=${String(headers)}`);
  if (response === null) throw new Error(`Request has no response: ${row.failure ?? row.url}`);
  const local = /^(?:blob|data):/u.test(row.url);
  let transfer = native?.transferBytes;
  if (transfer === undefined && typeof body === 'number' && typeof headers === 'number' && measured(body + headers)) transfer = body + headers;
  if (transfer === undefined && local) transfer = 0;
  let encoded = native?.encodedBytes ?? (measured(body) ? body : undefined);
  if (transfer === 0) encoded = 0;
  if (!measured(transfer) || !measured(encoded) || encoded > transfer) throw new Error('Native encoded transfer is incomplete');
  let decoded = native?.decodedBytes;
  let bodyBasis: RequestRow['bodyBasis'] = 'native-data';
  if (decoded === undefined) {
    const status = response.status(), noBody = request.method() === 'HEAD' || status === 204 || status === 304 || (status >= 300 && status < 400 && body === 0);
    if (noBody) {decoded = 0; bodyBasis = 'http-no-body';}
    else {
      const encoding = response.headers()['content-encoding'];
      if (measured(body) && body > 0 && (encoding === undefined || encoding === 'identity')) {decoded = body; bodyBasis = 'native-identity';}
      else {
        const length = response.headers()['content-length'];
        if (row.failure === null && (encoding === undefined || encoding === 'identity') && length !== undefined && /^\d+$/u.test(length) && measured(Number(length))) {
          decoded = Number(length); bodyBasis = 'content-length-identity';
        } else if (row.failure !== null && transfer === 0) {decoded = 0; bodyBasis = 'native-aborted';}
        else {
          stage('response.body');
          decoded = native?.readBody === undefined ? (await response.body()).byteLength : await native.readBody();
          bodyBasis = native?.readBody === undefined ? 'response-body' : 'native-body';
        }
      }
    }
  }
  return {bytes: encoded, headerBytes: transfer - encoded, transferBytes: transfer, decodedBytes: decoded, bodyBasis,
    sizeBasis: native === null ? 'native-encoded' : 'native-events', sizeComplete: native?.partial !== true && row.failure === null, ...(native === null ? {} : {nativeRequestId: native.requestId}), accounting: 'complete'};
}
/** One context owns one request ledger, across both visits and their gap.
 * Native response/size metadata cannot hold the measured visit indefinitely. */
export function observeRequests(attach: (start: (request: Request) => void, finish: (request: Request) => void) => () => void, nativeSizes?: (request: Request, response?: Response | null) => NativeSizes | NativeSizeObservation | null | Promise<NativeSizes | NativeSizeObservation | null>): {
  readonly rows: RequestRow[]; readonly errors: ErrorRow[]; settle: (since?: number) => Promise<RequestAccounting>; stop: () => void;
} {
  const rows: RequestRow[] = [], errors: ErrorRow[] = [], jobs = new Set<Job>();
  const starts = new Map<Request, RequestRow>();
  const nativeResults = new Map<RequestRow, NativeSizes>();
  const nativeResult = (row: RequestRow, observed: NativeSizes | NativeSizeObservation | null): NativeSizes | null => {
    const sizes = observed !== null && 'sizes' in observed ? observed.sizes : observed;
    if (observed !== null && 'match' in observed) row.nativeMatch = observed.match;
    row.nativeResult = sizes === null ? null : nativeSizeSnapshot(sizes);
    if (sizes !== null) nativeResults.set(row, sizes);
    return sizes;
  };
  let stopped = false;
  const incomplete = (job: Job, reason: string): void => {
    if (!job.active) return;
    job.active = false; jobs.delete(job);
    job.row.accounting = 'incomplete'; job.row.accountingError = reason;
    errors.push({message: `Request accounting: ${reason}`, source: job.stage, url: job.row.url, at: job.row.end ?? Date.now()});
  };
  const start = (request: Request): void => {
    if (stopped) return;
    const row: RequestRow = {url: request.url(), start: request.timing().startTime > 0 ? request.timing().startTime : Date.now(),
      end: null, source: request.serviceWorker() !== null ? 'worker' : 'network', bytes: null, status: 0, failure: null, accounting: 'pending'};
    starts.set(request, row); rows.push(row);
  };
  const finish = (request: Request): void => {
    if (stopped) return;
    const row = starts.get(request);
    if (row === undefined) {
      errors.push({message: 'Request accounting: Error: Finished request without a start', source: 'requestfinished/requestfailed', url: request.url(), at: Date.now()});
      return;
    }
    if (row.end !== null) return;
    row.end = Date.now(); row.failure = request.failure()?.errorText ?? null;
    const job: Job = {row, stage: 'request.response', active: true, done: Promise.resolve()};
    jobs.add(job);
    job.done = (async () => {
      try {
        const response = await request.response();
        if (!job.active) return;
        row.source = request.serviceWorker() !== null ? 'worker' : response?.fromServiceWorker() ? 'service-worker' : 'network';
        row.status = response?.status() ?? 0;
        if (response === null && row.failure !== null) {
          const observed = await nativeSizes?.(request, response) ?? null;
          if (!job.active) return;
          const partial = nativeResult(row, observed);
          const encoded = partial?.encodedBytes ?? 0, transfer = partial?.transferBytes ?? 0;
          Object.assign(row, {bytes: encoded, decodedBytes: partial?.decodedBytes ?? 0, transferBytes: transfer,
            headerBytes: transfer - encoded, bodyBasis: 'no-response', sizeBasis: partial === null || partial === undefined ? 'native-encoded' : 'native-events',
            sizeComplete: false, accounting: 'complete'});
          job.active = false; return;
        }
        job.stage = 'request.sizes';
        const sizes = await request.sizes();
        if (!job.active) return;
        job.stage = 'native.events';
        const observed = await nativeSizes?.(request, response) ?? null;
        if (!job.active) return;
        const native = nativeResult(row, observed);
        job.stage = 'request.sizes';
        const recovered = await accountSizes(row, request, response, sizes.responseBodySize, sizes.responseHeadersSize, native, value => {job.stage = value;});
        if (!job.active) return;
        Object.assign(row, recovered); job.active = false;
      } catch (error) {incomplete(job, String(error));}
      finally {jobs.delete(job);}
    })();
  };
  // A native worker event alone is not a counted transfer. Zero a facade only
  // while its exact physical request ID has one complete row in this visit.
  // Refusals seal here too: a worker arriving after settlement cannot cure one.
  const checkFacades = (since: number): void => {
    const workers = new Map<string, RequestRow[]>();
    for (const row of rows) if (row.source === 'worker' && row.nativeRequestId !== undefined) {
      const group = workers.get(row.nativeRequestId) ?? [];
      group.push(row); workers.set(row.nativeRequestId, group);
    }
    for (const row of rows) {
      const id = nativeResults.get(row)?.facadeOf;
      if (row.start < since || row.accounting !== 'complete' || id === undefined || id === null) continue;
      const matches = workers.get(id) ?? [], physical = matches[0];
      const native = physical === undefined ? undefined : nativeResults.get(physical);
      if (matches.length === 1 && physical !== undefined && physical.start >= since && physical.end !== null
        && physical.url === row.url && physical.status === row.status && physical.failure === null
        && physical.accounting === 'complete' && physical.sizeComplete === true
        && native?.requestId === id && native.facadeOf === undefined && native.partial !== true
        && measured(physical.bytes) && measured(physical.transferBytes) && physical.bytes <= physical.transferBytes
        && physical.bytes === native.encodedBytes && physical.transferBytes === native.transferBytes) continue;
      const reason = 'Native facade lacks exactly one complete counted worker request';
      row.accounting = 'incomplete'; row.accountingError = reason; row.bytes = null; row.sizeComplete = false;
      delete row.transferBytes; delete row.headerBytes;
      errors.push({message: `Request accounting: ${reason}`, source: 'native.facade', url: row.url, at: row.end ?? Date.now()});
    }
  };
  const detach = attach(start, finish);
  return {rows, errors, settle: async (since = 0) => {
    const selected = [...jobs];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (selected.length > 0) await Promise.race([Promise.all(selected.map(job => job.done)), new Promise<void>(resolve => {
        timer = setTimeout(resolve, ACCOUNTING_DEADLINE_MS);
      })]);
      const pending = selected.filter(job => job.active);
      for (const job of pending) incomplete(job, `Incomplete native ${job.stage} after ${ACCOUNTING_DEADLINE_MS}ms accounting deadline`);
      checkFacades(since);
      const incompleteRows = rows.filter(row => row.start >= since && row.accounting === 'incomplete');
      const inFlight = rows.filter(row => row.start >= since && row.end === null).length;
      return {complete: incompleteRows.length === 0, incomplete: incompleteRows.length,
        pending: pending.filter(job => job.row.start >= since).length, deadlineMs: ACCOUNTING_DEADLINE_MS,
        ...(inFlight === 0 ? {} : {inFlight})};
    } finally {if (timer !== undefined) clearTimeout(timer);}
  }, stop: () => {
    stopped = true; detach();
    for (const job of jobs) job.active = false;
    jobs.clear();
  }};
}
