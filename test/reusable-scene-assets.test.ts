import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Float32BufferAttribute } from 'three';
import { AssetService } from '../src/client/engine/app/assets';
import { memoUntilDisposed } from '../src/client/engine/app/cachedAssets';
import { Scope } from '../src/shared/engine/app/scope';
import { withOwner } from '../src/shared/engine/app/ownership';
import { CONTENT_CAPS } from '../src/shared/engine/core/config';
import { AssetResidencyBridge } from '../src/client/game/grid/assetResidency';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';

function fixture(bytes = 1000) {
  const allocator = new ResidencyAllocator({ playing: CONTENT_CAPS.engineBase + CONTENT_CAPS.overlap + Math.ceil(bytes * CONTENT_CAPS.residentFactor), memory: new MemoryAdmission() });
  const assets = new AssetService<BufferGeometry>();
  const bridge = new AssetResidencyBridge(allocator, resource => {
    if (!(resource instanceof BufferGeometry)) throw new Error('Expected geometry');
    const attribute: unknown = resource.getAttribute('position');
    if (!(attribute instanceof BufferAttribute)) throw new Error('Expected position storage');
    return [{ identity: attribute.array.buffer, bytes: attribute.array.byteLength, kind: 'cpu' },
      { identity: attribute, bytes: attribute.array.byteLength, kind: 'gpu' }];
  });
  const detach = assets.bindResidency(bridge);
  return { allocator, assets, bridge, close: () => { for (const row of assets.retained()) assets.evictCached(row.key); detach(); bridge.dispose(); } };
}
const geometry = () => new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0], 3));
const reusable = { retain: true, cache: true, reusable: true };
const charged = (allocator: ResidencyAllocator) => allocator.entries().filter(row => row.category === 'commons').reduce((sum, row) => sum + row.accountedBytes, 0);

test('retiring a resident evicts idle reusable geometry and re-entry rebuilds its memo', () => {
  const f = fixture(), resident = new Scope('first-resident'), resource = geometry(), dispose = vi.spyOn(resource, 'dispose');
  const memo = new Map<string, BufferGeometry>();
  const claim = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (claim === null) throw new Error('Missing fixture runtime');
  f.bridge.cover(resident, claim);
  withOwner(resident, () => {
    memoUntilDisposed(memo, 'content-hash', () => f.assets.register('fixed', resource, reusable));
    f.assets.acquire('fixed');
  });
  resident.onDispose(() => { f.assets.release('fixed'); });
  expect(charged(f.allocator)).toBe(0);
  resident.dispose(); claim.release();
  expect(f.assets.has('fixed')).toBe(false);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(memo.size).toBe(0);
  expect(charged(f.allocator)).toBe(0);
  const next = new Scope('re-entry'), nextClaim = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (nextClaim === null) throw new Error('Missing re-entry runtime');
  f.bridge.cover(next, nextClaim);
  const replacement = withOwner(next, () => memoUntilDisposed(memo, 'content-hash', () => f.assets.register('fixed', geometry(), reusable)));
  expect(replacement).not.toBe(resource);
  expect(replacement.getAttribute('position').array).toEqual(resource.getAttribute('position').array);
  expect(f.assets.acquire('fixed')).toBe(replacement);
  next.onDispose(() => { f.assets.release('fixed'); });
  expect(charged(f.allocator)).toBe(0);
  next.dispose(); nextClaim.release();
  expect(memo.size).toBe(0); expect(f.assets.retained()).toEqual([]);
  f.close();
  expect(charged(f.allocator)).toBe(0);
});

test('retirement preserves an acquired reusable asset until its final release', () => {
  const f = fixture(), resident = new Scope('resident'), resource = geometry(), dispose = vi.spyOn(resource, 'dispose');
  const claim = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (claim === null) throw new Error('Missing fixture runtime');
  f.bridge.cover(resident, claim);
  withOwner(resident, () => { f.assets.register('shared', resource, reusable); f.assets.acquire('shared'); });
  resident.dispose(); claim.release();
  expect(f.assets.has('shared')).toBe(true); expect(dispose).not.toHaveBeenCalled();
  expect(charged(f.allocator)).toBe(24);
  f.assets.release('shared');
  expect(f.assets.has('shared')).toBe(false); expect(dispose).toHaveBeenCalledTimes(1);
  expect(charged(f.allocator)).toBe(0); f.close();
});

