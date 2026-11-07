import {expect, test} from 'vitest';
import type {Request, Response} from 'playwright';
import {legacyDouble} from '@wildshard/engine/test/FakeGame';
import {NativeSizeLedger} from '../scripts/phone-loading/native-sizes';

function request(url: string, start = 1000, worker = false, method = 'GET', responseEnd = -1): Request {
  return legacyDouble<Request>({url: () => url, method: () => method,
    timing: () => legacyDouble<ReturnType<Request['timing']>>({startTime: start, responseEnd}),
    serviceWorker: () => worker ? legacyDouble<NonNullable<ReturnType<Request['serviceWorker']>>>({}) : null});
}
function begin(ledger: NativeSizeLedger, url: string, id = '1', wallTime = 1, worker = false): void {
  ledger.event('session', worker, 'Network.requestWillBeSent', {requestId: id, wallTime, request: {url, method: 'GET'}});
}
test('real native decoded bodies remain separate from compressed and cached wire bytes', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/gzip'; begin(ledger, url);
  ledger.event('session', false, 'Network.responseReceived', {requestId: '1', response: {encodedDataLength: 176}});
  ledger.event('session', false, 'Network.dataReceived', {requestId: '1', dataLength: 4600, encodedDataLength: 70});
  ledger.event('session', false, 'Network.loadingFinished', {requestId: '1', encodedDataLength: 246});
  expect(ledger.read(request(url))).toMatchObject({decodedBytes: 4600, encodedBytes: 70, transferBytes: 246});
  begin(ledger, url, '2', 2);
  ledger.event('session', false, 'Network.responseReceived', {requestId: '2', response: {encodedDataLength: 0, fromDiskCache: true}});
  ledger.event('session', false, 'Network.dataReceived', {requestId: '2', dataLength: 4600, encodedDataLength: 0});
  ledger.event('session', false, 'Network.loadingFinished', {requestId: '2', encodedDataLength: 0});
  expect(ledger.read(request(url, 2000))).toMatchObject({decodedBytes: 4600, encodedBytes: 0, transferBytes: 0});
});
test('local blob transfer sentinel and SW responses retain actual delivered bodies', () => {
  const ledger = new NativeSizeLedger();
  for (const [url, sw] of [['blob:https://game.test/native', false], ['https://game.test/sw', true]] as const) {
    begin(ledger, url, url);
    ledger.event('session', false, 'Network.responseReceived', {requestId: url, response: {encodedDataLength: -1, fromServiceWorker: sw}});
    ledger.event('session', false, 'Network.dataReceived', {requestId: url, dataLength: 19, encodedDataLength: 0});
    ledger.event('session', false, 'Network.loadingFinished', {requestId: url, encodedDataLength: sw ? 0 : -1});
    expect(ledger.read(request(url))).toMatchObject({decodedBytes: 19, encodedBytes: 0, transferBytes: 0});
  }
});
test('redirects and simultaneous worker/page requests never merge by URL', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/shared'; begin(ledger, url);
  ledger.event('session', false, 'Network.requestWillBeSent', {requestId: '1', wallTime: 2,
    request: {url, method: 'GET'}, redirectResponse: {encodedDataLength: 151}});
  ledger.event('session', false, 'Network.responseReceived', {requestId: '1', response: {encodedDataLength: 100}});
  ledger.event('session', false, 'Network.dataReceived', {requestId: '1', dataLength: 25, encodedDataLength: 25});
  ledger.event('session', false, 'Network.loadingFinished', {requestId: '1', encodedDataLength: 125});
  begin(ledger, url, 'worker', 2, true);
  ledger.event('session', true, 'Network.responseReceived', {requestId: 'worker', response: {encodedDataLength: 80}});
  ledger.event('session', true, 'Network.dataReceived', {requestId: 'worker', dataLength: 4, encodedDataLength: 4});
  ledger.event('session', true, 'Network.loadingFinished', {requestId: 'worker', encodedDataLength: 84});
  expect(ledger.read(request(url))).toMatchObject({transferBytes: 151});
  expect(ledger.read(request(url, 2000))).toMatchObject({transferBytes: 125, decodedBytes: 25});
  expect(ledger.read(request(url, 2000, true))).toMatchObject({transferBytes: 84, decodedBytes: 4});
});
test('unmatched, unfinished or ambiguous native identities never grant another request bytes', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/ambiguous'; begin(ledger, url);
  expect(ledger.read(request(url, 5000))).toBeNull();
  const active = request(url); expect(ledger.read(active)).toBeNull();
  ledger.event('session', false, 'Network.loadingFinished', {requestId: '1', encodedDataLength: 0});
  expect(ledger.read(active)).toMatchObject({transferBytes: 0, encodedBytes: 0});
  begin(ledger, url, '2', 2); begin(ledger, url, '3', 2);
  expect(ledger.read(request(url, 2000))).toBeNull();
});
test('network timing uses Playwright response requestTime without weakening native identity matching', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/timed';
  ledger.event('s', false, 'Network.requestWillBeSent', {requestId: '1', wallTime: 1, timestamp: 10, request: {url, method: 'GET'}});
  ledger.event('s', false, 'Network.responseReceived', {requestId: '1', response: {encodedDataLength: 80, timing: {requestTime: 10.15}}});
  ledger.event('s', false, 'Network.dataReceived', {requestId: '1', dataLength: 4, encodedDataLength: 4});
  ledger.event('s', false, 'Network.loadingFinished', {requestId: '1', encodedDataLength: 84});
  expect(ledger.read(request(url, 1150))).toMatchObject({decodedBytes: 4, encodedBytes: 4, transferBytes: 84});
});
test('304 wire bytes are headers, independently from the cached response body', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/revalidated'; begin(ledger, url);
  ledger.event('session', false, 'Network.responseReceived', {requestId: '1', response: {encodedDataLength: 0, fromDiskCache: true}});
  ledger.event('session', false, 'Network.responseReceivedExtraInfo', {requestId: '1', statusCode: 304});
  ledger.event('session', false, 'Network.dataReceived', {requestId: '1', dataLength: 4600, encodedDataLength: 0});
  ledger.event('session', false, 'Network.loadingFinished', {requestId: '1', encodedDataLength: 164});
  expect(ledger.read(request(url))).toMatchObject({decodedBytes: 4600, encodedBytes: 0, transferBytes: 164});
});
test('a migrated worker request keeps one identity and duplicate native data events count once', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/worker'; begin(ledger, url);
  ledger.event('child', false, 'Network.requestWillBeSent', {requestId: '1', wallTime: 1, request: {url, method: 'GET'}});
  for (const session of ['session', 'child']) {
    ledger.event(session, false, 'Network.responseReceived', {requestId: '1', response: {encodedDataLength: 80}});
    ledger.event(session, false, 'Network.dataReceived', {requestId: '1', timestamp: 2, dataLength: 4, encodedDataLength: 4});
    ledger.event(session, false, 'Network.loadingFinished', {requestId: '1', encodedDataLength: 84});
  }
  expect(ledger.read(request(url))).toMatchObject({decodedBytes: 4, encodedBytes: 4, transferBytes: 84});
});
test('aborted streams retain observed bytes and a partial flag, never a fictitious complete body', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/aborted'; begin(ledger, url);
  ledger.event('session', false, 'Network.responseReceived', {requestId: '1', response: {encodedDataLength: 80}});
  ledger.event('session', false, 'Network.dataReceived', {requestId: '1', dataLength: 12, encodedDataLength: 4});
  ledger.event('session', false, 'Network.loadingFailed', {requestId: '1', canceled: true, errorText: 'net::ERR_ABORTED'});
  expect(ledger.read(request(url))).toMatchObject({decodedBytes: 12, encodedBytes: 4, transferBytes: 84, partial: true});
});
test('an uncached empty POST is zero body; a cached GET still requires body evidence', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/telemetry';
  ledger.event('s', false, 'Network.requestWillBeSent', {requestId: 'post', wallTime: 1, request: {url, method: 'POST'}});
  ledger.event('s', false, 'Network.responseReceived', {requestId: 'post', response: {encodedDataLength: 120, status: 405}});
  ledger.event('s', false, 'Network.loadingFinished', {requestId: 'post', encodedDataLength: 120});
  expect(ledger.read(request(url, 1000, false, 'POST'))).toMatchObject({decodedBytes: 0, encodedBytes: 0, transferBytes: 120});
  begin(ledger, url, 'get', 2);
  ledger.event('session', false, 'Network.responseReceived', {requestId: 'get', response: {encodedDataLength: 0, fromDiskCache: true}});
  ledger.event('session', false, 'Network.loadingFinished', {requestId: 'get', encodedDataLength: 0});
  expect(ledger.read(request(url, 2000))?.decodedBytes).toBeUndefined();
});

