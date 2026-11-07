// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, InstancedBufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { AssetService } from '../src/client/engine/app/assets';
import { Scope } from '../src/shared/engine/app/scope';
import { initializeTier, TIER } from '../src/client/engine/core/tier';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { AssetResidencyBridge } from '../src/client/game/grid/assetResidency';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { createSceneBuffers } from '../src/client/game/shardfile/sceneBuffers';

const positionFile='test/cache-position.bin',shortFile='test/cache-short.bin',indexFile='test/cache-index.bin';
const files=new Map<string,Uint8Array>([[positionFile,new Uint8Array(12)],[shortFile,new Uint8Array(1)],[indexFile,new Uint8Array([1,1,1])]]);
const originalTier = TIER;
afterEach(() => { initializeTier(originalTier); });
const source = () => ({ version: 1, buffers: [{ id: 'positions', storage: 'f32', file:positionFile,byteLength:12 }],
  attributes: [{ id: 'position', buffer: 'positions', size: 3 }],
  geometries: [{ id: 'first', attributes: { position: 'position' } }, { id: 'second', attributes: { position: 'position' } }],
  draws: [{ id: 'first', draw: { kind: 'mesh', geometry: 'first' } }, { id: 'second', draw: { kind: 'mesh', geometry: 'second' } }] });
function mesh(root: { readonly children: readonly unknown[] }, index = 0): Mesh {
  const native = (value: unknown): value is Mesh => value instanceof Mesh;
  const result = root.children[index]; if (!native(result)) throw new Error('Missing fixture draw'); return result;
}
function fixture(bytes = 1000) {
  const allocator = new ResidencyAllocator({ playing: CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(bytes * CONTENT_CAPS.residentFactor), memory: new MemoryAdmission() });
  const assets = new AssetService<BufferGeometry>();
  const bridge = new AssetResidencyBridge(allocator, resource => {
    if (!(resource instanceof BufferGeometry)) throw new Error('Expected geometry');
    const attribute: unknown = resource.getAttribute('position');
    if (!(attribute instanceof BufferAttribute)) throw new Error('Missing storage');
    return [{ identity: attribute.array.buffer, bytes: attribute.array.byteLength, kind: 'cpu' },
      { identity: attribute, bytes: attribute.array.byteLength, kind: 'gpu' }];
  });
  const detach = assets.bindResidency(bridge);
  return { allocator, assets, reuse: { content: '/assets/immutable-hash.json', assets }, close: () => {
    for (const row of assets.retained()) assets.evictCached(row.key); detach(); bridge.dispose();
  } };
}

test('re-entry shares fixed storage while roots, transforms and materials stay fresh', () => {
  const f = fixture(), first = new Scope('first'), second = new Scope('second');
  const paintA = new MeshBasicMaterial(), paintB = new MeshBasicMaterial();
  const a = createSceneBuffers(source(), paintA, first, undefined, f.reuse, files);
  const original = mesh(a).geometry, dispose = vi.spyOn(original, 'dispose');
  expect(mesh(a, 1).geometry.getAttribute('position')).toBe(original.getAttribute('position'));
  expect(f.allocator.cost().input.commons).toBe(24);
  a.position.x = 10; first.dispose();
  expect(dispose).not.toHaveBeenCalled(); expect(f.allocator.cost().input.commons).toBe(24);
  const b = createSceneBuffers(source(), paintB, second, undefined, f.reuse, files);
  expect(b).not.toBe(a); expect(b.position.x).toBe(0);
  expect(mesh(b)).not.toBe(mesh(a)); expect(mesh(b).geometry).toBe(original);
  expect(mesh(a).material).toBe(paintA); expect(mesh(b).material).toBe(paintB);
  expect(f.allocator.cost().input.commons).toBe(24);
  second.dispose(); f.close(); expect(dispose).toHaveBeenCalledTimes(1);
  paintA.dispose(); paintB.dispose();
});

test('changed content and tier construct separate storage under the same logical filename', () => {
  const f = fixture(), scope = new Scope('profiles'), paint = new MeshBasicMaterial();
  initializeTier('phone');
  const a = createSceneBuffers(source(), paint, scope, undefined, f.reuse, files);
  const b = createSceneBuffers(source(), paint, scope, undefined, { ...f.reuse, content: '/assets/changed-hash.json' }, files);
  initializeTier('desktop');
  const c = createSceneBuffers(source(), paint, scope, undefined, f.reuse, files);
  expect(mesh(a).geometry).not.toBe(mesh(b).geometry); expect(mesh(a).geometry).not.toBe(mesh(c).geometry);
  initializeTier('phone');
  expect(mesh(createSceneBuffers(source(), paint, scope, undefined, f.reuse, files)).geometry).toBe(mesh(a).geometry);
  scope.dispose(); f.close(); paint.dispose();
});

