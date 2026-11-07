import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, MeshBasicMaterial, Object3D } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { modelContext } from '@wildshard/engine/models/model';
import { Rng } from '@wildshard/engine/core/rng';
import { bindWorldSceneModelSources, defineWorldSceneCatalogue } from './worldSceneCatalogue';
import { parseWorldSceneModels, worldSceneModelResources } from '@wildshard/format/worldSceneModels';

// A LOD level's draw over its full cast's shared vertex attributes (Nine's casts), and an empty far cutoff.
const draw = { id: 'cast', library: 'casts', model: 'lion', material: 'kit' };
const LION = { library: 'casts', model: 'lion' };
const rows = (attributes: { library: string; model: string } = LION) => ({ product: 'fixture-casts', models: [{ key: 'lion', id: 'fixture-casts/lion',
  name: 'Lion', category: 'props', pipeline: 'trellis', file: 'casts.json', defaults: {}, assembly: 'parts', choices: [{ id: 'only', params: {}, size: [1, 1, 1], colliders: [], draws: [draw],
    lods: [{ from: 10, draws: [{ ...draw, model: 'lion-mid10', attributes }] }, { from: 40, draws: [] }] }] }] });
function sources(index: number[]) {
  const donor = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array(12), 3)).setAttribute('normal', new BufferAttribute(new Float32Array(12), 3));
  donor.setIndex([0, 1, 2, 0, 2, 3]);
  const prepared = new BufferGeometry(); prepared.setIndex(index);
  return { donor, prepared, geometries: new Map([[JSON.stringify(['casts', 'lion']), donor], [JSON.stringify(['casts', 'lion-mid10']), prepared]]), materials: new Map([['kit', new MeshBasicMaterial()]]) };
}

test('a shared-attribute level draws its own index over the donor arrays, once, released with the sources owner', () => {
  const owner = new Scope('casts'), ctx = modelContext(null), { donor, prepared, geometries, materials } = sources([0, 1, 2]);
  bindWorldSceneModelSources(ctx, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries, materials }, owner);
  const lion = defineWorldSceneCatalogue(rows()).model('lion');
  const mid = lion.lods?.[0]?.build(ctx, {}, new Rng(1)), again = lion.lods?.[0]?.build(ctx, {}, new Rng(1));
  if (mid === undefined || again === undefined || mid instanceof Object3D || again instanceof Object3D) throw new Error('Missing raw LOD parts');
  const geometry = mid[0]?.geometry;
  expect(geometry?.index).toBe(prepared.index); expect(geometry?.getAttribute('position')).toBe(donor.getAttribute('position'));
  expect(geometry?.getAttribute('normal')).toBe(donor.getAttribute('normal')); expect(again[0]?.geometry).toBe(geometry);
  expect(lion.lods?.[1]?.from).toBe(40); expect(lion.lods?.[1]?.build(ctx, {}, new Rng(1))).toEqual([]);
  const dispose = vi.spyOn(geometry ?? new BufferGeometry(), 'dispose'); owner.dispose(); expect(dispose).toHaveBeenCalledTimes(1);
  // a later owner of the same sources draws through a fresh borrower, never the released one
  const next = new Scope('casts-again'), hot = modelContext(null);
  bindWorldSceneModelSources(hot, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries, materials }, next);
  const rebuilt = lion.lods?.[0]?.build(hot, {}, new Rng(1));
  if (rebuilt === undefined || rebuilt instanceof Object3D) throw new Error('Missing rebuilt LOD parts');
  expect(rebuilt[0]?.geometry).not.toBe(geometry); expect(rebuilt[0]?.geometry.getAttribute('position')).toBe(donor.getAttribute('position'));
  next.dispose();
});

