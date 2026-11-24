import { expect, test } from 'vitest';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { admitClientPlan } from '../src/client/game/shardfile/clientPlan';

// FORMAT-PRUNE FP49.
// Glowfen's first local boot refused here: admission asked every emitter plan for `world.scenes`, which a scene shard has none of
test('a scene shard plan admits emitters with no scene feature; a product with world/scenes still needs it', () => {
  const source = emptyShardfile({ slug: 'fp49-fen', name: 'Fen', author: 'Fixture', revision: 1, seed: 7 });
  const folder = (sections: ReadonlyMap<string, unknown>) => createShardFolder({ slug: 'fp49-fen', revision: 1, shardfile: source, sections, files: new Map(),
    read: () => Promise.reject(new Error('No fixture read permitted')) });
  const plan = { version: 1, features: [{ kind: 'light.emitters', rows: { version: 1, input: 'scene.emitters', clock: 'scene.emitter-clock', rows: [{
    id: 'fen.shrine', parent: 'scene', initially: true, draws: [],
    light: { at: { point: 'scene.origin', offset: [0, 4.6, -70] }, colour: 0x7f_e8_ff, gain: 16, distance: 22, decay: 2, shared: false, waves: [] },
  }] } }] };
  expect(admitClientPlan(plan, folder(new Map())).features.map(row => row.kind)).toContain('light.emitters');
  expect(() => admitClientPlan(plan, folder(new Map([['world/scenes', { version: 1 }]])))).toThrow('Emitters require the scene feature');
});
