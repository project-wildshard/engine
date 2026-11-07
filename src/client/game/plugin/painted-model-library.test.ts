import { expect, it, vi } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import { createModelLibrary } from './geometry';

it('shares an original atlas while cloning prepared geometry and explicit NPC slots', async () => {
  const geometry = new PlaneGeometry(2, 3); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const pool = new Group(), primitive = new Mesh(geometry, new MeshStandardMaterial()); primitive.name = 'hero';
  primitive.userData['restGroups'] = [];
  primitive.userData['restBox'] = [-1, -1.5, 0, 1, 1.5, 0];
  primitive.userData['restSphere'] = [0, 0, 0, 2]; pool.add(primitive);
  const texture = new Texture(), painted = new Group(); painted.add(new Mesh(new PlaneGeometry(), new MeshStandardMaterial({ map: texture })));
  const read = vi.fn((url: string) => {
    if (url !== 'pool' && url !== 'paint') throw new Error('Undeclared asset');
    return Promise.resolve({ scene: url === 'pool' ? pool : painted });
  });
  const library = createModelLibrary<never, never>({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 0.6,
    geometryPools: [{ url: 'pool', parts: ['hero'] }], paintedModels: [{ name: 'actor', url: 'paint', geometry: 'hero', pivots: ['hero', 'hero', 'hero', null] }] }, 'test', {}, read);
  const pause = vi.fn(() => Promise.resolve());
  await library.preload(pause); await library.preload(pause);
  expect(library.geometry('hero', { borrow: true })).toBe(geometry);
  const owned = library.geometry('hero');
  expect(owned?.getAttribute('position').array.buffer).not.toBe(geometry.getAttribute('position').array.buffer);
  owned?.dispose();
  const first = library.painted('actor'), second = library.painted('actor');
  if (first === null || second === null || first.pivots === undefined) throw new Error('Missing prepared actor');
  expect(first.geometry).not.toBe(second.geometry); expect(first.map).toBe(texture); expect(second.map).toBe(texture);
  expect(first.geometry.boundingSphere?.radius).toBe(2);
  expect(first.pivots.fore.getAttribute('position').count).toBe(0);
  expect(first.pivots.body).not.toBe(first.geometry);
  expect(pause).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(2);
  first.geometry.dispose(); second.geometry.dispose(); texture.dispose(); geometry.dispose();
  for (const part of Object.values(first.pivots)) part.dispose();
  if (second.pivots !== undefined) for (const part of Object.values(second.pivots)) part.dispose();
});

function paintedIntake(holdPool = false, atlasReader = false) {
  const geometry = new PlaneGeometry(2, 3); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  const pool = new Group(), primitiveMaterial = new MeshStandardMaterial(), primitive = new Mesh(geometry, primitiveMaterial);
  primitive.name = 'hero'; primitive.userData['restGroups'] = [];
  primitive.userData['restBox'] = [-1, -1.5, 0, 1, 1.5, 0]; primitive.userData['restSphere'] = [0, 0, 0, 2]; pool.add(primitive);
  const texture = new Texture(), paintGeometry = new PlaneGeometry(), paintMaterial = new MeshStandardMaterial({ map: texture });
  const paint = new Group().add(new Mesh(paintGeometry, paintMaterial));
  let finishPool: () => void = () => undefined;
  const poolReady = new Promise<{ scene: Group }>(resolve => { finishPool = () => { resolve({ scene: pool }); }; });
  if (!holdPool) finishPool();
  const begun: string[] = [], pending = new Map<string, { ready: Promise<{ scene: Group }>; finish: () => void }>();
  let fourReady: () => void = () => undefined;
  const firstFour = new Promise<void>(resolve => { fourReady = resolve; });
  const rows = Array.from({ length: 6 }, (_, index) => {
    const name = `paint-${String(index)}`;
    let finish: () => void = () => undefined;
    const ready = new Promise<{ scene: Group }>(resolve => { finish = () => { resolve({ scene: paint }); }; });
    pending.set(name, { ready, finish }); return { name, url: name, geometry: 'hero' };
  });
  const read = vi.fn((url: string) => {
    if (url === 'pool') return poolReady;
    const row = pending.get(url); if (row === undefined) throw new Error('Undeclared painted read');
    begun.push(url); if (begun.length === 4) fourReady(); return row.ready;
  });
  const library = createModelLibrary<never, never>({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 0.6,
    geometryPools: [{ url: 'pool', parts: ['hero'] }], paintedModels: rows }, 'test', {}, read,
  atlasReader ? async url => { await read(url); return texture; } : undefined);
  return { library, begun, firstFour, finishPool, finish: (index: number) => { pending.get(`paint-${String(index)}`)?.finish(); },
    finishAll: () => { for (const row of pending.values()) row.finish(); },
    close: () => { geometry.dispose(); primitiveMaterial.dispose(); paintGeometry.dispose(); paintMaterial.dispose(); texture.dispose(); } };
}