test('an index past its donor, or a donor missing from the sources, refuses before any part is drawn', () => {
  const owner = new Scope('casts'), ctx = modelContext(null), past = sources([0, 1, 9]);
  bindWorldSceneModelSources(ctx, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries: past.geometries, materials: past.materials }, owner);
  expect(() => defineWorldSceneCatalogue(rows()).model('lion').lods?.[0]?.build(ctx, {}, new Rng(1))).toThrow('past its donor');
  owner.dispose();
  const missing = new Scope('casts'), cold = modelContext(null), { geometries, materials } = sources([0, 1, 2]);
  const moved = rows({ library: 'casts', model: 'absent' });
  bindWorldSceneModelSources(cold, 'fixture-casts', { catalogue: parseWorldSceneModels(moved), geometries, materials }, missing);
  expect(() => defineWorldSceneCatalogue(moved).model('lion').lods?.[0]?.build(cold, {}, new Rng(1))).toThrow('not ready');
  missing.dispose();
});

test('a shared-attribute donor is a declared resource, and the field is refused outside a LOD level', () => {
  const resources = worldSceneModelResources(parseWorldSceneModels(rows())).geometry.map(row => `${row.library}/${row.model}`);
  expect(resources).toContain('casts/lion'); expect(resources).toContain('casts/lion-mid10');
  const level0 = { ...rows(), models: [{ ...rows().models[0], choices: [{ ...rows().models[0]?.choices[0], draws: [{ ...draw, attributes: { library: 'casts', model: 'lion' } }] }] }] };
  expect(() => parseWorldSceneModels(level0)).toThrow();
});

test('two owners lending the same templates borrow apart; retiring one keeps the other and the donor intact', () => {
  const { donor, geometries, materials } = sources([0, 1, 2]), lion = defineWorldSceneCatalogue(rows()).model('lion');
  const a = new Scope('book-a'), b = new Scope('book-b'), ctxA = modelContext(null), ctxB = modelContext(null);
  bindWorldSceneModelSources(ctxA, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries, materials }, a);
  bindWorldSceneModelSources(ctxB, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries, materials }, b);
  const partsA = lion.lods?.[0]?.build(ctxA, {}, new Rng(1)), partsB = lion.lods?.[0]?.build(ctxB, {}, new Rng(1));
  if (partsA === undefined || partsB === undefined || partsA instanceof Object3D || partsB instanceof Object3D) throw new Error('Missing raw LOD parts');
  const fromA = partsA[0]?.geometry, fromB = partsB[0]?.geometry, donorDispose = vi.spyOn(donor, 'dispose');
  expect(fromA).not.toBe(fromB);
  a.dispose();
  expect(fromB?.getAttribute('position')).toBe(donor.getAttribute('position')); expect(donor.getAttribute('position')).toBeInstanceOf(BufferAttribute);
  expect(donorDispose).not.toHaveBeenCalled(); expect(lion.lods?.[0]?.build(ctxB, {}, new Rng(1))).toEqual(partsB);
  b.dispose();
});

test('a retiring ancestor of the sources owner, or a fractional index, refuses the borrow', () => {
  const parent = new Scope('cell'), owner = parent.child('casts'), ctx = modelContext(null), { geometries, materials } = sources([0, 1, 2]);
  bindWorldSceneModelSources(ctx, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries, materials }, owner);
  parent.onDispose(() => undefined); // retired first: the owner is disposing, not yet disposed
  const steps = parent.disposeSteps(); steps.next();
  expect(owner.disposing).toBe(true);
  expect(() => defineWorldSceneCatalogue(rows()).model('lion').lods?.[0]?.build(ctx, {}, new Rng(1))).toThrow('live sources owner');
  for (let step = steps.next(); step.done !== true; step = steps.next()) { /* finish the retirement */ }
  const fraction = new Scope('casts'), fctx = modelContext(null), odd = sources([0, 1, 2]);
  odd.prepared.setIndex(new BufferAttribute(new Float32Array([0, 1.5, 2]), 1));
  bindWorldSceneModelSources(fctx, 'fixture-casts', { catalogue: parseWorldSceneModels(rows()), geometries: odd.geometries, materials: odd.materials }, fraction);
  expect(() => defineWorldSceneCatalogue(rows()).model('lion').lods?.[0]?.build(fctx, {}, new Rng(1))).toThrow('past its donor');
  fraction.dispose();
});
