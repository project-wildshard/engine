import { expect, test } from 'vitest';
import { rows } from '../scripts/loading-flow/sweep-report.mjs';

// J136: the sweep's verdict per row. A row with nothing to read is never a pass.
const nothing = { gates: {}, flows: {}, titled: null, untitled: null, tasks: null, programs: null, digest: null };
const greenGate = { pass: true, violations: [], requests: { codeBeforeControl: [], spawnRereads: { files: 0, bytes: 0, first: [] }, serverReads: { beforeControl: 3, afterControl: 0, bytes: 9 } } };
const seven = Object.fromEntries(['driftwood-isle', 'far-reach', 'nalati-grasslands', 'nine-dragon-stack', 'pine-hollow', 'sunscar-dunes', 'grid'].map(name => [name, greenGate]));
const state = (reading, id) => rows(reading).find(row => row.id === id)?.state;
const play = { firstSecondFps: 29, settledFps: 30 };
const mode = (controlS, pass = true) => ({ controlS, pass, bar: { reachesControl: true, playSteadyFromSecondOne: pass, playNoFrameOver250ms: true }, cardStill_ge1s: [], setupStalls_ge3s: [], play, loading: { byStep: [] } });
const pair = (packs, loose) => ({ packs: { timeline: { cold: mode(packs), warm: mode(packs) }, warmPerf: { res: [] } }, shardfile: { timeline: { cold: mode(loose), warm: mode(loose) }, warmPerf: null } });
function pairs(packs = 10, loose = 12) {
  const flows = {};
  for (const shard of ['driftwood', 'nine', 'pine']) for (const n of [1, 2, 3]) { const run = pair(packs, loose); flows[`${shard}#${n}/packs`] = run.packs; flows[`${shard}#${n}/shardfile`] = run.shardfile; }
  return flows;
}

test('nothing read is NOT READ on every row, and the sweep cannot pass', () => {
  expect(rows(nothing).map(row => row.state).every(value => value === 'NOT READ')).toBe(true);
});

test('seven green flows pass DL15, DL17, DL25 and DL1; six are not a sweep', () => {
  const reading = { ...nothing, gates: seven };
  for (const id of ['DL1', 'DL15', 'DL17', 'DL25']) expect(state(reading, id)).toBe('PASS');
  const six = { ...seven }; delete six.grid;
  expect(state({ ...nothing, gates: six }, 'DL17')).toBe('FAIL');
});

test('code before control fails DL1, and a re-read part fails DL25 by its bytes', () => {
  const late = { ...greenGate, requests: { ...greenGate.requests, codeBeforeControl: ['/b/abc/main.js'] } };
  expect(state({ ...nothing, gates: { ...seven, grid: late } }, 'DL1')).toBe('FAIL');
  const moved = { ...greenGate, requests: { ...greenGate.requests, spawnRereads: { files: 1, bytes: 836_316, first: ['/assets/physics/rapier.wasm'] } } };
  const line = rows({ ...nothing, gates: { ...seven, grid: moved } }).find(row => row.id === 'DL25');
  expect(line).toMatchObject({ state: 'FAIL', text: expect.stringContaining('grid 1 files 0.84 MB') });
});

test('DL5 needs all three pairs no slower; one slower run fails it', () => {
  expect(state({ ...nothing, flows: pairs() }, 'DL5')).toBe('PASS');
  const flows = pairs();
  flows['pine#2/packs'].timeline.cold.controlS = 13;
  expect(state({ ...nothing, flows }, 'DL5')).toBe('FAIL');
  const short = pairs();
  delete short['nine#3/packs'];
  expect(state({ ...nothing, flows: short }, 'DL5')).toBe('FAIL');
});

test('DL18 counts warm parts and reports code bytes beside them (J139)', () => {
  const flows = pairs();
  flows['nine#1/packs'].warmPerf = { res: [{ n: '/b/abc/main.js', b: 2_000_000 }] };
  expect(rows({ ...nothing, flows }).find(row => row.id === 'DL18')).toMatchObject({ state: 'PASS', text: expect.stringContaining('code 2.00 MB') });
  flows['pine#1/packs'].warmPerf = { res: [{ n: '/assets/spawn/parts/a.pack.br', b: 900 }] };
  expect(state({ ...nothing, flows }, 'DL18')).toBe('FAIL');
});

test('a digest this Mac could not read is not a reading', () => {
  expect(state({ ...nothing, digest: 'telemetry: no key\n' }, 'DL20')).toBe('NOT READ');
  expect(state({ ...nothing, digest: 'telemetry digest=2026-11-04: {}\n' }, 'DL20')).toBe('PASS');
});

test('a short program list fails DL10 by name, and play\'s long tasks are not DL11\'s', () => {
  const lists = 'driftwood-isle: 88 / 90 entry programs on x are in y\nfar-reach: 92 / 92 entry programs on x are in y\n';
  expect(rows({ ...nothing, programs: lists }).find(row => row.id === 'DL10')).toMatchObject({ state: 'FAIL', text: expect.stringContaining('driftwood-isle 88 / 90') });
  expect(state({ ...nothing, programs: 'far-reach: 92 / 92 entry programs on x are in y\n' }, 'DL10')).toBe('PASS');
  expect(state({ ...nothing, programs: 'bake failed\n' }, 'DL10')).toBe('NOT READ');
  expect(state({ ...nothing, gridWarm: { tap: 1, control: 10, longTasks: [{ start: 5 }, ...Array.from({ length: 30 }, () => ({ start: 11 }))] } }, 'DL11')).toBe('PASS');
});

test('a phone-link reading passes on its own bar', () => {
  // J143: DL11 is a named exception; the count stays in the row, and DL21 and DL23 judge what the player sees.
  expect(state({ ...nothing, gridWarm: { longTasks: Array.from({ length: 21 }, () => ({ start: 1 })) } }, 'DL11')).toBe('PASS');
  expect(state({ ...nothing, gridWarm: { longTasks: [] } }, 'DL11')).toBe('PASS');
  expect(state({ ...nothing, titled: { totalMs: 9_000 }, untitled: { totalMs: 12_000 } }, 'DL2')).toBe('PASS');
});
