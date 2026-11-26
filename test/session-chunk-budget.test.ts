import { expect, test } from 'vitest';
import { readCaps } from '../src/scripts/budgets/files.mjs';
import { sessionClosureBudgetErrors, type ChunkBudgets, type ChunkModuleReport } from '../src/scripts/check-chunks.mjs';
// BUDGET-CAPS BC5: code sizes are judged against the real caps (J324's 1 MB raw title) and a fixture baseline.
const realCaps = readCaps();
function codeBudgets(values: Record<string, number>, declared: readonly string[] = []): ChunkBudgets {
  return { caps: realCaps, baselines: { schema: 1, about: '', baselines: Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, { value, contentKey: 'engine', ...(declared.includes(key) ? { declared: 'a feature' } : {}) }])) } };
}


// js-payload J10: the shard session entry's static closure has gzip / raw ceilings and carries no shard folder's code.
const caps = codeBudgets({ 'js/session/raw': 120, 'js/session/gzip': 60 });
function fixture(shared: string): Record<string, ChunkModuleReport> {
  return {
    'session.js': { name: 'session', moduleIds: ['src/client/game/session/session.ts'], imports: ['shared.js'], rawBytes: 20, gzBytes: 10 },
    'shared.js': { name: 'shared', moduleIds: [shared, 'src/shards/pine-hollow/thumbs/pine-hollow.jpg'], imports: [], rawBytes: 100, gzBytes: 50 },
  };
}
test('the session closure counts its static imports against both ceilings', () => {
  const measurements: [string, number, number | null][] = [];
  expect(sessionClosureBudgetErrors(fixture('src/client/game/shardfile/client.ts'), caps, (unit, bytes, cap) => {
    measurements.push([unit, bytes, cap]);
  })).toEqual([]);
  expect(measurements).toEqual([['raw', 120, 132], ['gzip', 60, 66]]);
  expect(sessionClosureBudgetErrors(fixture('src/client/game/shardfile/client.ts'), codeBudgets({ 'js/session/raw': 120, 'js/session/gzip': 54 })).find(error => error.startsWith('session gzip 60 regressed'))).toBeDefined();
  const rawOnly: ChunkBudgets = { ...caps, caps: { ...caps.caps, caps: { 'js/session/raw': { hard: null, unit: 'bytes', kind: 'exact', decision: null, why: 'w' } } } };
  expect(sessionClosureBudgetErrors(fixture('src/client/game/shardfile/client.ts'), rawOnly)).toContain('missing session gzip ceiling');
});
test.each(['src/shards/retired-fixture-legacy/runtime/index.ts', 'src/shards/driftwood-isle/runtime/views.ts'])('the session closure refuses shard code %s', module => {
  expect(sessionClosureBudgetErrors(fixture(module), caps)).toContain(`forbidden session module ${module} (shared.js)`);
});