test('another live resident protects a shared cache until both owners retire', () => {
  const f = fixture(), first = new Scope('first'), second = new Scope('second'), resource = geometry(), dispose = vi.spyOn(resource, 'dispose');
  const a = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  const b = f.allocator.reserve({ id: 'sim:second', owner: 'second', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (a === null || b === null) throw new Error('Missing fixture runtimes');
  f.bridge.cover(first, a); f.bridge.cover(second, b);
  withOwner(first, () => { f.assets.register('shared', resource, reusable); f.assets.acquire('shared'); });
  f.assets.acquire('shared'); f.assets.observeResidency(resource, second);
  first.onDispose(() => { f.assets.release('shared'); });
  second.onDispose(() => { f.assets.release('shared'); });
  first.dispose(); a.release();
  expect(f.assets.has('shared')).toBe(true); expect(dispose).not.toHaveBeenCalled();
  expect(f.assets.acquire('shared')).toBe(resource); f.assets.release('shared');
  second.dispose(); b.release();
  expect(f.assets.has('shared')).toBe(false); expect(dispose).toHaveBeenCalledTimes(1);
  expect(charged(f.allocator)).toBe(0); f.close();
});

test('a failed retirement eviction retains the cache and charges for a later retry', () => {
  const f = fixture(), resident = new Scope('resident'), resource = geometry();
  const claim = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (claim === null) throw new Error('Missing fixture runtime');
  f.bridge.cover(resident, claim);
  withOwner(resident, () => { f.assets.register('fixed', resource, reusable); f.assets.acquire('fixed'); });
  resident.onDispose(() => { f.assets.release('fixed'); });
  const dispose = vi.spyOn(resource, 'dispose').mockImplementationOnce(() => { throw new Error('Native retirement failed'); });
  expect(() => resident.dispose()).toThrow('Native retirement failed'); claim.release();
  expect(f.assets.has('fixed')).toBe(true); expect(charged(f.allocator)).toBe(24);
  expect(f.assets.evictCached('fixed')).toBe(true); expect(dispose).toHaveBeenCalledTimes(2);
  expect(f.assets.retained()).toEqual([]); f.close();
  expect(charged(f.allocator)).toBe(0);
});

test('resident cache retirement remains the default', () => {
  const f = fixture(), resident = new Scope('ordinary-resident'), resource = geometry();
  const claim = f.allocator.reserve({ id: 'sim:first', owner: 'first', category: 'sim', bytes: 100, needed: true, distance: 0 });
  if (claim === null) throw new Error('Missing fixture runtime');
  f.bridge.cover(resident, claim);
  withOwner(resident, () => { f.assets.register('ordinary', resource, { retain: true, cache: true }); f.assets.acquire('ordinary'); });
  resident.onDispose(() => { f.assets.release('ordinary'); });
  resident.dispose(); claim.release();
  expect(f.assets.has('ordinary')).toBe(false);
  expect(charged(f.allocator)).toBe(0); f.close();
});

test('ordinary allocation pressure evicts the least recently used idle build', () => {
  const f = fixture(50), a = geometry(), b = geometry();
  f.assets.register('a', a, reusable); f.assets.register('b', b, reusable);
  f.assets.acquire('a'); f.assets.release('a');
  const next = f.allocator.reserve({ id: 'next', owner: 'platform', category: 'commons', bytes: 24, needed: true, distance: 0 });
  expect(next).not.toBeNull();
  expect(f.assets.has('a')).toBe(true); expect(f.assets.has('b')).toBe(false);
  expect(charged(f.allocator)).toBe(48);
  next?.release(); f.close(); expect(charged(f.allocator)).toBe(0);
});

test('a live reference refuses both direct and pressure eviction', () => {
  const f = fixture(50), resource = geometry(), dispose = vi.spyOn(resource, 'dispose');
  f.assets.register('live', resource, reusable); f.assets.acquire('live');
  expect(f.assets.evictCached('live')).toBe(false);
  expect(f.allocator.reserve({ id: 'too-much', owner: 'platform', category: 'commons', bytes: 40, needed: true, distance: 0 })).toBeNull();
  expect(f.assets.acquire('live')).toBe(resource); expect(dispose).not.toHaveBeenCalled();
  f.assets.release('live'); f.assets.release('live'); f.close();
});

test('a throwing disposal keeps the asset and every original allocation charged', () => {
  const f = fixture(50), resource = geometry();
  const dispose = vi.spyOn(resource, 'dispose').mockImplementationOnce(() => { throw new Error('Native disposal failed'); });
  f.assets.register('fixed', resource, reusable);
  const before = f.allocator.entries();
  const next = { id: 'next', owner: 'platform', category: 'commons' as const, bytes: 40, needed: true, distance: 0 };
  expect(() => f.allocator.reserve(next)).toThrow('Native disposal failed');
  expect(f.assets.has('fixed')).toBe(true);
  expect(f.allocator.entries()).toEqual(before);
  expect(charged(f.allocator)).toBe(24);
  expect(f.allocator.has('next')).toBe(false);
  expect(f.assets.acquire('fixed')).toBe(resource); f.assets.release('fixed');
  const replacement = f.allocator.reserve(next);
  expect(replacement).not.toBeNull(); expect(f.assets.has('fixed')).toBe(false);
  expect(dispose).toHaveBeenCalledTimes(2); expect(charged(f.allocator)).toBe(40);
  replacement?.release(); f.close(); expect(charged(f.allocator)).toBe(0);
});

test('a later disposal failure keeps its charges after an earlier eviction succeeds', () => {
  const f = fixture(50), first = geometry(), failing = geometry();
  f.assets.register('first', first, reusable);
  const firstClaims = new Set(f.allocator.entries().map(row => row.id));
  f.assets.register('failing', failing, reusable);
  const dispose = vi.spyOn(failing, 'dispose').mockImplementationOnce(() => { throw new Error('Later disposal failed'); });
  const before = f.allocator.entries().filter(row => !firstClaims.has(row.id));
  const next = { id: 'next', owner: 'platform', category: 'commons' as const, bytes: 40, needed: true, distance: 0 };
  expect(() => f.allocator.reserve(next)).toThrow('Later disposal failed');
  expect(f.assets.has('first')).toBe(false); expect(f.assets.has('failing')).toBe(true);
  expect(f.allocator.entries()).toEqual(before);
  expect(charged(f.allocator)).toBe(24); expect(f.allocator.has('next')).toBe(false);
  const replacement = f.allocator.reserve(next);
  expect(replacement).not.toBeNull(); expect(dispose).toHaveBeenCalledTimes(2);
  replacement?.release(); f.close(); expect(charged(f.allocator)).toBe(0);
});

test('a failed commit aborts uncommitted preparations without removing their claims', () => {
  const f = fixture(50), abort = vi.fn<() => void>(), commit = vi.fn<() => void>();
  const first = f.allocator.reserve({ id: 'first', owner: 'platform', category: 'commons', bytes: 20, needed: false, distance: 2,
    prepareEvict: () => ({ commit: () => { throw new Error('Commit failed'); }, abort }) });
  const second = f.allocator.reserve({ id: 'second', owner: 'platform', category: 'commons', bytes: 20, needed: false, distance: 1,
    prepareEvict: () => ({ commit, abort }) });
  const before = f.allocator.entries();
  expect(() => f.allocator.reserve({ id: 'next', owner: 'platform', category: 'commons', bytes: 40, needed: true, distance: 0 })).toThrow('Commit failed');
  expect(abort).toHaveBeenCalledTimes(2); expect(commit).not.toHaveBeenCalled();
  expect(f.allocator.entries()).toEqual(before);
  first?.release(); second?.release(); f.close(); expect(charged(f.allocator)).toBe(0);
});

test('failed and repeated releases never subtract real allocation bytes twice', () => {
  const f = fixture(), resource = geometry(), dispose = vi.spyOn(resource, 'dispose');
  f.assets.register('fixed', resource, reusable);
  expect(() => f.assets.release('fixed')).toThrow('no reference');
  expect(charged(f.allocator)).toBe(24);
  f.assets.acquire('fixed'); f.assets.release('fixed');
  expect(() => f.assets.release('fixed')).toThrow('no reference');
  expect(charged(f.allocator)).toBe(24);
  expect(f.assets.evictCached('fixed')).toBe(true); expect(f.assets.evictCached('fixed')).toBe(true);
  expect(dispose).toHaveBeenCalledTimes(1); expect(charged(f.allocator)).toBe(0);
  expect(() => f.assets.acquire('fixed')).toThrow('Unknown asset'); f.close();
});

test('shared CPU and GPU storage stays charged and protected by every using asset', () => {
  const f = fixture(), a = geometry(), b = new BufferGeometry().setAttribute('position', a.getAttribute('position'));
  f.assets.register('a', a, reusable); f.assets.register('b', b, reusable); f.assets.acquire('b');
  expect(charged(f.allocator)).toBe(24);
  f.assets.evictCached('a'); expect(charged(f.allocator)).toBe(24);
  expect(f.allocator.entries().every(row => row.needed)).toBe(true);
  f.assets.release('b'); f.close(); expect(charged(f.allocator)).toBe(0);
});

test('reusable assets require explicit retained cache ownership', () => {
  const f = fixture(), resource = geometry();
  expect(() => f.assets.register('bad', resource, { reusable: true })).toThrow('retained cache ownership');
  expect(f.assets.has('bad')).toBe(false); expect(charged(f.allocator)).toBe(0);
  resource.dispose(); f.close();
});

test('eviction invalidates every memo and a later request constructs live storage', () => {
  const f = fixture(), geometries = new Map<string, BufferGeometry>(), views = new Map<string, { geometry: BufferGeometry }>();
  let builds = 0;
  const make = () => { const resource = geometry(); f.assets.register(`fixed-${String(builds++)}`, resource, reusable); return resource; };
  const first = memoUntilDisposed(geometries, 'content-hash', make);
  memoUntilDisposed(views, 'another-view', () => ({ geometry: first }));
  expect(memoUntilDisposed(geometries, 'content-hash', make)).toBe(first);
  expect(builds).toBe(1);
  f.assets.evictCached('fixed-0');
  expect(geometries.size).toBe(0); expect(views.size).toBe(0);
  const replacement = memoUntilDisposed(geometries, 'content-hash', make);
  expect(replacement).not.toBe(first); expect(builds).toBe(2);
  expect(charged(f.allocator)).toBe(24);
  f.close(); expect(geometries.size).toBe(0);
});

test('a partially refused registration releases all prepared CPU and GPU claims', () => {
  const f = fixture(20), resource = geometry();
  expect(() => f.assets.register('too-large', resource, reusable)).toThrow('Retained cache admission deferred');
  expect(f.assets.has('too-large')).toBe(false);
  expect(charged(f.allocator)).toBe(0); expect(f.allocator.entries()).toEqual([]);
  resource.dispose(); f.close();
});
