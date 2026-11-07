import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial, Sphere, Vector3 } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { CullPlan } from './roadCull';
import type { RoadTileStore } from './roadTileArchive';
import { RoadTileBacking } from './roadTileBacking';
import { captureJobTiles } from './roadTileCaptureJob';
import type { CaptureJob } from './roadTileCaptureWorker';

function fixture(count = 6, seed = 0): { mesh: Mesh; plan: CullPlan } {
  const geometry = new BufferGeometry(), positions = new Float32Array(count * 9), index = new Uint32Array(count * 6);
  const bins: CullPlan['bins'][number][] = [];
  for (let tile = 0; tile < count; tile++) {
    positions.set([tile + seed, 0, 0, tile + 1, 0.5, 0, tile, 0, 1], tile * 9);
    for (let at = 0; at < 6; at++) index[tile * 6 + at] = tile * 3 + (at < 3 ? at : 5 - at);
    bins.push({ start: tile * 6, count: 3, levels: [{ start: tile * 6 + 3, count: 3 }], sphere: new Sphere(new Vector3(tile, 0, 0), 1), tile: { x: tile, z: 0 } });
  }
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return { mesh: new Mesh(geometry, new MeshBasicMaterial()), plan: { source: index, bins, lod: [150] } };
}
function memoryStore(order: string[] = []): { store: RoadTileStore; bodies: Map<string, Uint8Array> } {
  const bodies = new Map<string, Uint8Array>();
  return { bodies, store: { get: hash => Promise.resolve(bodies.get(hash)?.slice() ?? null),
    put: (hash, bytes) => { order.push(hash); bodies.set(hash, bytes.slice()); return Promise.resolve(true); } } };
}
// a stand-in worker: answers each job with the real job code on its own store, refuses it, or holds it
const workerStore = memoryStore();
const held: (() => void)[] = [];
let mode: 'answer' | 'refuse' | 'hold' = 'answer', posted = 0;
class FakeWorker extends EventTarget {
  constructor() { super(); queueMicrotask(() => { this.dispatchEvent(new MessageEvent('message', { data: { ready: true } })); }); }
  postMessage(job: CaptureJob): void {
    posted++;
    const copy = structuredClone(job);
    const answer = async (): Promise<void> => {
      const data = mode === 'refuse' ? { id: copy.id, ok: false, error: 'quota' } : { id: copy.id, ok: true, ...await captureJobTiles(copy, workerStore.store) };
      this.dispatchEvent(new MessageEvent('message', { data }));
    };
    if (mode === 'hold') held.push(() => { void answer(); }); else void answer();
  }
  terminate(): void { /* nothing to stop */ }
}
const original: unknown = Reflect.get(globalThis, 'Worker');
afterEach(() => { vi.stubGlobal('Worker', original); mode = 'answer'; posted = 0; held.length = 0; workerStore.bodies.clear(); });
async function drive(backing: RoadTileBacking, mesh: Mesh, plan: CullPlan): Promise<void> {
  const steps = backing.capture(mesh, plan);
  for (;;) { const next = steps.next(), pending = backing.flush(); if (pending !== null) await pending; if (next.done === true) return; }
}
// the page path's archive bodies (its puts run concurrently and complete in any order: only the set is compared)
async function pageBodies(mesh: Mesh, plan: CullPlan): Promise<string[]> {
  const page = memoryStore(), scope = new Scope('page'), backing = new RoadTileBacking(scope, page.store, { pitch: 125, plans: new Map() });
  await drive(backing, mesh, plan); scope.dispose(); return [...page.bodies.keys()].sort();
}
const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

test('a job the worker refuses is captured again on the page: the same archive writes, the backing seals', async () => {
  vi.stubGlobal('Worker', FakeWorker); mode = 'refuse';
  const f = fixture(), expected = await pageBodies(f.mesh, f.plan), order: string[] = [];
  const scope = new Scope('refused'), backing = new RoadTileBacking(scope, memoryStore(order).store, { pitch: 125, plans: new Map() }, 'https://wildshard.test');
  await settle();
  await drive(backing, f.mesh, f.plan);
  expect(posted).toBe(1);
  await backing.joinCapture();
  // the page retry writes the page path's bodies, serially in the job's authored order (one put each)
  expect([...order].sort()).toEqual(expected); expect(order).toHaveLength(expected.length);
  expect(backing.state().backedTiles).toBe(expected.length);
  scope.dispose();
});

test('the road joins its worker captures: joinCapture waits for every answer', async () => {
  vi.stubGlobal('Worker', FakeWorker); mode = 'hold';
  const f = fixture(), scope = new Scope('join'), backing = new RoadTileBacking(scope, memoryStore().store, { pitch: 125, plans: new Map() }, 'https://wildshard.test');
  await settle();
  await drive(backing, f.mesh, f.plan);
  let joined = false; const join = (async (): Promise<void> => { await backing.joinCapture(); joined = true; })();
  await settle(); expect(joined).toBe(false); expect(backing.state().backedTiles).toBe(0);
  for (const answer of held.splice(0)) answer();
  await join; expect(joined).toBe(true); expect(backing.state().backedTiles).toBeGreaterThan(0);
  scope.dispose();
});

test('worker captures keep the window: the 33rd source waits until a job answers', async () => {
  vi.stubGlobal('Worker', FakeWorker); mode = 'hold';
  const scope = new Scope('window'), backing = new RoadTileBacking(scope, memoryStore().store, { pitch: 125, plans: new Map() }, 'https://wildshard.test');
  await settle();
  for (let i = 0; i < 32; i++) { const f = fixture(1, i); await drive(backing, f.mesh, f.plan); }
  expect(posted).toBe(32);
  const last = fixture(1, 99), steps = backing.capture(last.mesh, last.plan);
  expect(steps.next().done).toBe(false); expect(posted).toBe(32);
  const wait = backing.flush(); expect(wait).not.toBeNull();
  held.shift()?.(); await wait;
  for (;;) { const next = steps.next(); if (next.done === true) break; }
  expect(posted).toBe(33);
  for (const answer of held.splice(0)) answer();
  await backing.joinCapture();
  scope.dispose();
});
