import { expect, test, vi } from 'vitest';
import { AdditiveBlending, NormalBlending, BoxGeometry, BufferAttribute, BufferGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { installFarProxy, type FarProxyView } from './farView';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { bakedNearFiles, NearPlaceholders, type NearPlaceholderHost } from './nearPlaceholderView';

function fixture() {
  const root = new Group(), geometry = new BoxGeometry(), allocator = new ResidencyAllocator();
  const disposed = vi.fn(); geometry.addEventListener('dispose', () => { disposed(); });
  const cover = vi.fn();
  let finish: () => void = () => undefined, fail: (error: Error) => void = () => undefined;
  const pending = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  let current: () => boolean = () => false;
  const prepare: NonNullable<NearPlaceholderHost['prepare']> = vi.fn((view: FarProxyView, live: () => boolean) => {
    expect(view.mesh.visible).toBe(false); current = live; return pending;
  });
  const near = new NearPlaceholders({ allocator, root: () => root, pitch: 555,
    cells: [{ instance: 'cell', slug: 'content', cell: [0, 0], origin: { x: 0, y: 0, z: 0 } }],
    load: () => Promise.resolve({ prepared: { geometry, look: { family: 'toon', haze: { colour: [1, 1, 1] } } }, bytes: 100, owns: true }),
    mask: () => new Set<number>(), cover: (instance, covered) => { cover(instance, covered); }, prepare });
  return { near, root, allocator, cover, disposed, finish, fail, current: () => current() };
}

test('near views retain their far fallback until preparation completes', async () => {
  const f = fixture(); f.near.update({ x: 0, z: 0 }, null);
  await Promise.resolve();
  expect(f.current()).toBe(true); expect(f.near.shows('cell')).toBe(false); expect(f.near.owns('cell')).toBe(false);
  expect(f.near.state().cells[0]?.shows).toBe('loading'); expect(f.cover).not.toHaveBeenCalled();
  f.near.remask('cell'); expect(f.root.children[0]?.visible).toBe(false);
  f.finish(); await Promise.resolve();
  expect(f.near.visible('cell')).toBe(true); expect(f.near.owns('cell')).toBe(true);
  expect(f.cover).toHaveBeenCalledExactlyOnceWith('cell', true);
  f.near.dispose(); expect(f.disposed).toHaveBeenCalledOnce();
  expect(f.allocator.entries()).toHaveLength(0);
});

test.each(['replan', 'dispose', 'failure'] as const)('near preparation cannot publish after %s', async reason => {
  const f = fixture(), warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    f.near.update({ x: 0, z: 0 }, null); await Promise.resolve();
    if (reason === 'replan') f.near.update({ x: 0, z: 0 }, 'cell');
    else if (reason === 'dispose') f.near.dispose();
    if (reason === 'failure') f.fail(new Error('Driver failed')); else f.finish();
    await Promise.resolve();
    expect(f.current()).toBe(false); expect(f.near.visible('cell')).toBe(false);
    expect(f.cover).not.toHaveBeenCalled(); expect(f.root.children).toHaveLength(0);
    expect(f.disposed).toHaveBeenCalledOnce();
    expect(f.allocator.entries()).toHaveLength(0);
  } finally { f.near.dispose(); warning.mockRestore(); }
});


test('proxy installation publishes the same exact packed sphere', () => {
  const root = new Group(), geometry = new BufferGeometry(), positions = new Float32Array(65538 * 3);
  for (let i = 0; i < positions.length; i++) positions[i] = Math.sin(i) * (i % 97 - 48);
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  const oracle = geometry.clone(); oracle.computeBoundingSphere();
  const view = installFarProxy(root, geometry, { family: 'toon', haze: { colour: [1, 1, 1] } });
  expect(view.mesh.geometry.boundingSphere).toEqual(oracle.boundingSphere);
  expect(view.mesh.parent).toBe(root);
  expect(geometry.boundingBox).toBeNull();
  view.dispose(); oracle.dispose();
});

test('near opaque colour keeps its mean without additive glow, fog or exposure', () => {
  const root = new Group(), geometry = new BoxGeometry(), light = new BoxGeometry(), colour = new BoxGeometry();
  const retired = [geometry, light, colour].map(part => { const fn = vi.fn(); part.addEventListener('dispose', () => { fn(); }); return fn; });
  const view = installFarProxy(root, geometry, { family: 'pbr', haze: { colour: [1, 1, 1] } }, true, undefined, false, null, light, colour);
  try {
    const glow = view.mesh.getObjectByName('far-proxy-light'), face = view.mesh.getObjectByName('far-proxy-colour');
    if (!(glow instanceof Mesh && glow.material instanceof MeshBasicMaterial && face instanceof Mesh && face.material instanceof MeshBasicMaterial)) throw new Error('Missing near layers');
    expect(glow.material.blending).toBe(AdditiveBlending); expect(glow.material.color.r).toBe(1.6);
    expect(face.geometry).toBe(colour); expect(face.material.blending).toBe(NormalBlending);
    expect(face.material.color.toArray()).toEqual([1, 1, 1]); expect(face.material.transparent).toBe(false);
    expect(face.material.fog).toBe(false); expect(face.material.toneMapped).toBe(false); expect(face.material.depthWrite).toBe(true);
    view.mask(new Set(Array.from({ length: 16 }, (_, i) => i))); expect(view.mesh.visible).toBe(false);
  } finally { view.dispose(); view.dispose(); }
  for (const fn of retired) expect(fn).toHaveBeenCalledOnce();
  expect(root.children).toHaveLength(0);
});


