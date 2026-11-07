import {expect, test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- exercise the actual Inspector polling envelope without a browser or Simulator
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- execute the actual serialized page expressions against an isolated fixture document
import {runInNewContext} from 'node:vm';

interface Ledger {sampledAt: number; stop: {leg: string; phase: string}; claims: string[]}
interface Hooks {tick?: (turn: number, page: Page) => void; reject?: boolean; timeout?: number; finish?: number}
interface Page {window: {identity: {token: string; timeOrigin: number}; __frameFloorGridProgress: () => Ledger}; pending: Promise<unknown>}
type Factory = (raw: (expression: string) => Promise<unknown>, observe: (ledger: Ledger) => void) => (expression: string, timeout: number) => Promise<unknown>;
const factory = (value: unknown): value is Factory => typeof value === 'function';

async function evaluation(hooks: Hooks = {}) {
  const source = readFileSync(new URL('../scripts/frame-floor.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('function evaluator('), end = source.indexOf('\nasync function waitReady(', start);
  if (start === -1 || end <= start) throw new Error('Actual frame-floor evaluator missing');
  let complete: ((value: unknown) => void) | undefined, refuse: ((error: Error) => void) | undefined;
  const pending = new Promise<unknown>((resolve, reject) => { complete = resolve; refuse = reject; });
  const ledger: Ledger = {sampledAt: 100, stop: {leg: 'pine', phase: 'drive'}, claims: Array.from({length: 256}, (_, index) => `owned-${index}`)};
  const page: Page = {window: {identity: {token: 'original', timeOrigin: 1000}, __frameFloorGridProgress: () => ledger}, pending};
  const observed: Ledger[] = [], envelopes: string[] = [];
  let now = 0, turn = 0;
  const value: unknown = runInNewContext(`let evalSequence=0,evaluationOriginDriftMaxMs=0;
    function gridFloorDocumentIdentity(){return window.identity;}
    (${source.slice(start, end)})`, {Date: {now: () => now}, sleep: () => {
      now += 100; turn++;
      hooks.tick?.(turn, page);
      if (turn === (hooks.finish ?? 20)) {
        if (hooks.reject) refuse?.(new Error('original producer refused'));
        else complete?.({original: true});
      }
      return Promise.resolve();
    }});
  if (!factory(value)) throw new Error('Actual evaluator did not load');
  const raw = (expression: string): Promise<unknown> => {
    const result: unknown = runInNewContext(expression, page);
    if (typeof result === 'string' && result.includes('"state":')) envelopes.push(result);
    return Promise.resolve(result);
  };
  let result: unknown, error: unknown;
  try { result = await value(raw, row => { observed.push(structuredClone(row)); })('pending', hooks.timeout ?? 5000); }
  catch (caught) { error = caught; }
  return {result, error, observed, envelopes, turns: turn, keys: Object.keys(page).filter(key => key.startsWith('__frameFloorEval'))};
}

test('serializes one unchanged ledger while keeping every result poll and the original value', async () => {
  const result = await evaluation();
  expect(result.error).toBeUndefined();
  expect(result.result).toEqual({original: true});
  expect(result.envelopes.length).toBeGreaterThanOrEqual(20);
  expect(result.observed).toHaveLength(1);
  expect(result.envelopes.filter(row => row.includes('owned-255'))).toHaveLength(1);
  expect(result.keys).toEqual([]);
});

test('delivers new samples and same-clock leg or phase changes before completion', async () => {
  const result = await evaluation({finish: 5, tick: (turn, page) => {
    const row = page.window.__frameFloorGridProgress();
    if (turn === 1) row.stop.phase = 'arrival';
    if (turn === 2) row.stop.leg = 'nalati';
    if (turn === 3) row.sampledAt++;
  }});
  expect(result.error).toBeUndefined();
  expect(result.observed.map(row => [row.sampledAt, row.stop.leg, row.stop.phase])).toEqual([
    [100, 'pine', 'drive'], [100, 'pine', 'arrival'], [100, 'nalati', 'arrival'], [101, 'nalati', 'arrival'],
  ]);
  expect(result.keys).toEqual([]);
});

test('keeps the original producer refusal and clears its envelope', async () => {
  const result = await evaluation({reject: true, finish: 2});
  expect(String(result.error)).toContain('original producer refused');
  expect(result.keys).toEqual([]);
});

test('refuses a document change even when the unchanged ledger is omitted', async () => {
  const result = await evaluation({tick: (turn, page) => { if (turn === 2) page.window.identity.token = 'replacement'; }});
  expect(String(result.error)).toContain('document changed');
  expect(result.turns).toBe(2);
  expect(result.keys).toEqual([]);
});

test('keeps the original timeout budget for an unfinished evaluation', async () => {
  const result = await evaluation({timeout: 600, finish: 100});
  expect(String(result.error)).toContain('Browser evaluation timed out: pending');
  expect(result.turns).toBe(6);
  expect(result.keys).toEqual([]);
});
