import { installWorldFixture } from './fixtures/worldSetup';
import { afterEach, expect, test, vi } from 'vitest';
import { AnimalFactory, type AnimalModel } from '../src/client/engine/entities/AnimalFactory';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { Scope } from '../src/shared/engine/app/scope';
import { currentOwner } from '../src/shared/engine/app/ownership';
import { pageScope } from '../src/shared/engine/app/resources';
import { app } from '../src/client/engine/app/runtime';
import { BufferAttribute, Skeleton, Vector3 } from 'three';

await installWorldFixture();

const models = new Set<AnimalModel>(), owners: Scope[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const owner of owners.splice(0)) owner.dispose();
  for (const model of models) { model.geometry.dispose(); for (const material of new Set([model.fur, model.hard, model.eye, ...model.shells])) material.dispose(); }
  models.clear();
});
function factory(): AnimalFactory {
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing test sky');
  vi.spyOn(sky, 'setupMaterial').mockImplementation(() => undefined);
  vi.spyOn(app.species, 'preloads').mockReturnValue([]);
  return new AnimalFactory(sky, { style: 'toon', render: { lowPoly: true, waitForModels: false, furRim: false, tintRange: 0, oneMaterial: true } });
}

test('prepares exact cached variants in the calling owner across spent frame slices', async () => {
  const direct = factory(), prepared = factory(), owner = new Scope('model-preparation'); owners.push(owner);
  const rows = [{ kind: 'bear', variant: 'brown' }, { kind: 'bear', variant: 'black' }, { kind: 'bear', variant: 'brown' }], contexts: (Scope | null)[] = [];
  const build = prepared.model.bind(prepared);
  vi.spyOn(prepared, 'model').mockImplementation((kind, variant) => { contexts.push(currentOwner()); const model = build(kind, variant); models.add(model); return model; });
  const timeout = vi.spyOn(pageScope, 'timeout');
  let at = 0; vi.spyOn(performance, 'now').mockImplementation(() => { at += 10; return at; });
  await owner.run(() => prepared.prepareModels(rows));
  expect(contexts).toEqual([owner, owner, owner]);
  expect(timeout.mock.calls.length).toBeGreaterThanOrEqual(rows.length);
  for (const row of rows) {
    const expected = direct.model(row.kind, row.variant), actual = prepared.model(row.kind, row.variant); models.add(expected);
    expect(prepared.model(row.kind, row.variant)).toBe(actual);
    expect(actual.bones).toEqual(expected.bones); expect(actual.dims).toEqual(expected.dims);
    expect(actual.geometry.groups).toEqual(expected.geometry.groups);
    expect(Object.keys(actual.geometry.attributes)).toEqual(Object.keys(expected.geometry.attributes));
    for (const [key, attribute] of Object.entries(expected.geometry.attributes)) expect(actual.geometry.getAttribute(key).array).toEqual(attribute.array);
    expect(actual.geometry.index?.array).toEqual(expected.geometry.index?.array);
  }
});

test('retiring the owner during a pending slice refuses further model construction', async () => {
  const prepared = factory(), owner = new Scope('retired-model-preparation'); owners.push(owner);
  const build = vi.spyOn(prepared, 'model');
  let at = 0; vi.spyOn(performance, 'now').mockImplementation(() => { at += 10; return at; });
  const pending = owner.run(() => prepared.prepareModels([{ kind: 'elk' }])); owner.dispose();
  await expect(pending).rejects.toThrow('owner closed');
  expect(build).not.toHaveBeenCalled();
  await expect(prepared.prepareModels(Array.from({ length: 1025 }, () => ({ kind: 'elk' })))).rejects.toThrow('Excessive');
});

test.each(['bear', 'horse', 'wolf'])('one bind inversion preserves every native %s joint and posed vertex', kind => {
  const prepared = factory(), model = prepared.model(kind); models.add(model);
  const inversions = vi.spyOn(Skeleton.prototype, 'calculateInverses');
  const before = prepared.instantiate(model, .37);
  // The original no-matrix bind updates the fresh native tree and recomputes
  // its inverses. It supplies the independent before result for this rig.
  before.mesh.bind(before.mesh.skeleton);
  expect(inversions).toHaveBeenCalledTimes(2); inversions.mockClear();
  const actual = prepared.instantiate(model, .37);
  try {
    expect(inversions).toHaveBeenCalledTimes(1);
    expect(actual.mesh.geometry).toBe(before.mesh.geometry);
    expect(actual.mesh.bindMatrix.elements).toStrictEqual(before.mesh.bindMatrix.elements);
    expect(actual.mesh.bindMatrixInverse.elements).toStrictEqual(before.mesh.bindMatrixInverse.elements);
    expect(actual.mesh.skeleton.boneInverses.map(matrix => matrix.elements)).toStrictEqual(before.mesh.skeleton.boneInverses.map(matrix => matrix.elements));
    const position = model.geometry.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Missing native rig positions');
    for (const pose of [false, true]) {
      const samples: Float64Array[] = [];
      for (const rig of [before, actual]) {
        for (const [index, bone] of rig.mesh.skeleton.bones.entries()) {
          if (pose) bone.rotation.set(index * .003, index * -.005, index * .007);
        }
        rig.mesh.updateMatrixWorld(true); rig.mesh.skeleton.update();
        const vertices = new Float64Array(position.count * 3), vertex = new Vector3();
        for (let index = 0; index < position.count; index++) {
          vertex.fromBufferAttribute(position, index); rig.mesh.applyBoneTransform(index, vertex); vertex.toArray(vertices, index * 3);
        }
        samples.push(vertices);
      }
      const [original, current] = samples;
      if (original === undefined || current === undefined) throw new Error('Missing paired native pose');
      expect(Buffer.compare(Buffer.from(original.buffer), Buffer.from(current.buffer))).toBe(0);
      expect(actual.mesh.skeleton.boneMatrices).toStrictEqual(before.mesh.skeleton.boneMatrices);
    }
  } finally {
    inversions.mockRestore(); before.mesh.skeleton.dispose(); actual.mesh.skeleton.dispose();
    before.materials[0]?.dispose(); actual.materials[0]?.dispose();
  }
});

test('prepares all potential variants when authored placement leaves the manager to roll', async () => {
  const prepared = factory(), owner = new Scope('rolled-model-preparation'); owners.push(owner);
  const build = prepared.model.bind(prepared), variants: (string | undefined)[] = [];
  vi.spyOn(prepared, 'model').mockImplementation((kind, variant) => { variants.push(variant); const model = build(kind, variant); models.add(model); return model; });
  await owner.run(() => prepared.prepareModels([{ kind: 'bear', variant: null }]));
  expect(variants).toEqual(['black', 'black-blaze', 'brown', 'black-old', 'brown-old']);
  const before = variants.length;
  for (const variant of ['black', 'brown-old']) {
    const model = prepared.model('bear', variant); expect(prepared.model('bear', variant)).toBe(model);
  }
  expect(variants.slice(before)).toEqual(['black', 'black', 'brown-old', 'brown-old']);
});