test('legacy near requests require a complete published asset pair', () => {
  const row = '/assets/baked/content/near.json', mesh = '/assets/baked/content/near.glb';
  expect(bakedNearFiles('content', {})).toBeNull();
  expect(bakedNearFiles('content', { [row]: 100 })).toBeNull();
  expect(bakedNearFiles('content', { [mesh]: 200 })).toBeNull();
  expect(bakedNearFiles('content', { [row]: 100, [mesh]: 200 })).toEqual({ row, mesh });
});

test('a missing near view keeps the far proxy and is not repeatedly requested', async () => {
  const root = new Group(), load = vi.fn(() => Promise.reject(new Error('No declared near placeholder'))), cover = vi.fn();
  const near = new NearPlaceholders({ allocator: new ResidencyAllocator(), root: () => root, pitch: 555,
    cells: [{ instance: 'cell', slug: 'content', cell: [0, 0], origin: { x: 0, y: 0, z: 0 } }],
    load, cover: (instance, covered) => { cover(instance, covered); }, mask: () => new Set<number>() });
  try {
    near.update({ x: 0, z: 0 }, null); await Promise.resolve();
    near.update({ x: 0, z: 0 }, null); await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    expect(cover).not.toHaveBeenCalled();
    expect(root.children).toHaveLength(0);
    expect(near.state().cells).toEqual([{ instance: 'cell', shows: 'none' }]);
  } finally { near.dispose(); }
});

test('optional near refinement preserves a kept world and retries after headroom changes', async () => {
  const base = new ResidencyAllocator().cost().playing;
  const allocator = new ResidencyAllocator({ playing: base + 1000 }), evict = vi.fn();
  const kept = allocator.reserve({ id: 'kept-world', category: 'sim', owner: 'kept', bytes: 800, distance: 100, needed: false, evictSync: () => { evict(); } });
  if (kept === null) throw new Error('Missing kept world');
  const root = new Group(), cover = vi.fn(), disposed = vi.fn();
  const load = vi.fn<NearPlaceholderHost['load']>(() => {
    const geometry = new BoxGeometry(), light = new BoxGeometry(), colour = new BoxGeometry();
    for (const part of [geometry, light, colour]) part.addEventListener('dispose', () => { disposed(); });
    return Promise.resolve({ prepared: { geometry, light, colour, look: { family: 'toon', haze: { colour: [1, 1, 1] } } }, bytes: 200 });
  });
  const near = new NearPlaceholders({ allocator, root: () => root, pitch: 555,
    cells: [{ instance: 'cell', slug: 'content', cell: [0, 0], origin: { x: 0, y: 0, z: 0 } }],
    load, mask: () => new Set<number>(), cover: (instance, covered) => { cover(instance, covered); } });
  let required: ReturnType<ResidencyAllocator['reserve']> = null;
  try {
    near.update({ x: 0, z: 0 }, null); await Promise.resolve();
    expect(allocator.has('kept-world')).toBe(true); expect(evict).not.toHaveBeenCalled();
    expect(disposed).toHaveBeenCalledTimes(3); expect(root.children).toHaveLength(0);
    expect(cover).not.toHaveBeenCalled(); expect(near.absent('cell')).toBe(false);
    near.update({ x: 0, z: 0 }, null); await Promise.resolve();
    expect(load).toHaveBeenCalledOnce();
    required = allocator.reserve({ id: 'actual-entry', category: 'sim', owner: 'actual', bytes: 800, distance: 0, needed: true });
    expect(required).not.toBeNull(); expect(evict).toHaveBeenCalledOnce();
    required?.release(); required = null;
    near.update({ x: 0, z: 0 }, null); await Promise.resolve(); await Promise.resolve();
    expect(load).toHaveBeenCalledTimes(2); expect(near.shows('cell')).toBe(true);
    expect(cover).toHaveBeenCalledExactlyOnceWith('cell', true);
    near.dispose(); expect(disposed).toHaveBeenCalledTimes(6); expect(allocator.entries()).toEqual([]);
  } finally { near.dispose(); required?.release(); kept.release(); }
});
