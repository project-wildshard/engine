import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { roadSignPaintLayout } from './roadSignPaint';
import { startRoadSigns } from './roadSignPreparation';
import type { RoadSign } from '../../../shared/game/grid/roadLayout';

const signs: RoadSign[] = [{ at: { x: 0, z: 0 }, facing: { x: 1, z: 0 }, lines: [{ arrow: 'ahead', names: ['Port'], metres: 120 }] }];
const globals = ['Worker', 'OffscreenCanvas'].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
const workers: TestWorker[] = [];
class TestWorker extends EventTarget {
  readonly sent: unknown[] = []; terminated = 0;
  constructor() { super(); workers.push(this); }
  postMessage(message: unknown): void { this.sent.push(message); }
  terminate(): void { this.terminated++; }
  reply(data: unknown): void { this.dispatchEvent(new MessageEvent('message', { data })); }
}
afterEach(() => {
  for (const { key, descriptor } of globals) { if (descriptor === undefined) Reflect.deleteProperty(globalThis, key); else Object.defineProperty(globalThis, key, descriptor); }
  workers.length = 0;
});
function support(): void {
  Object.defineProperty(globalThis, 'Worker', { value: TestWorker, configurable: true, writable: true });
  Object.defineProperty(globalThis, 'OffscreenCanvas', { value: () => undefined, configurable: true, writable: true });
}
function worker(): TestWorker { const found = workers[0]; if (found === undefined) throw new Error('Missing sign worker'); return found; }
test('one complete charged plane is handed to the matching layout and released', async () => {
  support(); const scope = new Scope('sign-test'), allocator = new ResidencyAllocator(), layout = roadSignPaintLayout(signs);
  const job = startRoadSigns(scope, allocator, 'home', signs); if (job === undefined) throw new Error('Missing preparation');
  try {
    expect(job.get(layout)).toBeUndefined(); expect(allocator.entries().map(row => row.bytes)).toEqual([
      layout.width * layout.height * 10 + 131072 + JSON.stringify([...layout.lines.values()]).length * 4 + 1024,
    ]); expect(worker().sent).toHaveLength(1);
    const pixels = new Uint8Array(layout.width * layout.height * 2); pixels[0] = 41;
    worker().reply({ width: layout.width, height: layout.height, pixels }); await job.ready;
    expect(job.get(layout)?.[0]).toBe(41); expect(worker().terminated).toBe(1);
    const changed = roadSignPaintLayout([{ lines: [{ arrow: 'ahead', names: ['Changed'], metres: 120 }] }]);
    expect(job.get(changed)).toBeUndefined();
    job.release(); expect(job.get(layout)).toBeUndefined(); expect(allocator.entries()).toEqual([]); expect(worker().terminated).toBe(1);
  } finally { scope.dispose(); }
});
test.each(['initial', 'outer'] as const)('retirement settles readiness, rejects late publication and clears the transient lease (%s)', async phase => {
  support(); const scope = new Scope('sign-retire'), allocator = new ResidencyAllocator(), layout = roadSignPaintLayout(signs);
  const job = startRoadSigns(scope, allocator, 'home', signs, phase); if (job === undefined) throw new Error('Missing preparation');
  const own = worker(); scope.dispose(); await job.ready;
  own.reply({ width: layout.width, height: layout.height, pixels: new Uint8Array(layout.width * layout.height * 2) });
  expect(job.get(layout)).toBeUndefined(); expect(allocator.entries()).toEqual([]); expect(own.terminated).toBe(1);
});
test.each(['initial', 'outer'] as const)('malformed coverage settles to the original painter without partial bytes (%s)', async phase => {
  support(); const scope = new Scope('sign-malformed'), allocator = new ResidencyAllocator(), layout = roadSignPaintLayout(signs);
  const job = startRoadSigns(scope, allocator, 'home', signs, phase); if (job === undefined) throw new Error('Missing preparation');
  try { worker().reply({ width: layout.width, height: layout.height, pixels: new Uint8Array(2) }); await job.ready;
    expect(job.get(layout)).toBeUndefined(); expect(worker().terminated).toBe(1); expect(allocator.entries()).toEqual([]);
  } finally { scope.dispose(); }
});
test.each(['initial', 'outer'] as const)('unsupported hosts allocate no worker or retained plane (%s)', phase => {
  Object.defineProperty(globalThis, 'Worker', { value: undefined, configurable: true, writable: true });
  const scope = new Scope('sign-unsupported'), allocator = new ResidencyAllocator();
  try { expect(startRoadSigns(scope, allocator, 'home', signs, phase)).toBeUndefined(); expect(allocator.entries()).toEqual([]); expect(workers).toEqual([]); }
  finally { scope.dispose(); }
});
test('layout keeps unique line order, last matching row, slots and exact non-power-of-two height', () => {
  const a = { arrow: 'left' as const, names: ['Port'], metres: 120 }, b = { arrow: 'right' as const, names: ['Hill'], metres: null };
  const last = { ...a, names: ['Port'] }, c = { arrow: 'ahead' as const, names: ['Cape'], metres: 0 };
  const layout = roadSignPaintLayout([{ lines: [a, b] }, { lines: [c, last] }]);
  expect(layout.keys).toEqual(['left|Port|120', 'right|Hill|', 'ahead|Cape|0']);
  expect([...layout.lines.values()]).toEqual([last, b, c]); expect(layout.lines.get('left|Port|120')).toBe(last);
  expect([layout.width, layout.height]).toEqual([1024, 128]); expect(layout.slot(2)).toEqual([0, 64]); expect(layout.slot(3)).toEqual([512, 64]);
});

test('initial and later banks keep distinct claims, planes and cleanup under the same home owner', async () => {
  support(); const scope = new Scope('sign-banks'), allocator = new ResidencyAllocator();
  const outerSigns: RoadSign[] = [{ at: { x: 1200, z: 1200 }, facing: { x: 0, z: 1 }, lines: [{ arrow: 'left', names: ['Outer'], metres: 240 }] }];
  const initial = startRoadSigns(scope, allocator, 'home', signs), outer = startRoadSigns(scope, allocator, 'home', outerSigns, 'outer');
  if (initial === undefined || outer === undefined) throw new Error('Missing bank preparations');
  try {
    expect(workers).toHaveLength(2); const a = workers[0], b = workers[1];
    if (a === undefined || b === undefined) throw new Error('Missing bank workers');
    const layout = roadSignPaintLayout(signs), later = roadSignPaintLayout(outerSigns);
    const first = new Uint8Array(layout.width * layout.height * 2).fill(41), last = new Uint8Array(later.width * later.height * 2).fill(42);
    a.reply({ width: layout.width, height: layout.height, pixels: first }); b.reply({ width: later.width, height: later.height, pixels: last });
    await Promise.all([initial.ready, outer.ready]);
    expect(allocator.entries()).toHaveLength(2);
    expect(allocator.entries().every(entry => entry.owner === 'home')).toBe(true);
    expect(initial.get(layout)?.[0]).toBe(41); expect(outer.get(later)?.[0]).toBe(42);
    expect(initial.get(later)).toBeUndefined(); expect(outer.get(layout)).toBeUndefined();
    initial.release(); expect(allocator.entries()).toHaveLength(1); expect(outer.get(later)?.[0]).toBe(42);
    outer.release(); expect(allocator.entries()).toEqual([]);
    expect([a.terminated, b.terminated]).toEqual([1, 1]);
  } finally { scope.dispose(); }
});