test('independent CDP clock drift joins only one overlapping, validated response', () => {
  const url = 'https://game.test/startup.js', headers = {etag: 'exact', 'content-type': 'text/javascript', 'content-encoding': 'br'};
  const response = (values = headers, status = 200): Response => legacyDouble<Response>({headers: () => values, status: () => status, fromServiceWorker: () => false});
  const make = (ids = ['one'], validators: Record<string, string> = headers): NativeSizeLedger => {
    const ledger = new NativeSizeLedger();
    for (const id of ids) {
      ledger.event('s', false, 'Network.requestWillBeSent', {requestId: id, wallTime: 1, timestamp: 10, request: {url, method: 'GET'}});
      ledger.event('s', false, 'Network.responseReceived', {requestId: id, response: {status: 200, headers: validators, encodedDataLength: 80}});
      ledger.event('s', false, 'Network.dataReceived', {requestId: id, dataLength: 123, encodedDataLength: 17});
      ledger.event('s', false, 'Network.loadingFailed', {requestId: id, timestamp: 10.2});
    }
    return ledger;
  };
  const ledger = make(), drifted = request(url, 1005, false, 'GET', 190);
  expect(ledger.read(drifted, response())).toMatchObject({decodedBytes: 123, encodedBytes: 17, transferBytes: 97, partial: true});
  expect(ledger.read(request(url, 1005, false, 'GET', 190), response())).toBeNull(); // already claimed
  expect(make(['one', 'two']).read(drifted, response())).toBeNull();
  expect(make().read(request(url, 2000, false, 'GET', 190), response())).toBeNull();
  expect(make().read(request(url, 1005, true, 'GET', 190), response())).toBeNull();
  expect(make().read(request(url, 1005, false, 'POST', 190), response())).toBeNull();
  expect(make().read(request(url, 1005), response())).toBeNull(); // no completed lifetime
  expect(make().read(drifted, response({...headers, etag: 'other'}))).toBeNull();
  expect(make().read(drifted, response({...headers, 'content-encoding': 'gzip'}))).toBeNull();
  expect(make().read(drifted, response(headers, 404))).toBeNull();
  expect(make(['one'], {}).read(drifted, response())).toBeNull();
});

