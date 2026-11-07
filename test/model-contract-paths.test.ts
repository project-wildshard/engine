import { describe, expect, it } from 'vitest';
import { checkModels } from '../scripts/check-models.mjs';

describe('model contract after client relocation', () => {



  it('keeps non-model runtime modules and other shard paths restricted', () => {
    const files = {
      'src/shards/pine-hollow/runtime/world/specimen.ts': "defineModel({ id: 'pine-hollow/specimen' });",
      'src/shards/pine-hollow/runtime/models/unlisted.ts': "defineModel({ id: 'pine-hollow/unlisted' });",
      'src/shards/pine-hollow/runtime/models/logCabin.ts': "defineModel({ id: 'pine-hollow/retired' });",
      'src/shards/far-reach/runtime/models/specimen.ts': "defineModel({ id: 'far-reach/specimen' });",
    };
    expect(checkModels(files).violations).toEqual([
      expect.stringContaining('pine-hollow/runtime/world/specimen.ts: defineModel outside'),
      expect.stringContaining('pine-hollow/runtime/models/unlisted.ts: defineModel outside'),
      expect.stringContaining('pine-hollow/runtime/models/logCabin.ts: defineModel outside'),
      expect.stringContaining('far-reach/runtime/models/specimen.ts: defineModel outside'),
    ]);
  });

  it('keeps cross-shard model imports restricted at canonical paths', () => {
    const file = 'src/shards/driftwood-isle/models/catalogue.ts';
    expect(checkModels({ [file]: "import { model } from '../../pine-hollow/models/specimen'; defineModel({ id: 'driftwood-isle/specimen' });" }).violations)
      .toEqual([expect.stringContaining("imports another shard's models")]);
  });

  it('recognizes the existing typed model factories without dropping prefix checks', () => {
    const file = 'src/shards/driftwood-isle/models/catalogue.ts';
    expect(checkModels({ [file]: "defineGeometryModel({ id: 'driftwood-isle/cove' });" }).violations).toEqual([]);
    expect(checkModels({ [file]: "defineGeometryModel({ id: 'other/cove' });" }).violations)
      .toEqual([expect.stringContaining("must start with 'driftwood-isle/'")]);
    expect(checkModels({ [file]: 'export const empty = true;' }).violations)
      .toEqual([expect.stringContaining('defines no model')]);
    expect(checkModels({ 'src/shards/far-reach/models/gear.ts': 'modelCatalogue(rows, owners);' }).violations).toEqual([]);
  });



  it('keeps the retired native roster outside the model-definition contract', () => {
    const file = 'src/shards/pine-hollow/roster.ts';
    expect(checkModels({ [file]: 'export const roster = () => rows.map(live);' }).violations).toEqual([]);
    expect(checkModels({ [file]: "defineModel({ id: 'pine-hollow/new-native' });" }).violations)
      .toEqual([expect.stringContaining('defineModel outside')]);
  });

  it('retains the exact relocated Nalati gear model contract', () => {
    const file = 'src/shards/nalati-grasslands/generators/gear.ts';
    expect(checkModels({ [file]: "defineModel({ id: 'nalati-grasslands/spear' });" }).violations).toEqual([]);
    expect(checkModels({ [file]: "defineModel({ id: 'other/spear' });" }).violations)
      .toEqual([expect.stringContaining("must start with 'nalati-grasslands/'")]);
    expect(checkModels({ 'src/shards/nalati-grasslands/generators/other.ts': "defineModel({ id: 'nalati-grasslands/spear' });" }).violations)
      .toEqual([expect.stringContaining('defineModel outside')]);
  });

  it.each([
    ['src/client/engine/render/scatterInstances.ts', 'new THREE.InstancedMesh();', 1],
    ['src/client/game/ambient/wingField.ts', 'new THREE.InstancedMesh();', 1],
    ['src/client/game/boss/arenaFire.ts', 'new THREE.InstancedMesh();', 2],
    ['src/client/game/practice/course.ts', 'registry.add({ object });', 1],
    ['src/client/game/weapons/heldPolearm.ts', 'new THREE.InstancedMesh();', 1],
  ] as const)('retains the relocated draw ceiling at %s', (file, draw, ceiling) => {
    expect(checkModels({ [file]: draw.repeat(ceiling) }).violations).toEqual([]);
    expect(checkModels({ [file]: draw.repeat(ceiling + 1) }).violations)
      .toEqual([expect.stringContaining(`${ceiling + 1} ×`)]);
  });

  it('refuses the removed primary Nine draw allowance', () => {
    expect(checkModels({ 'src/shards/nine-dragon-stack/world/casts.ts': 'new InstancedMesh();' }).violations)
      .toEqual([expect.stringContaining('1 × InstancedMesh')]);
  });

  it.each([
    ['src/client/game/plugin/ui.ts', 'new InstancedMesh();'],
    ['src/client/game/shardfile/worldSceneWeld.ts', 'new InstancedMesh();'],
    ['src/sharddev/bake/glb.ts', 'mergeGeometries(parts);'],
    ['src/client/game/looks/posedInstances.ts', 'new THREE.InstancedMesh();'],
  ])('retains a one-draw ceiling at %s', (file, draw) => {
    expect(checkModels({ [file]: draw }).violations).toEqual([]);
    expect(checkModels({ [file]: `${draw} ${draw}` }).violations)
      .toEqual([expect.stringContaining('2 ×')]);
  });
});
