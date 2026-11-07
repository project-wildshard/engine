import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the maintained runner without admitting a browser or Simulator
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- inject failing Inspector and native cleanup at the actual runner boundary
import {runInNewContext} from 'node:vm';

const source = readFileSync(new URL('../scripts/frame-floor.mjs', import.meta.url), 'utf8');
function actual(start: string, end: string) {
  const first = source.indexOf(start), last = source.indexOf(end, first);
  if (first === -1 || last <= first) throw new Error('Maintained frame-floor function missing');
  return source.slice(first, last);
}
interface Failure {
  error: string; complete: boolean; pass: boolean; diagnostic: unknown;
  diagnosticError?: string; unloadError?: string; entryReadFailures?: unknown;
}
interface Driver {
  load: () => Promise<void>; evaluate: () => Promise<unknown>; unload: () => Promise<void>;
  errors: () => Promise<string[]>; progress: () => null;
}
type Measure = (driver: Driver, shard: string, deadline: number) => Promise<Failure>;
const isMeasure = (value: unknown): value is Measure => typeof value === 'function';
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

async function failedMeasurement(diagnosticFails: boolean, unloadFails: boolean) {
  const value: unknown = runInNewContext(`(${actual('async function measureShard(', '\n/** Long tasks')})`, {
    surface: 'sim', evaluationOriginDriftMaxMs: 0, errorText,
    enterGrid: () => { throw Object.assign(new Error('The grid did not finish loading within 240 seconds'), {entryReadFailures: [{elapsedMs: 239000, error: 'Inspector closed'}]}); },
    gridFloorRuntimeFailure: () => null, console: {error: () => undefined},
  });
  if (!isMeasure(value)) throw new Error('Actual measurement did not load');
  let unloads = 0;
  const result = await value({
    load: () => Promise.resolve(),
    evaluate: () => diagnosticFails ? Promise.reject(new Error('Diagnostic Inspector timeout')) : Promise.resolve({state: 'loading', documentOrigin: 123}),
    errors: () => Promise.resolve(['Inspector closed']), progress: () => null,
    unload: () => { unloads++; return unloadFails ? Promise.reject(new Error('Missing native/GPU samples')) : Promise.resolve(); },
  }, 'grid', 0);
  return {result, unloads};
}

test('native cleanup cannot replace the original grid refusal and page diagnostic', async () => {
  const {result, unloads} = await failedMeasurement(false, true);
  expect(result.error).toContain('240 seconds');
  expect(result.diagnostic).toEqual({state: 'loading', documentOrigin: 123});
  expect(result.entryReadFailures).toEqual([{elapsedMs: 239000, error: 'Inspector closed'}]);
  expect(result.unloadError).toBe('Missing native/GPU samples');
  expect(result.complete).toBe(false);
  expect(result.pass).toBe(false);
  expect(unloads).toBe(1);
});

test('unavailable diagnostics and missing native samples remain separate refusals', async () => {
  const {result, unloads} = await failedMeasurement(true, true);
  expect(result.error).toContain('240 seconds');
  expect(result.diagnostic).toBeNull();
  expect(result.diagnosticError).toBe('Diagnostic Inspector timeout');
  expect(result.unloadError).toBe('Missing native/GPU samples');
  expect(result.complete).toBe(false);
  expect(result.pass).toBe(false);
  expect(unloads).toBe(1);
});

test('successful cleanup preserves the original failed measurement without an unload error', async () => {
  const {result, unloads} = await failedMeasurement(false, false);
  expect(result.error).toContain('240 seconds');
  expect(result.unloadError).toBeUndefined();
  expect(result.diagnosticError).toBeUndefined();
  expect(result.pass).toBe(false);
  expect(unloads).toBe(1);
});

