import { expect, test } from 'vitest';
import { TraversalReadiness, readinessModel, type ReadinessBundle, type ReadinessLink } from './readiness';
import { CONTENT_CAPS } from '../core/config';

const bundle = (): ReadinessBundle => ({ criticalWireBytes: 125000, hybridWireBytes: 62500, decodeSeconds: 0.5, runtimeParseSeconds: 0.25 });
const link = (): ReadinessLink => ({ speed: 2, linkBitsPerSecond: 1000000, requestLatencySeconds: 0.25, maxStallSeconds: 1 });

test('scalar readiness retains every fence combination and stale-generation refusal', () => {
  const readiness = new TraversalReadiness(), estimate = readinessModel(bundle(), link());
  expect(readiness.isReady(null)).toBe(false); expect(readiness.isReady('missing')).toBe(false);
  for (let mask = 0; mask < 8; mask++) {
    const instance = `cell-${mask}`, ticket = readiness.request(instance, 0, estimate, true);
    if (ticket === null) throw new Error('Missing readiness ticket');
    if (mask & 1) readiness.complete(ticket, 'colliders');
    if (mask & 2) readiness.complete(ticket, 'sim');
    if (mask & 4) readiness.complete(ticket, 'runtime');
    expect(readiness.isReady(instance)).toBe(mask === 7);
    expect(readiness.isReady(instance)).toBe(readiness.status(instance).ready);
    readiness.invalidate(instance);
    expect(readiness.isReady(instance)).toBe(false);
    const next = readiness.request(instance, 0, estimate, false);
    if (next === null) throw new Error('Missing replacement readiness ticket');
    expect(readiness.complete(ticket, 'colliders')).toBe(false);
    expect(readiness.isReady(instance)).toBe(false);
    readiness.complete(next, 'colliders'); readiness.complete(next, 'sim');
    expect(readiness.isReady(instance)).toBe(true);
    const status = readiness.status(instance); status.ready = false; status.runtime = false;
    expect(readiness.isReady(instance)).toBe(true);
    expect(readiness.status(instance).runtime).toBe(true);
  }
});

test('cold travel retains critical work, the second request and zero-byte runtime parsing', () => {
  expect(readinessModel(bundle(), link())).toEqual({ criticalTransferSeconds: 1, hybridTransferSeconds: 0.5,
    criticalSeconds: 2.75, hybridSeconds: 1, seconds: 3.75, distance: 7.5 });
  expect(readinessModel({ ...bundle(), hybridWireBytes: 0 }, link())).toEqual({ criticalTransferSeconds: 1, hybridTransferSeconds: 0,
    criticalSeconds: 2.75, hybridSeconds: 0.25, seconds: 3, distance: 6 });
});

for (const field of ['criticalWireBytes', 'hybridWireBytes', 'decodeSeconds', 'runtimeParseSeconds'] as const) {
  test.each([Number.NaN, Infinity, -Infinity, -1])(`invalid bundle ${field} refuses (%s)`, value => {
    expect(() => readinessModel({ ...bundle(), [field]: value }, link())).toThrow('Invalid readiness envelope');
  });
}
for (const field of ['speed', 'linkBitsPerSecond', 'requestLatencySeconds', 'maxStallSeconds'] as const) {
  test.each([Number.NaN, Infinity, -Infinity, -1])(`invalid link ${field} refuses (%s)`, value => {
    expect(() => readinessModel(bundle(), { ...link(), [field]: value })).toThrow('Invalid readiness envelope');
  });
}

test('byte integers, the critical cap and positive link rate retain their independent fence', () => {
  for (const row of [{ ...bundle(), criticalWireBytes: 0.5 }, { ...bundle(), hybridWireBytes: 0.5 },
    { ...bundle(), criticalWireBytes: CONTENT_CAPS.sim.compressed + 1 }, { ...bundle(), hybridWireBytes: Number.MAX_SAFE_INTEGER + 1 }]) {
    expect(() => readinessModel(row, link())).toThrow('Critical wire cap or invalid link rate');
  }
  expect(() => readinessModel(bundle(), { ...link(), linkBitsPerSecond: 0 })).toThrow('Critical wire cap or invalid link rate');
  expect(readinessModel({ ...bundle(), criticalWireBytes: CONTENT_CAPS.sim.compressed }, link()).distance).toBeGreaterThan(0);
});

test('negative zero remains accepted and keeps its transfer and distance signs', () => {
  const result = readinessModel({ criticalWireBytes: -0, hybridWireBytes: -0, decodeSeconds: -0, runtimeParseSeconds: -0 },
    { speed: -0, linkBitsPerSecond: 1, requestLatencySeconds: -0, maxStallSeconds: -0 });
  expect(Object.is(result.criticalTransferSeconds, -0)).toBe(true);
  expect(Object.is(result.hybridTransferSeconds, -0)).toBe(true);
  expect(Object.is(result.distance, -0)).toBe(true);
});

test.each([false, true])('all eight initial fields are read before validation; later reads stay fresh (invalid=%s)', invalid => {
  const reads: string[] = [], observe = (name: string, value: number): number => { reads.push(name); return value; };
  const b: ReadinessBundle = {
    get criticalWireBytes() { return observe('critical', invalid ? Number.NaN : 125000); },
    get hybridWireBytes() { return observe('hybrid', 62500); },
    get decodeSeconds() { return observe('decode', 0.5); },
    get runtimeParseSeconds() { return observe('parse', 0.25); },
  };
  const l: ReadinessLink = {
    get speed() { return observe('speed', 2); },
    get linkBitsPerSecond() { return observe('bits', 1000000); },
    get requestLatencySeconds() { return observe('latency', 0.25); },
    get maxStallSeconds() { return observe('stall', 1); },
  };
  const initial = ['critical', 'hybrid', 'decode', 'parse', 'speed', 'bits', 'latency', 'stall'];
  if (invalid) {
    expect(() => readinessModel(b, l)).toThrow('Invalid readiness envelope');
    expect(reads).toEqual(initial);
  } else {
    expect(readinessModel(b, l).distance).toBe(7.5);
    expect(reads).toEqual([...initial, 'critical', 'hybrid', 'critical', 'bits', 'critical', 'bits', 'hybrid', 'bits',
      'latency', 'stall', 'decode', 'hybrid', 'latency', 'parse', 'speed']);
  }
});
