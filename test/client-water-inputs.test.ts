import { afterEach, expect, test, vi } from 'vitest';
import { Group, MeshBasicMaterial, PlaneGeometry, type BufferGeometry } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { legacyDouble } from '../src/test/engine/FakeGame';
import * as owned from '../src/client/engine/models/ownedGeometry';
import * as runtime from '../src/client/game/shardfile/runtimeFolder';
import { clientWaterSurfaces, installClientWaterSurfaces } from '../src/client/game/shardfile/clientWaterSurfaces';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { emptyShardfile } from '../src/shared/host/author';

function deferred<T>() {
  let resolve = (_value: T): void => { throw new Error('Missing deferred resolver'); };
  let reject = (_error: unknown): void => { throw new Error('Missing deferred rejecter'); };
  const promise = new Promise<T>((_resolve, _reject) => { resolve = _resolve; reject = _reject; });
  return { promise, resolve, reject };
}
afterEach(() => { vi.restoreAllMocks(); });

function fixture(draw = false) {
  const scope = new Scope('water-inputs'), root = new Group(), material = new MeshBasicMaterial();
  scope.own(material);
  const first = deferred<Uint8Array>(), second = deferred<Uint8Array>(), floor = deferred<Uint8Array>();
  const file = vi.fn((name: string): Promise<Uint8Array> => name === 'first.glb' || name === 'grid.glb' ? first.promise : name === 'floor.bin' ? floor.promise : second.promise);
  const product = legacyDouble<ShardFolder>({ file, shardfile: emptyShardfile({ slug: 'water-fixture', name: 'Water', author: 'Fixture', revision: 1, seed: 1 }) });
  const system = vi.fn((_row: Parameters<ShardContext['system']>[0]): void => undefined), ctx = legacyDouble<ShardContext>({ scope, root, product, game: legacyDouble<ShardContext['game']>({}), system });
  // Promise assimilation probes then; the book is an ordinary non-thenable.
  // Keep strict missing-member failures for every actual material-book read.
  const looks = new Proxy(legacyDouble<Awaited<ReturnType<typeof runtime.runtimeLookMaterials>>>({ materials: new Map([['water-input-look', material]]), setParam: () => undefined, setTexture: () => undefined }), {
    get(target, key, receiver): unknown { return key === 'then' ? undefined : Reflect.get(target, key, receiver); },
  });
  const ready = deferred<typeof looks>(), prepare = vi.spyOn(runtime, 'runtimeLookMaterials').mockReturnValue(ready.promise);
  const loads: ReturnType<typeof vi.fn<(bytes?: Uint8Array | BufferGeometry) => Promise<void>>>[] = [], shapes: PlaneGeometry[] = [];
  const create = vi.spyOn(owned, 'createOwnedGeometry').mockImplementation(() => {
    const shape = new PlaneGeometry(2, 2), load = vi.fn((_bytes?: Uint8Array | BufferGeometry): Promise<void> => Promise.resolve());
    shapes.push(shape); loads.push(load);
    return legacyDouble<owned.OwnedGeometry>({ load, take: () => shape });
  });
  const surface = { look: 'water-input-look', name: 'fixture-water', renderOrder: 3 };
  const row = parseClientPlan({ version: 1, features: [{ kind: 'world.water', rows: draw ? [{ id: 'first', surface, draw: {
    grid: { phone: { file: 'grid.glb' }, desktop: { file: 'grid.glb' } }, floor: { file: 'floor.bin' }, attributes: {}, level: 0,
    dry: [], foam: [], lent: {}, toonSeaLevel: false,
  } }] : [{ id: 'first', surface, geometry: 'first.glb' }, { id: 'second', surface, geometry: 'second.glb' }] }] }).features[0];
  if (row?.kind !== 'world.water') throw new Error('Missing water fixture');
  return { scope, root, material, file, product, ctx, system, looks, ready, prepare, create, loads, shapes, row, first, second, floor,
    finish() { scope.dispose(); for (const shape of shapes) shape.dispose(); } };
}

