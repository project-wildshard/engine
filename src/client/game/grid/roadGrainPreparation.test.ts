import { afterEach, expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { ROAD_GRAIN_PLANES, type RoadGrainKind } from './roadGrain';
import { startRoadGrain } from './roadGrainPreparation';

const workers: TestWorker[] = [];
const globals = ['Worker', 'OffscreenCanvas'].map(key => ({ key, descriptor: Object.getOwnPropertyDescriptor(globalThis, key) }));
function stub(key: string, value: unknown): void { Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); }
class TestWorker extends EventTarget {
  readonly sent: unknown[] = [];
  terminated = 0;
  constructor() { super(); workers.push(this); }
  postMessage(message: unknown): void { this.sent.push(message); }
  terminate(): void { this.terminated++; }
  emit(kind: RoadGrainKind, pixels?: Uint8ClampedArray): void {
    const { width, height } = ROAD_GRAIN_PLANES[kind];
    this.dispatchEvent(new MessageEvent('message', { data: { kind, pixels: pixels ?? new Uint8ClampedArray(width * height * 4), fillStyle: 'rgba(45,47,51,0.55)' } }));
  }
}
afterEach(() => {
  for (const { key, descriptor } of globals) {
    if (descriptor === undefined) Reflect.deleteProperty(globalThis, key); else Object.defineProperty(globalThis, key, descriptor);
  }
  workers.length = 0;
});
function worker(): TestWorker { const found = workers[0]; if (found === undefined) throw new Error('Missing grain worker'); return found; }
function support(): void { stub('Worker', TestWorker); stub('OffscreenCanvas', () => undefined); }

test('both complete planes share one charged worker and release all retained source bytes', async () => {
  support(); const scope = new Scope('road grain test'), allocator = new ResidencyAllocator();
  const grain = startRoadGrain(scope, allocator, 'probe'); if (grain === undefined) throw new Error('Missing preparation');
  try {
    expect(workers).toHaveLength(1); expect(worker().sent).toEqual(['asphalt', 'junction']);
    let ready = false; void grain.ready.then(() => { ready = true; return undefined; });
    worker().emit('asphalt'); await Promise.resolve(); expect(ready).toBe(false); expect(grain.get('asphalt')).toBeUndefined();
    worker().emit('junction'); await grain.ready; expect(ready).toBe(true); expect(worker().terminated).toBe(1);
    expect(grain.get('asphalt')?.pixels.length).toBe(1024 * 512 * 4);
    expect(grain.get('junction')?.pixels.length).toBe(1024 * 1024 * 4);
    expect(allocator.entries().map(row => row.bytes)).toEqual([(1024 * 512 + 1024 * 1024) * 8]);
    grain.release(); expect(grain.get('asphalt')).toBeUndefined(); expect(grain.get('junction')).toBeUndefined();
    expect(allocator.entries()).toEqual([]); expect(worker().terminated).toBe(1);
  } finally { scope.dispose(); }
});

test('retirement settles pending work and late replies cannot publish pixels', async () => {
  support(); const scope = new Scope('retired road grain'), allocator = new ResidencyAllocator();
  const grain = startRoadGrain(scope, allocator, 'probe'); if (grain === undefined) throw new Error('Missing preparation');
  scope.dispose(); await grain.ready; worker().emit('asphalt'); worker().emit('junction');
  expect(grain.get('asphalt')).toBeUndefined(); expect(grain.get('junction')).toBeUndefined();
  expect(allocator.entries()).toEqual([]); expect(worker().terminated).toBe(1);
});

test('malformed planes never publish partial data and keep original painting available', async () => {
  support(); const scope = new Scope('refused road grain'), allocator = new ResidencyAllocator();
  const grain = startRoadGrain(scope, allocator, 'probe'); if (grain === undefined) throw new Error('Missing preparation');
  try {
    worker().emit('asphalt'); worker().emit('junction', new Uint8ClampedArray(1)); await grain.ready;
    expect(grain.get('asphalt')).toBeUndefined(); expect(grain.get('junction')).toBeUndefined();
    expect(allocator.entries()).toEqual([]); expect(worker().terminated).toBe(1);
  } finally { scope.dispose(); }
});

test('unsupported hosts start no worker or residency claim', () => {
  stub('Worker', undefined); const scope = new Scope('native road grain'), allocator = new ResidencyAllocator();
  try { expect(startRoadGrain(scope, allocator, 'probe')).toBeUndefined(); expect(workers).toEqual([]); expect(allocator.entries()).toEqual([]); }
  finally { scope.dispose(); }
});
