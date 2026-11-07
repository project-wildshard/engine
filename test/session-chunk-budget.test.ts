import { expect, test } from 'vitest';
import { sessionClosureBudgetErrors, type ChunkModuleReport } from '../scripts/check-chunks.mjs';

// js-payload J10: the shard session entry's static closure has gzip / raw ceilings and carries no shard folder's code.
const caps = { 'js/session/raw': 120, 'js/session/gzip': 60 };
function fixture(shared: string): Record<string, ChunkModuleReport> {
  return {
    'session.js': { name: 'session', moduleIds: ['src/client/game/session/session.ts'], imports: ['shared.js'], rawBytes: 20, gzBytes: 10 },
    'shared.js': { name: 'shared', moduleIds: [shared, 'src/shards/pine-hollow/thumbs/pine-hollow.jpg'], imports: [], rawBytes: 100, gzBytes: 50 },
  };
}
test('the session closure counts its static imports against both ceilings', () => {
  expect(sessionClosureBudgetErrors(fixture('src/client/game/shardfile/client.ts'), caps)).toEqual([]);
  expect(sessionClosureBudgetErrors(fixture('src/client/game/shardfile/client.ts'), { ...caps, 'js/session/gzip': 59 })).toContain('session gzip 60 exceeds 59');
  expect(sessionClosureBudgetErrors(fixture('src/client/game/shardfile/client.ts'), { 'js/session/raw': 120 })).toContain('missing session gzip ceiling');
});
test.each(['src/shards/retired-fixture-legacy/runtime/index.ts', 'src/shards/driftwood-isle/runtime/views.ts'])('the session closure refuses shard code %s', module => {
  expect(sessionClosureBudgetErrors(fixture(module), caps)).toContain(`forbidden session module ${module} (shared.js)`);
});