const facadeHeaders = {etag: 'exact-worker-body', 'content-type': 'text/javascript', 'content-encoding': 'br', 'content-length': '17499'};
function facadeResponse(headers: Record<string, string> = facadeHeaders, sw = true, status = 200): Response {
  return legacyDouble<Response>({headers: () => headers, status: () => status, fromServiceWorker: () => sw});
}
function physicalWorker(ledger: NativeSizeLedger, id = 'physical', start = 1.001, end = 10.104, headers: Record<string, string> = facadeHeaders,
  status = 200, method = 'GET', complete = true): void {
  ledger.event('worker', true, 'Network.requestWillBeSent', {requestId: id, wallTime: start, timestamp: 10,
    request: {url: 'https://game.test/ktx2.worker.js', method}});
  ledger.event('worker', true, 'Network.responseReceived', {requestId: id, response: {status, headers, encodedDataLength: 390}});
  ledger.event('worker', true, 'Network.dataReceived', {requestId: id, dataLength: 40385, encodedDataLength: 17499});
  if (complete) ledger.event('worker', true, 'Network.loadingFinished', {requestId: id, timestamp: end, encodedDataLength: 17889});
}
function unknownFacade(ledger: NativeSizeLedger): Request {
  const url = 'https://game.test/ktx2.worker.js';
  ledger.event('page', false, 'Network.requestWillBeSent', {requestId: 'facade', wallTime: 1, timestamp: 10, request: {url, method: 'GET'}});
  ledger.event('page', false, 'Network.responseReceived', {requestId: 'facade', response: {status: 200, headers: facadeHeaders,
    fromServiceWorker: true, encodedDataLength: -1}});
  ledger.event('page', false, 'Network.loadingFinished', {requestId: 'facade', timestamp: 10.108, encodedDataLength: -1});
  return request(url, 1000, false, 'GET', 108);
}