test('only the first input overlaps looks; original row order, geometry, material and publication remain', async () => {
  const f = fixture(), first = new Uint8Array([1]), second = new Uint8Array([2]);
  try {
    const pending = installClientWaterSurfaces(f.ctx, f.row);
    expect(f.file.mock.calls).toEqual([['first.glb']]);
    expect(f.prepare).toHaveBeenCalledOnce(); expect(f.create).not.toHaveBeenCalled();
    expect(f.root.children).toHaveLength(0); expect(f.system).not.toHaveBeenCalled();
    f.first.resolve(first); f.second.resolve(second); f.ready.resolve(f.looks); await pending;
    expect(f.file.mock.calls).toEqual([['first.glb'], ['second.glb']]);
    expect(f.loads[0]).toHaveBeenCalledExactlyOnceWith(first); expect(f.loads[1]).toHaveBeenCalledExactlyOnceWith(second);
    const surfaces = clientWaterSurfaces(f.ctx);
    expect([...surfaces.keys()]).toEqual(['first', 'second']);
    for (const [i, surface] of [...surfaces.values()].entries()) {
      expect(surface.mesh.geometry).toBe(f.shapes[i]); expect(surface.mesh.material).toBe(f.material);
      expect(surface.mesh.renderOrder).toBe(3); expect(surface.mesh.name).toBe('fixture-water');
    }
    expect(f.root.children).toEqual([...surfaces.values()].map(surface => surface.group));
    expect(f.system).toHaveBeenCalledOnce();
  } finally { f.finish(); }
});

test('look refusal wins and drains both grid and floor even when the grid rejects first', async () => {
  const f = fixture(true), lookFailure = new Error('look refused'), inputFailure = new Error('grid refused');
  try {
    let settled = false;
    const outcome = (async () => { try { await installClientWaterSurfaces(f.ctx, f.row); return undefined; } catch (error) { return error; } finally { settled = true; } })();
    expect(f.file.mock.calls).toEqual([['grid.glb'], ['floor.bin']]);
    f.first.reject(inputFailure); f.ready.reject(lookFailure);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    expect(settled).toBe(false); expect(f.create).not.toHaveBeenCalled();
    f.floor.resolve(new Uint8Array(4));
    expect(await outcome).toBe(lookFailure);
    expect(f.root.children).toHaveLength(0); expect(f.system).not.toHaveBeenCalled();
  } finally { f.finish(); }
});

test('original input refusal surfaces after successful looks without drawing a later row', async () => {
  const f = fixture(), failure = new Error('input refused');
  try {
    const pending = installClientWaterSurfaces(f.ctx, f.row), refused = expect(pending).rejects.toBe(failure);
    f.first.reject(failure); f.ready.resolve(f.looks); await refused;
    expect(f.file.mock.calls).toEqual([['first.glb']]);
    expect(f.root.children).toHaveLength(0); expect(f.loads[0]).not.toHaveBeenCalled();
    expect(f.system).not.toHaveBeenCalled();
  } finally { f.finish(); }
});

test.each(['retire', 'reader', 'declaration'] as const)('%s during input overlap refuses before decode or publication', async mode => {
  const f = fixture();
  try {
    // The defining parser freezes rows. Only this hostile mutation control
    // needs an independent mutable copy; assert that the mutation really took.
    const row = mode === 'declaration' ? structuredClone(f.row) : f.row;
    const pending = installClientWaterSurfaces(f.ctx, row), refused = expect(pending).rejects.toThrow(mode === 'declaration' ? 'input declaration changed' : 'owner left or changed');
    if (mode === 'retire') f.scope.dispose();
    else if (mode === 'reader') Reflect.set(f.product, 'file', () => Promise.resolve(new Uint8Array([9])));
    else { const first = row.rows[0]; if (first === undefined) throw new Error('Missing first row'); expect(Reflect.set(first, 'geometry', 'changed.glb')).toBe(true); }
    f.first.resolve(new Uint8Array([1])); f.ready.resolve(f.looks); await refused;
    expect(f.loads.every(load => load.mock.calls.length === 0)).toBe(true);
    expect(f.root.children).toHaveLength(0); expect(f.system).not.toHaveBeenCalled();
  } finally { f.finish(); }
});
