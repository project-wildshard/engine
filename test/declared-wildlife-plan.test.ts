import { expect, test } from 'vitest';
import { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { WILDLIFE_FILES, WILDLIFE_FRAME, admitClientPlan } from '../src/client/game/shardfile/clientPlan';

// ONE-FORMAT OF29e (Nalati): a plan naming no wildlife row stands it from the declared wildlife files.
function product(files: readonly string[]) {
  const source = emptyShardfile({ slug: 'steppe', name: 'Steppe', author: 'Fixture', revision: 1, seed: 7 });
  const named = new Map(files.map(file => [file, { hash: '0'.repeat(64), url: `https://example.invalid/${file}` }]));
  return createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(), files: named,
    read: () => Promise.reject(new Error('No fixture read permitted')) });
}
const all = [WILDLIFE_FILES.file, WILDLIFE_FILES.crowd.json, WILDLIFE_FILES.crowd.binary];

test('declared wildlife files stand the population with no plan row', () => {
  const rows = admitClientPlan({ version: 1, features: [] }, product(all)).features.filter(row => row.kind === 'population.wildlife');
  expect(rows).toEqual([{ kind: 'population.wildlife', file: 'actors/wildlife.json', crowd: { json: 'actors/sheep.json', binary: 'actors/sheep.bin' },
    navSteer: true, publish: 'wildlife', frame: { id: WILDLIFE_FRAME, after: [], before: ['engine.creatures.update'] } }]);
});

test('a plan naming its wildlife keeps its own, and missing files stand none', () => {
  const own = { kind: 'population.wildlife', file: WILDLIFE_FILES.file, crowd: { ...WILDLIFE_FILES.crowd }, navSteer: false,
    frame: { id: 'shard.steppe.wildlife', after: [], before: [] } };
  expect(admitClientPlan({ version: 1, features: [own] }, product(all)).features.filter(row => row.kind === 'population.wildlife')).toEqual([own]);
  expect(admitClientPlan({ version: 1, features: [] }, product(all.slice(0, 2))).features.some(row => row.kind === 'population.wildlife')).toBe(false);
});