type Enter = (driver: {evaluate: () => Promise<unknown>}) => Promise<void>;
const isEnter = (value: unknown): value is Enter => typeof value === 'function';
test('the original grid deadline retains Inspector failures without replay or a longer cap', async () => {
  let now = 0, calls = 0;
  const sleeps: number[] = [];
  const value: unknown = runInNewContext(`(${actual('async function enterGrid(', '\n/** Reject a standing')})`, {
    publicGrid: false, Date: {now: () => now}, Error, errorText, status: () => undefined,
    handoffFloorGridNavigation: () => Promise.resolve(),
    sleep: (ms: number) => { sleeps.push(ms); now += ms; return Promise.resolve(); },
  });
  if (!isEnter(value)) throw new Error('Actual grid admission did not load');
  let failure: unknown;
  try {
    await value({evaluate: () => {
      calls++;
      if (calls === 1) return Promise.resolve(true);
      now += 10000;
      return Promise.reject(new Error('Lost active evaluation', {cause: new Error('Runtime.evaluate timeout')}));
    }});
  } catch (error) { failure = error; }
  expect(failure).toMatchObject({message: 'The grid did not finish loading within 240 seconds',
    entryReadFailures: Array.from({length: calls - 1}, (_, i) => ({elapsedMs: 10800 + i * 10300, error: 'Lost active evaluation', cause: 'Runtime.evaluate timeout'}))});
  expect(now).toBeGreaterThanOrEqual(240000);
  expect(now).toBeLessThan(250300);
  expect(sleeps).toEqual([800, ...Array.from({length: calls - 1}, () => 300)]);
});

type Retry = (expression: string, timeout?: number) => Promise<unknown>;
const isRetry = (value: unknown): value is Retry => typeof value === 'function';
function inspectorRefusal(failure?: string) {
  const order: string[] = [], messages: string[] = [];
  const value: unknown = runInNewContext(`(() => {
    ${actual('const retryEvaluate = async (', '\n      driver = {')}
    return retryEvaluate;
  })()`, {
    Error, errorText, currentUrl: 'fixed-original-url',
    evaluate: () => { order.push('evaluate'); return failure === undefined ? Promise.resolve(42) : Promise.reject(new Error(failure)); },
    process: {pid: 917, stderr: {write: (message: string) => { order.push('stderr'); messages.push(message); }}},
    connect: (url: string) => { expect(url).toBe('fixed-original-url'); order.push('connect'); return Promise.resolve(); },
    inspector: {raw: (expression: string) => { expect(expression).toBe('performance.timeOrigin'); order.push('origin'); return Promise.resolve(123); }},
  });
  if (!isRetry(value)) throw new Error('Actual Inspector refusal boundary missing');
  return {retry: value, order, messages};
}

test('Inspector timeout is forwarded to inherited stderr before reconnect without replay', async () => {
  const {retry, order, messages} = inspectorRefusal('Web Inspector timed out: Runtime.evaluate');
  await expect(retry('original measurement')).rejects.toMatchObject({
    message: 'Safari inspector lost the active evaluation; refusing to replay the measurement', documentOrigin: 123,
    cause: {message: 'Web Inspector timed out: Runtime.evaluate'},
  });
  expect(order).toEqual(['evaluate', 'stderr', 'connect', 'origin']);
  expect(messages).toHaveLength(1);
  expect(messages[0]).toMatch(/^Safari Inspector failure: Web Inspector timed out: Runtime.evaluate; at=.+ worker=917; refusing replay\n$/u);
});

test('actual target changes remain distinct and never reconnect or replay the evaluation', async () => {
  const {retry, order, messages} = inspectorRefusal('Web Inspector target changed');
  await expect(retry('original measurement')).rejects.toMatchObject({cause: {message: 'Web Inspector target changed'}});
  expect(order).toEqual(['evaluate', 'stderr', 'origin']);
  expect(messages[0]).toContain('Safari Inspector failure: Web Inspector target changed;');
});

test('successful evaluations and ordinary game refusals do not emit Inspector diagnostics', async () => {
  const success = inspectorRefusal();
  await expect(success.retry('original measurement')).resolves.toBe(42);
  const failure = inspectorRefusal('original game refusal');
  await expect(failure.retry('original measurement')).rejects.toThrow('original game refusal');
  for (const row of [success, failure]) {
    expect(row.order).toEqual(['evaluate']);
    expect(row.messages).toEqual([]);
  }
});