test.each(['facade-first', 'worker-first'])('unknown SW facade counts physical wire once: %s', order => {
  const ledger = new NativeSizeLedger(), facade = unknownFacade(ledger); physicalWorker(ledger);
  const physicalRequest = request('https://game.test/ktx2.worker.js', 1001, true);
  if (order === 'worker-first') ledger.read(physicalRequest);
  const result = ledger.observe(facade, facadeResponse());
  expect(result).toMatchObject({sizes: {decodedBytes: 40385, encodedBytes: 0, transferBytes: 0, facadeOf: expect.stringContaining('physical')},
    match: {outcome: 'facade-matched', entry: {fromServiceWorker: true, transfer: null}, workerFetch: {worker: true, transfer: 17889}}});
  const physical = ledger.read(physicalRequest);
  expect(physical).toMatchObject({decodedBytes: 40385, encodedBytes: 17499, transferBytes: 17889});
  expect((result.sizes?.transferBytes ?? -1) + (physical?.transferBytes ?? -1)).toBe(17889);
  // A physical Request may be observed before its facade too.
  expect(ledger.observe(facade, facadeResponse()).sizes?.facadeOf).toBe(physical?.requestId);
});

test('an absent page socket joins a facade only by a unique validated native worker lifetime', () => {
  const ledger = new NativeSizeLedger(); physicalWorker(ledger);
  const facade = request('https://game.test/ktx2.worker.js', 1000, false, 'GET', 108);
  expect(ledger.observe(facade, facadeResponse())).toMatchObject({sizes: {encodedBytes: 0, transferBytes: 0},
    match: {basis: 'validated-overlap', outcome: 'facade-matched', workerFetch: {decodedChunks: 40385}}});
});

test.each(['absent', 'ambiguous', 'validator', 'encoding', 'status', 'method', 'unfinished', 'failed', 'before', 'after', 'not-sw', 'facade-status', 'facade-validator'] as const)(
  'unknown facade refuses %s physical evidence and retains bounded match diagnostics', reason => {
    const ledger = new NativeSizeLedger(), facade = unknownFacade(ledger);
    if (reason !== 'absent') physicalWorker(ledger, 'physical', reason === 'before' ? .999 : 1.001,
      reason === 'after' ? 10.2 : 10.104,
      reason === 'validator' ? {...facadeHeaders, etag: 'different'} : reason === 'encoding' ? {...facadeHeaders, 'content-encoding': 'gzip'} : facadeHeaders,
      reason === 'status' ? 404 : 200, reason === 'method' ? 'POST' : 'GET', reason !== 'unfinished');
    if (reason === 'ambiguous') physicalWorker(ledger, 'second');
    if (reason === 'failed') ledger.event('worker', true, 'Network.loadingFailed', {requestId: 'physical', timestamp: 10.104});
    if (reason === 'facade-status' || reason === 'facade-validator') ledger.event('page', false, 'Network.responseReceived', {
      requestId: 'facade', response: {status: reason === 'facade-status' ? 404 : 200, fromServiceWorker: true,
        headers: reason === 'facade-validator' ? {...facadeHeaders, etag: 'different'} : facadeHeaders, encodedDataLength: -1}});
    const found = ledger.observe(facade, facadeResponse(facadeHeaders, reason !== 'not-sw'));
    expect(found.sizes === null || found.sizes.transferBytes === undefined).toBe(true);
    expect(found.match.outcome).not.toBe('facade-matched');
    if (found.match.alternatives !== undefined) expect(found.match.alternatives.length).toBeLessThanOrEqual(2);
  });

