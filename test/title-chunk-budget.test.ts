import { expect, test } from 'vitest';
import { titleClosureBudgetErrors, type ChunkModuleReport } from '../scripts/check-chunks.mjs';
import { writeChunkReport } from '../scripts/app-build/chunkReport.mjs';
import { build, type InlineConfig } from 'vite';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only this isolated tiny Vite fixture, never the app build tree.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep generated fixture inputs under ignored repository scratch.
import { resolve, dirname } from 'node:path';

const roots = ['src/client/app/entry.ts', 'src/client/engine/ui/StartTitle.ts', 'src/client/game/mainMenu.ts', 'src/client/game/grid/pageEntry.ts', 'src/client/game/travel/travel.ts'];
const caps = { 'js/title/raw': 150, 'js/title/gzip': 80 };
function fixture(): Record<string, ChunkModuleReport> {
  const rows: [string, ChunkModuleReport][] = roots.map((source, i) => [`${i}.js`, { name: source, moduleIds: [source], imports: ['shared.js'], rawBytes: 10, gzBytes: 6 }]);
  rows.push(['shared.js', { name: 'shared', moduleIds: ['node_modules/@wildshard/format/src/format/outputDownload.ts'], imports: [], rawBytes: 100, gzBytes: 50 }]);
  return Object.fromEntries(rows);
}
test('title closure counts shared imports once and refuses either exceeded measured ceiling', () => {
  const modules = fixture(); expect(titleClosureBudgetErrors(modules, caps)).toEqual([]);
  expect(titleClosureBudgetErrors(modules, { ...caps, 'js/title/raw': 149 })).toContain('title raw 150 exceeds 149');
  expect(titleClosureBudgetErrors(modules, { ...caps, 'js/title/gzip': 79 })).toContain('title gzip 80 exceeds 79');
  expect(titleClosureBudgetErrors(modules, {})).toContain('missing title gzip ceiling');
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
test('the app build\'s chunk report refuses an over-budget title', async () => {
  const root = mkdtempSync(resolve('tmp/js-title-budget-'));
  const put = (file: string, text: string): void => { const target = resolve(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  try {
    put('src/client/app/entry.ts', roots.slice(1).map(source => `void import(${JSON.stringify(`./${source.slice(4)}`)});`).join('\n'));
    for (const source of roots.slice(1)) put(source, `Reflect.set(globalThis,${JSON.stringify(source)},true);`);
    put('lint/ratchet.json', JSON.stringify({ budgets: { 'js/title/raw': 1, 'js/title/gzip': 1 } }));
    const outDir = resolve(root, 'dist'), options: InlineConfig = { root, configFile: false, logLevel: 'silent',
      build: { outDir, minify: false, manifest: true, sourcemap: 'hidden', rolldownOptions: { input: resolve(root, 'src/client/app/entry.ts') } } };
    await build(options);
    expect(() => writeChunkReport(outDir, root)).toThrow('title raw');
    put('lint/ratchet.json', JSON.stringify({ budgets: { 'js/title/raw': 10000, 'js/title/gzip': 10000 } }));
    expect(Object.keys(writeChunkReport(outDir, root))).toHaveLength(roots.length);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
