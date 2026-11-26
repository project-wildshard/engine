import { expect, test } from 'vitest';
import { readCaps } from '../src/scripts/budgets/files.mjs';
import { titleClosureBudgetErrors, type ChunkBudgets, type ChunkModuleReport } from '../src/scripts/check-chunks.mjs';
// BUDGET-CAPS BC5: code sizes are judged against the real caps (J324's 1 MB raw title) and a fixture baseline.
const realCaps = readCaps();
function codeBudgets(values: Record<string, number>, declared: readonly string[] = []): ChunkBudgets {
  return { caps: realCaps, baselines: { schema: 1, about: '', baselines: Object.fromEntries(Object.entries(values).map(([key, value]) =>
    [key, { value, contentKey: 'engine', ...(declared.includes(key) ? { declared: 'a feature' } : {}) }])) } };
}
const noCaps: ChunkBudgets = { caps: { schema: 1, about: '', caps: {} }, baselines: { schema: 1, about: '', baselines: {} } };


const roots = ['src/client/app/entry.ts', 'src/client/engine/ui/StartTitle.ts', 'src/client/game/mainMenu.ts', 'src/client/game/grid/pageEntry.ts', 'src/client/game/travel/travel.ts'];
const caps = codeBudgets({ 'js/title/raw': 150, 'js/title/gzip': 80 });
function fixture(): Record<string, ChunkModuleReport> {
  const rows: [string, ChunkModuleReport][] = roots.map((source, i) => [`${i}.js`, { name: source, moduleIds: [source], imports: ['shared.js'], rawBytes: 10, gzBytes: 6 }]);
  rows.push(['shared.js', { name: 'shared', moduleIds: ['node_modules/@wildshard/format/src/format/outputDownload.ts'], imports: [], rawBytes: 100, gzBytes: 50 }]);
  return Object.fromEntries(rows);
}
test('title closure counts shared imports once and passes at its baseline', () => {
  expect(titleClosureBudgetErrors(fixture(), caps)).toEqual([]);
  expect(titleClosureBudgetErrors(fixture(), noCaps)).toContain('missing title gzip ceiling');
});
test('10% over the baseline with no declared line fails; with one it passes', () => {
  const grown = codeBudgets({ 'js/title/raw': 136, 'js/title/gzip': 72 });
  const errors = titleClosureBudgetErrors(fixture(), grown);
  expect(errors.find(error => error.startsWith('title raw 150 regressed'))).toContain('cli.mjs declare js/title/raw');
  expect(errors.find(error => error.startsWith('title gzip 80 regressed'))).toBeDefined();
  expect(titleClosureBudgetErrors(fixture(), codeBudgets({ 'js/title/raw': 136, 'js/title/gzip': 72 }, ['js/title/raw', 'js/title/gzip']))).toEqual([]);
  expect(titleClosureBudgetErrors(fixture(), codeBudgets({ 'js/title/raw': 137, 'js/title/gzip': 73 }))).toEqual([]);
  expect(titleClosureBudgetErrors(fixture(), { ...grown, hardOnly: true })).toEqual([]);
});
test('a title over 1 MB raw fails either way (J324)', () => {
  const modules = fixture(); modules['shared.js'] = { name: 'shared', moduleIds: ['node_modules/@wildshard/format/src/format/outputDownload.ts'], imports: [], rawBytes: 1_000_000, gzBytes: 50 };
  const declared = codeBudgets({ 'js/title/raw': 150, 'js/title/gzip': 80 }, ['js/title/raw']);
  expect(titleClosureBudgetErrors(modules, declared)).toContain('title raw 1000050 exceeds the 1000000 hard cap (J324)');
  expect(titleClosureBudgetErrors(modules, { ...declared, hardOnly: true })).toContain('title raw 1000050 exceeds the 1000000 hard cap (J324)');
});
test.each(['node_modules/three/build/three.core.js', 'node_modules/@dimforge/rapier3d/rapier.js', 'src/shards/other/runtime.ts',
  'src/client/game/boot/bytes.generated.ts', 'node_modules/@wildshard/format/src/format/shardSchema.ts', 'node_modules/@wildshard/format/src/format/newGameplayValidator.ts', 'src/client/engine/explore/Explore.ts'])('title refuses a forbidden transitive module %s', module => {
  const modules = fixture(); modules['shared.js'] = { name: 'shared', moduleIds: [module], imports: [], rawBytes: 100, gzBytes: 50 };
  expect(titleClosureBudgetErrors(modules, caps)).toContain(`forbidden title module ${module} (shared.js)`);
});
test('missing roots, imports, measurements and dependency rows fail closed', () => {
  const modules = fixture(); delete modules['0.js'];
  expect(titleClosureBudgetErrors(modules, caps)).toContain('missing title root src/client/app/entry.ts');
  modules['shared.js'] = { name: 'shared', moduleIds: [], gzBytes: 50 };
  expect(titleClosureBudgetErrors(modules, caps)).toContain('missing title static imports (shared.js)');
  expect(titleClosureBudgetErrors(modules, caps)).toContain('missing title raw bytes (shared.js)');
  delete modules['shared.js']; expect(titleClosureBudgetErrors(modules, caps)).toContain('missing title chunk shared.js');
});