test('same URL and time without validators cannot supply missing facade bytes', () => {
  const ledger = new NativeSizeLedger(); physicalWorker(ledger, 'physical', 1.001, 10.104, {'content-type': 'text/javascript'});
  const facade = request('https://game.test/ktx2.worker.js', 1000, false, 'GET', 108);
  const found = ledger.observe(facade, facadeResponse({'content-type': 'text/javascript'}));
  expect(found.sizes).toBeNull(); expect(found.match.outcome).toBe('facade-unmatched');
});

test('match diagnostics truncate retained native headers without truncating matching authority', () => {
  const ledger = new NativeSizeLedger(), huge = 'x'.repeat(2000);
  for (const id of ['one', 'two', 'three']) physicalWorker(ledger, id, 1.001, 10.104, {...facadeHeaders, etag: huge});
  const found = ledger.observe(request('https://game.test/ktx2.worker.js', 1000, false, 'GET', 108), facadeResponse());
  expect(found.sizes).toBeNull(); expect(found.match.alternatives).toHaveLength(2);
  expect(found.match.alternatives?.[0]?.headers['etag']).toHaveLength(512);
  expect(found.match.alternatives?.[0]?.truncated).toBe(true);
});


test('a start-only page native entry uses completed validated worker evidence without inventing its completion', () => {
  const ledger = new NativeSizeLedger(), url = 'https://game.test/ktx2.worker.js';
  begin(ledger, url, 'facade'); physicalWorker(ledger);
  const found = ledger.observe(request(url, 1000, false, 'GET', 108), facadeResponse());
  expect(found).toMatchObject({sizes: {encodedBytes: 0, transferBytes: 0, facadeOf: expect.stringContaining('physical')},
    match: {outcome: 'facade-matched', entry: {complete: false, status: null, headers: {}}, workerFetch: {complete: true, transfer: 17889}}});
});

test.each(['unfinished-response', 'failed', 'wrong-validator', 'no-validator', 'not-sw', 'unfinished-worker', 'ambiguous', 'before', 'after'] as const)(
  'start-only facade still refuses %s evidence', reason => {
    const ledger = new NativeSizeLedger(), url = 'https://game.test/ktx2.worker.js';
    begin(ledger, url, 'facade');
    if (reason === 'unfinished-response') ledger.event('session', false, 'Network.responseReceived', {
      requestId: 'facade', response: {status: 200, headers: facadeHeaders, fromServiceWorker: true, encodedDataLength: -1}});
    if (reason === 'failed') ledger.event('session', false, 'Network.loadingFailed', {requestId: 'facade'});
    physicalWorker(ledger, 'physical', reason === 'before' ? .999 : 1.001, reason === 'after' ? 10.2 : 10.104,
      facadeHeaders, 200, 'GET', reason !== 'unfinished-worker');
    if (reason === 'ambiguous') physicalWorker(ledger, 'other');
    const headers = reason === 'wrong-validator' ? {...facadeHeaders, etag: 'different'} : reason === 'no-validator' ? {} : facadeHeaders;
    const found = ledger.observe(request(url, 1000, false, 'GET', 108), facadeResponse(headers, reason !== 'not-sw'));
    expect(found.match.outcome).not.toBe('facade-matched');
    expect(found.sizes?.facadeOf).toBeUndefined();
  });
