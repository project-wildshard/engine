import { expect, test } from 'vitest';
import configSource from '../src/shards/open-plots/shard.config.ts?raw';
import declared from '../src/shards/open-plots/outputs.json' with { type: 'json' };
import project, { outputs } from '../src/shards/open-plots/shard.config';
import { audioOutputs, outputs as worldDeclarations } from '../src/shards/open-plots/generators/product';
import layout from '../src/shards/open-plots/data/layouts/night-market.json' with { type: 'json' };
import { GridAssembly } from '../src/shared/game/grid/assembly';

// G604: the open-plots entry is a thin declaration (its products assemble in generators/product.ts at build time), one
// product per idea row
test('the open-plots entry is declaration-only and declares one product per idea', () => {
  expect(Object.keys(outputs)).toEqual(declared.outputs.map(row => row.slug));
  for (const row of declared.outputs) expect(worldDeclarations[row.slug]).toMatchObject({ identity: { slug: row.slug }, accent: row.accent, world: { glb: `assets/${row.idea}/world.glb` } });
  expect(outputs).toBe(audioOutputs);
  expect(project).toEqual(worldDeclarations[declared.outputs[0]?.slug ?? '']);
});

test('Night Market road B lowers only its layout curtain and keeps road A posters', () => {
  const grid = new GridAssembly({ developer: false, devserver: false });
  const low = grid.cells.filter(cell => cell.edgeLook !== undefined);
  expect(low.map(cell => cell.slug)).toEqual(['open-plot-night-market']);
  for (const cell of low) expect(cell.edgeLook).toEqual({ height: 1.2 });
  expect(layout.posters.entry).toMatchObject({ width: 10, bottom: 1.8, inset: 247, posts: 4, offset: 18 });
});

test('all plot poster faces use the unlit map or baked mean without fog', () => {
  for (const output of Object.values(worldDeclarations)) expect(output.look.materials.billboard).toMatchObject({
    family: 'graph', graph: { model: 'unlit', effectState: { fog: false },
      nodes: { picture: { op: 'meshMap', name: 'colourOrVertex' } } },
  });
});