test('every resolved geometry count participates in the cache profile', () => {
  const f = fixture(), scope = new Scope('counts'), paint = new MeshBasicMaterial();
  const base = source();
  const row = { ...base, geometries: base.geometries.map((definition, i) => ({ id: definition.id, attributes: definition.attributes,
    instances: { knob: `fixture.count-${String(i)}`, threshold: 1, below: 1, above: 2 } })) };
  const plumbing = (second: number) => ({ namespace: 'fixture', input: [], debug: [], knobs: [
    { id: 'fixture.count-0' as const, phone: 1, desktop: 1 }, { id: 'fixture.count-1' as const, phone: second, desktop: second }] });
  const a = createSceneBuffers(row, paint, scope, plumbing(0), f.reuse, files);
  const b = createSceneBuffers(row, paint, scope, plumbing(1), f.reuse, files);
  expect(mesh(a).geometry).not.toBe(mesh(b).geometry);
  const first = mesh(a, 1).geometry, second = mesh(b, 1).geometry;
  expect(first).toBeInstanceOf(InstancedBufferGeometry); expect(second).toBeInstanceOf(InstancedBufferGeometry);
  if (!(first instanceof InstancedBufferGeometry) || !(second instanceof InstancedBufferGeometry)) throw new Error('Missing instance geometry');
  expect(first.instanceCount).toBe(1); expect(second.instanceCount).toBe(2);
  scope.dispose(); f.close(); paint.dispose();
});

test('pressure disposal invalidates the build memo and the next entry rebuilds live buffers', () => {
  const f = fixture(30), first = new Scope('first'), second = new Scope('second'), paint = new MeshBasicMaterial();
  const a = createSceneBuffers(source(), paint, first, undefined, f.reuse, files), original = mesh(a).geometry;
  expect(f.allocator.reserve({ id: 'live-pressure', owner: 'platform', category: 'commons', bytes: 24, needed: true, distance: 0 })).toBeNull();
  expect(f.assets.retained()).toHaveLength(2);
  first.dispose();
  const pressure = f.allocator.reserve({ id: 'pressure', owner: 'platform', category: 'commons', bytes: 24, needed: true, distance: 0 });
  expect(pressure).not.toBeNull(); expect(f.assets.retained()).toEqual([]); pressure?.release();
  const b = createSceneBuffers(source(), paint, second, undefined, f.reuse, files);
  expect(mesh(b).geometry).not.toBe(original); expect(mesh(b).geometry.getAttribute('position').array).toEqual(new Float32Array(3));
  expect(f.allocator.cost().input.commons).toBe(24);
  second.dispose(); f.close(); paint.dispose();
});

test('unkeyed callers keep scope disposal and failed construction leaves no retained assets', () => {
  const f = fixture(), scope = new Scope('unkeyed'), paint = new MeshBasicMaterial();
  const a = createSceneBuffers(source(), paint, scope, undefined, undefined, files), dispose = vi.spyOn(mesh(a).geometry, 'dispose');
  scope.dispose(); expect(dispose).toHaveBeenCalledTimes(1); expect(f.assets.retained()).toEqual([]);
  const invalid = { ...source(), buffers: [{ id: 'positions', storage: 'f32', file:shortFile,byteLength:1 }] };
  const failed = new Scope('failed');
  expect(() => createSceneBuffers(invalid, paint, failed, undefined, f.reuse, files)).toThrow('Misaligned');
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.entries()).toEqual([]);
  failed.dispose(); f.close(); paint.dispose();
});

test('invalid later geometry releases a partially registered build', () => {
  const f = fixture(), scope = new Scope('partial'), paint = new MeshBasicMaterial(), base = source();
  const invalid = { ...base, buffers: [...base.buffers, { id: 'indices', storage: 'u8', file:indexFile,byteLength:3 }],
    attributes: [...base.attributes, { id: 'indices', buffer: 'indices', size: 1 }],
    geometries: base.geometries.map((definition, i) => i === 0 ? definition : { id: definition.id, attributes: definition.attributes, index: 'indices' }) };
  expect(() => createSceneBuffers(invalid, paint, scope, undefined, f.reuse, files)).toThrow('Scene index exceeds');
  expect(f.assets.retained()).toEqual([]); expect(f.allocator.entries()).toEqual([]);
  scope.dispose(); f.close(); paint.dispose();
});

test('a sliced retiring ancestor refuses cold and cached entries before any acquisition', () => {
  const f = fixture(), existing = new Scope('existing'), paint = new MeshBasicMaterial();
  createSceneBuffers(source(), paint, existing, undefined, f.reuse, files); existing.dispose();
  const ancestor = new Scope('retiring');
  const child = ancestor.child('still-open');
  ancestor.onDispose(() => undefined);
  const steps = ancestor.disposeSteps();
  expect(steps.next().done).toBe(false);
  expect(child.disposed).toBe(false); expect(child.disposing).toBe(true);
  const register = vi.spyOn(f.assets, 'register'), acquire = vi.spyOn(f.assets, 'acquireResource'), makeChild = vi.spyOn(child, 'child');
  const unread = { get version() { throw new Error('Should not parse retiring input'); } };
  expect(() => createSceneBuffers(unread, paint, child, undefined, f.reuse, files)).toThrow('retiring');
  expect(() => createSceneBuffers(source(), paint, child, undefined, f.reuse, files)).toThrow('retiring');
  expect(() => createSceneBuffers(source(), paint, child, undefined, { ...f.reuse, content: '/assets/new-hash.json' }, files)).toThrow('retiring');
  expect(register).not.toHaveBeenCalled(); expect(acquire).not.toHaveBeenCalled(); expect(makeChild).not.toHaveBeenCalled();
  for (const step of steps) void step;
  f.close(); paint.dispose();
});
