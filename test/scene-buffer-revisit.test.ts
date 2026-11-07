import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Mesh, MeshBasicMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { AssetService } from '../src/client/engine/app/assets';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { AssetResidencyBridge } from '../src/client/game/grid/assetResidency';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { prepareSceneBufferDraws } from '../src/client/game/shardfile/sceneBuffers';

function fixture(bytes = 1000) {
  const allocator = new ResidencyAllocator({ playing: CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(bytes * CONTENT_CAPS.residentFactor), memory: new MemoryAdmission() });
  const assets = new AssetService(), bridge = new AssetResidencyBridge(allocator, resource => {
    if (!(resource instanceof BufferGeometry)) throw new Error('Expected fixed geometry');
    const position: unknown = resource.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Expected fixed channel');
    return [{ identity: position.array.buffer, bytes: position.array.byteLength, kind: 'cpu' },
      { identity: position, bytes: position.array.byteLength, kind: 'gpu' }];
  });
  const detach = assets.bindResidency(bridge), material = new MeshBasicMaterial();
  const words = new Float32Array([0, -0, 1]), files = new Map([['position.bin', new Uint8Array(words.buffer)]]);
  const row = { version: 1, buffers: [{ id: 'p', storage: 'f32', file: 'position.bin', byteLength: 12 }],
    attributes: [{ id: 'p', buffer: 'p', size: 3 }], geometries: [{ id: 'g', attributes: { position: 'p' }, instances: 1 }],
    draws: [{ id: 'draw', draw: { kind: 'mesh', geometry: 'g' } }] };
  const enter = (id: string, content = 'exact-content', instances = 1) => {
    const scope = new Scope(id), claim = allocator.reserve({ id: `sim:${id}`, owner: id, category: 'sim', bytes: 20, needed: true, distance: 0 });
    if (claim === null) throw new Error('Missing fixture admission');
    bridge.cover(scope, claim);
    const draw = prepareSceneBufferDraws({ ...row, geometries: [{ ...row.geometries[0], instances }] }, scope, undefined, files, { content, assets, revisit: true });
    const root = draw(material), mesh = root.children[0];
    if (!(mesh instanceof Mesh)) throw new Error('Missing fixed draw');
    const geometry: unknown = mesh.geometry;
    if (!(geometry instanceof BufferGeometry)) throw new Error('Missing fixed geometry');
    return { scope, claim, root, mesh, geometry, draw, leave: () => { scope.dispose(); claim.release(); } };
  };
  return { allocator, assets, bridge, material, enter, close: () => { for (const retained of assets.retained()) assets.evictCached(retained.key); detach(); bridge.dispose(); material.dispose(); } };
}

test('a real warm visit borrows exact fixed storage with fresh draw ownership', () => {
  const f = fixture(), first = f.enter('same-instance'), disposed = vi.spyOn(first.geometry, 'dispose');
  expect(first.draw.cache).toBe('miss');
  expect(f.allocator.entries().filter(row => row.category === 'commons').every(row => row.coveredBy === undefined)).toBe(true);
  const shape = first.geometry;
  first.leave(); expect(disposed).not.toHaveBeenCalled();
  expect(f.allocator.entries().filter(row => row.category === 'commons').reduce((sum, row) => sum + row.accountedBytes, 0)).toBe(24);
  const warm = f.enter('same-instance');
  try {
    expect(f.allocator.entries().filter(row => row.category === 'commons').every(row => row.coveredBy === undefined)).toBe(true);
    expect(warm.draw.cache).toBe('hit'); expect(warm.geometry).toBe(shape);
    expect(warm.root).not.toBe(first.root); expect(warm.mesh).not.toBe(first.mesh);
    const position: unknown = shape.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Missing borrowed position');
    expect(Array.from(position.array)).toEqual([0, -0, 1]);
    expect(() => first.draw(f.material)).toThrow('retired');
    expect(f.assets.evictCached(f.assets.retained()[0]?.key ?? '')).toBe(false);
  } finally { warm.leave(); f.close(); }
  expect(disposed).toHaveBeenCalledTimes(1);
});

test('idle revisit buffers remain pressure-evictable and rebuild after disposal', () => {
  const f = fixture(50), first = f.enter('cold'), shape = first.geometry;
  first.leave();
  const pressure = f.allocator.reserve({ id: 'pressure', owner: 'platform', category: 'commons', bytes: 40, needed: true, distance: 0 });
  expect(pressure).not.toBeNull(); expect(f.assets.retained()).toEqual([]); pressure?.release();
  const next = f.enter('next');
  try { expect(next.draw.cache).toBe('miss'); expect(next.geometry).not.toBe(shape); }
  finally { next.leave(); f.close(); }
});

test('resolved counts and exact content isolate warm buffers', () => {
  const f = fixture(), first = f.enter('first'); first.leave();
  const count = f.enter('count', 'exact-content', 2), content = f.enter('content', 'other-content');
  try {
    expect(count.draw.cache).toBe('miss'); expect(content.draw.cache).toBe('miss');
    expect(count.geometry).not.toBe(first.geometry); expect(content.geometry).not.toBe(first.geometry);
  } finally { count.leave(); content.leave(); f.close(); }
});


test('revisit registration cannot borrow an existing runtime-covered backing', () => {
  const f = fixture(), scope = new Scope('ordinary');
  const claim = f.allocator.reserve({ id: 'sim:ordinary', owner: 'ordinary', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (claim === null) throw new Error('Missing ordinary admission');
  f.bridge.cover(scope, claim);
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 1]), 3));
  try {
    withOwner(scope, () => f.assets.register('ordinary', geometry, { retain: true, cache: true, reusable: true }));
    expect(() => f.assets.register('revisit', geometry, { retain: true, cache: true, reusable: true, revisit: true })).toThrow('independently charged');
    expect(f.assets.has('ordinary')).toBe(true); expect(f.assets.has('revisit')).toBe(false);
  } finally { scope.dispose(); claim.release(); f.close(); }
});