it.each([false, true])('gates four overlapping painted reads on geometry (atlas reader: %s)', async atlasReader => {
  const f = paintedIntake(true, atlasReader), pause = vi.fn(() => Promise.resolve()), loading = f.library.preload(pause);
  try {
    await f.firstFour;
    expect(f.begun).toEqual(['paint-0', 'paint-1', 'paint-2', 'paint-3']);
    f.finishAll();
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    expect(f.library.painted('paint-0')).toBeNull();
    expect(pause).not.toHaveBeenCalled(); expect(f.begun).toHaveLength(4);
    f.finishPool(); await loading;
    expect(pause).toHaveBeenCalledTimes(6);
    const model = f.library.painted('paint-0');
    if (model === null) throw new Error('Missing geometry-gated painted model');
    expect(model.geometry.getAttribute('position').count).toBe(4);
    model.geometry.dispose();
  } finally { f.finishPool(); f.finishAll(); await loading; f.close(); }
});

it('keeps unpaced atlas reads after geometry preparation', async () => {
  const f = paintedIntake(true, true), loading = f.library.preload();
  try {
    await Promise.resolve();
    expect(f.begun).toEqual([]);
    f.finishPool(); await f.firstFour; f.finishAll(); await loading;
    expect(f.begun).toHaveLength(6);
  } finally { f.finishPool(); f.finishAll(); await loading; f.close(); }
});

it('overlaps four source reads while retaining every original row pause and atlas', async () => {
  const f = paintedIntake(), pause = vi.fn(() => Promise.resolve()), loading = f.library.preload(pause);
  try {
    await f.firstFour;
    expect(f.begun).toEqual(['paint-0', 'paint-1', 'paint-2', 'paint-3']);
    f.finishAll(); await loading;
    expect(f.begun).toEqual(['paint-0', 'paint-1', 'paint-2', 'paint-3', 'paint-4', 'paint-5']);
    expect(pause).toHaveBeenCalledTimes(6);
    const first = f.library.painted('paint-0'), last = f.library.painted('paint-5');
    if (first === null || last === null) throw new Error('Missing complete painted intake');
    expect(first.map).toBe(last.map); expect(first.geometry).not.toBe(last.geometry);
    expect(first.geometry.getAttribute('position').array).toEqual(last.geometry.getAttribute('position').array);
    first.geometry.dispose(); last.geometry.dispose();
  } finally { f.finishAll(); await loading; f.close(); }
});

it('drains admitted reads before a caller pause refuses and starts no suffix', async () => {
  const f = paintedIntake();
  let atPause: () => void = () => undefined, settled = false;
  const paused = new Promise<void>(resolve => { atPause = resolve; });
  const outcome = (async () => {
    try { await f.library.preload(() => { atPause(); throw new Error('caller retired'); }); return null; }
    catch (error: unknown) { return error; }
    finally { settled = true; }
  })();
  try {
    await f.firstFour; f.finish(0); await paused;
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
    expect(settled).toBe(false); expect(f.begun).toHaveLength(4);
    f.finishAll(); expect(String(await outcome)).toContain('caller retired');
    expect(f.begun).toEqual(['paint-0', 'paint-1', 'paint-2', 'paint-3']);
  } finally { f.finishAll(); await outcome; f.close(); }
});
