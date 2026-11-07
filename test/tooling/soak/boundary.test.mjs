import { test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the original Node strict assertion semantics in this Node-only tool regression.
import assert from 'node:assert/strict';
import { captureBoundary, circuitDiagnostic, circuitPlans, summarizeHeap } from '../../../scripts/soak/boundary.mjs';

const context = { qualifying: false, dryRun: false, contentCut: null, firstCrossing: false, layout: 'dev', leg: 'cells', routeScope: 'prepared' };
const pose = { document: 'original', origin: 100.2, token: 'same-document', current: 'driftwood-isle', inside: 'driftwood-isle', pending: [], gameplayReady: true, memory: { allocations: [] } };
const heap = JSON.stringify({ version: 3, nodes: [1, 100, 0, 0, 2, 200, 1, 0, 3, 40, 0, 0], nodeClassNames: ['Object', 'ArrayBuffer'] });
function fixture(cycle, overrides = {}) {
  const calls = [], writes = new Map();
  const driver = { evaluate() { calls.push('state'); return Promise.resolve(pose); }, send(method) { calls.push(method); return Promise.resolve({ snapshotData: heap, timestamp: 10 }); } };
  return { calls, writes, options: { driver, pid: 456, out: '/probe', cycle, document: pose.document, origin: { token: pose.token, timeOrigin: 100 },
    categories: () => { calls.push('categories'); return Promise.resolve({ samples: [{ timestamp: 1 }], errors: [] }); },
    collect: () => { calls.push('collect'); return Promise.resolve(); }, command: (binary, args) => { calls.push([binary, ...args]); return Promise.resolve('native output'); },
    write: (path, text) => writes.set(path, text), ...overrides } };
}
test('four-circuit mode refuses every mixed/qualifying mode and preserves the original warm-up plans', () => {
  assert.equal(circuitDiagnostic('', context), null); assert.equal(circuitDiagnostic(4, context), 4);
  for (const changed of [{ qualifying: true }, { dryRun: true }, { contentCut: {} }, { firstCrossing: true }, { layout: 'shipped' }, { leg: 'road' }, { routeScope: 'catalogue' }]) {
    assert.throws(() => circuitDiagnostic(4, { ...context, ...changed }), /Four-circuit/);
  }
  assert.throws(() => circuitDiagnostic(3, context), /Four-circuit/);
  const route = { plans: ['cell'], coveragePlans: ['crossroads'] };
  assert.deepEqual(circuitPlans(route, 0, null), ['crossroads', 'cell']);
  assert.deepEqual(circuitPlans(route, 1, null), ['cell']);
  assert.deepEqual(circuitPlans(route, 0, 4), ['cell']);
});
test('native and passive readings precede the intrusive heap, all reads use the same PID, and raw heap is retained', async () => {
  const f = fixture(2), row = await captureBoundary(f.options);
  assert.deepEqual(f.calls.filter(Array.isArray), [['vmmap', '-summary', '456'], ['vmmap', '-v', '456'], ['footprint', '-f', 'bytes', '-p', '456']]);
  assert.ok(f.calls.indexOf('Heap.snapshot') > f.calls.indexOf('categories'));
  assert.equal(f.writes.get('/probe/boundary-2-heap.json'), heap);
  assert.equal(row.heap.summary.estimatedBytes, 340); assert.equal(row.heap.summary.nodes, 3);
  assert.equal(row.heap.sha256.length, 64); assert.deepEqual(row.errors, []);
  assert.equal(f.calls.at(-2), 'state'); assert.equal(f.calls.at(-1), 'collect');
  assert.equal(f.calls.filter(c => c === 'Heap.disable').length, 1);
});
test('only boundaries two and four snapshot; passive unsupported/native failures are recorded rather than zeroed', async () => {
  for (const cycle of [0, 1, 3, 4]) {
    const f = fixture(cycle, { command: () => Promise.reject(new Error('native denied')), categories: () => Promise.resolve({ samples: [], errors: ['unsupported'] }) });
    const row = await captureBoundary(f.options);
    assert.equal(f.calls.includes('Heap.snapshot'), cycle === 4);
    assert.equal(row.errors.length, 5); assert.match(row.native.vmmapVerbose.error, /native denied/);
  }
});
test('snapshot refusal still disables Heap, and malformed raw data is saved before schema refusal', async () => {
  const f = fixture(4); f.options.driver.send = method => { f.calls.push(method); return Promise.resolve({ snapshotData: 'bad json' }); };
  const row = await captureBoundary(f.options);
  assert.equal(f.writes.get('/probe/boundary-4-heap.json'), 'bad json');
  assert.match(row.heap.error, /SyntaxError/); assert.ok(f.calls.includes('Heap.disable'));
  const g = fixture(2); g.options.driver.send = method => { g.calls.push(method); return Promise.reject(new Error('unsupported')); };
  const refused = await captureBoundary(g.options);
  assert.equal(refused.errors.length, 2); assert.ok(g.calls.includes('Heap.disable'));
});
test('boundary refuses PID/navigation/region changes before touching native tools; Safari time-origin drift is recorded', async () => {
  const drift = fixture(0); assert.equal((await captureBoundary(drift.options)).before.origin, 100.2);
  const badPid = fixture(0, { pid: null }); await assert.rejects(captureBoundary(badPid.options), /fixed game/);
  for (const changed of [{ document: 'next' }, { token: 'next' }, { current: 'pine-hollow' }, { inside: null }, { pending: ['next'] }, { gameplayReady: false }]) {
    const f = fixture(0); f.options.driver.evaluate = () => Promise.resolve({ ...pose, ...changed });
    await assert.rejects(captureBoundary(f.options), /Settled boundary/); assert.equal(f.calls.filter(Array.isArray).length, 0); assert.equal(f.writes.size, 1);
  }
});
test('heap summary counts class estimates and refuses malformed/negative/nonfinite snapshots', () => {
  assert.deepEqual(summarizeHeap(heap).classes, [{ kind: 'ArrayBuffer', bytes: 200, nodes: 1 }, { kind: 'Object', bytes: 140, nodes: 2 }]);
  for (const input of [{ version: 3, type: 'GCDebugging', nodes: [1, 100, 0, 0], nodeClassNames: ['Object'] },
    { version: 3, type: 'FutureInspector', nodes: [1, 100, 0, 0], nodeClassNames: ['Object'] }, { version: 2, nodes: [], nodeClassNames: [] }, { version: 3, nodes: [0], nodeClassNames: [] },
    { version: 3, nodes: [1, -1, 0, 0], nodeClassNames: ['Object'] }, { version: 3, nodes: [1, 3, 9, 0], nodeClassNames: [] }]) {
    assert.throws(() => summarizeHeap(JSON.stringify(input)), /WebKit heap/);
  }
});
