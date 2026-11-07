import { expect, test } from 'vitest';
import { GRID_SEAMS, gridSeamAsset, readGridSeams, writeGridSeams } from '../scripts/app-build/gridSeams.mjs';
import { checkChunks } from '../scripts/check-chunks.mjs';
import { writeChunkReport } from '../scripts/app-build/chunkReport.mjs';
import { build, type InlineConfig } from 'vite';
import { jsonDataHeapBytes } from '@wildshard/format/json';
// oxlint-disable-next-line import/no-nodejs-modules -- The build guard fixture owns and removes only its small tmp tree.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the isolated build fixture inside the ignored scratch root.
import { resolve } from 'node:path';

test('the build keeps exact seam JSON in a content-addressed asset, not a JS literal', () => {
  const source = '{"plans":[["native",[[0,0.125,1]]]],"edges":[]}';
  const asset = gridSeamAsset(source);
  expect(asset.source).toBe(source);
  expect(asset.address.bytes).toBe(new TextEncoder().encode(source).length);
  expect(asset.address.url).toBe(`/${asset.fileName}`);
  expect(asset.fileName).toBe(`assets/grid-seams-${asset.address.sha256.slice(0, 8)}.json`);
  expect(gridSeamAsset(source)).toEqual(asset);
  expect(gridSeamAsset(source.replace('0.125', '0.250')).address.url).not.toBe(asset.address.url);
  expect(() => gridSeamAsset('{"plans":[]}')).toThrow('plans and edges');
});

test('split native plans reconstruct the entire certified source and retain its index fence', () => {
  const source = JSON.stringify({ plans: [['native', [[0, 0.125, 1], [0.1, 0.9]]]], edges: [] });
  const whole = gridSeamAsset(source), compact = gridSeamAsset(source, true), root = mkdtempSync(resolve('tmp/grid-plan-input-'));
  try {
    const plans = compact.plans; if (plans === undefined) throw new Error('Missing native plans');
    expect(compact.address.plans).toEqual(plans.address);
    expect(plans.fileName).toBe(`assets/grid-seam-plans-${plans.address.sha256.slice(0, 8)}.json`);
    const edgeData: unknown = JSON.parse(compact.source), planData: unknown = JSON.parse(plans.source);
    if (typeof edgeData !== 'object' || edgeData === null || !('plans' in edgeData)
      || typeof planData !== 'object' || planData === null || !('plans' in planData)) throw new Error('Invalid split fixture');
    expect(edgeData.plans).toEqual([]);
    expect(JSON.stringify({ ...edgeData, plans: planData.plans })).toBe(source);
    mkdirSync(resolve(root, 'out/.app'), { recursive: true });
    writeFileSync(resolve(root, GRID_SEAMS), source);
    const index = resolve(root, 'out/.app/grid-strip-index.json');
    writeFileSync(index, JSON.stringify({ seams: whole.address.sha256, files: [] }));
    expect(readGridSeams(root)).toEqual(compact);
    writeGridSeams(resolve(root, 'dist'), root);
    expect(readFileSync(resolve(root, 'dist', compact.fileName), 'utf8')).toBe(compact.source);
    expect(readFileSync(resolve(root, 'dist', plans.fileName), 'utf8')).toBe(plans.source);
    // The sealed page index still names the full original certification source,
    // never just the smaller edge document or an unchecked missing-input case.
    writeFileSync(index, JSON.stringify({ seams: compact.address.sha256, files: [] }));
    expect(() => readGridSeams(root)).toThrow('differs from its seam source');
    expect(gridSeamAsset('{"plans":[["native",[[-0]]]],"edges":[]}', true).plans).toBeUndefined();
    expect(gridSeamAsset('{"plans":[["native",[["bad"]]]],"edges":[]}', true).plans).toBeUndefined();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('compiler edge costs retain the original bounded JSON charge and source identity', () => {
  const row = { heights: Array.from({ length: 257 }, (_, index) => index / 257), colours: Array.from({ length: 257 }, () => [0.125, 0.25, 0.5]), roadHeight: 0 };
  const observation = { entryWidth: 8 };
  const edge = { kind: 'declared', profiles: { north: row, east: row, south: row, west: row }, observations: { north: observation, east: observation, south: observation, west: observation }, note: 'Å🌴' };
  const source = JSON.stringify({ plans: [['native', [[0, 1]]]], edges: [['native', edge]] }), asset = gridSeamAsset(source, true);
  expect(asset.address.edgeCosts).toEqual({ source: asset.address.sha256, rows: [['native', jsonDataHeapBytes(edge)]] });
  const oversized = JSON.stringify({ plans: [['native', [[0, 1]]]], edges: [['native', { ...edge, extra: Array.from({ length: 100000 }, () => 0) }]] });
  expect(gridSeamAsset(oversized, true).address.edgeCosts).toBeUndefined();
  const duplicate = JSON.stringify({ plans: [['native', [[0, 1]]]], edges: [['native', edge], ['native', edge]] });
  expect(gridSeamAsset(duplicate, true).address.edgeCosts).toBeUndefined();
});

test('the grid chunk guard refuses inline data, missing measurements and either exceeded ceiling', () => {
  const manifest = { 'index.html': { file: 'entry.js', isEntry: true } };
  const modules = { 'entry.js': { name: 'entry', moduleIds: [], rawBytes: 40, gzBytes: 30 },
    'grid.js': { name: 'grid', moduleIds: ['src/client/game/grid/session.ts'], rawBytes: 300000, gzBytes: 50000 } };
  const caps = { 'js/grid-session/raw': 450000, 'js/grid-session/gzip': 100000 };
  expect(checkChunks(manifest, modules, {}, caps).errors).toEqual([]);
  expect(checkChunks(manifest, { ...modules, 'grid.js': { ...modules['grid.js'], rawBytes: 3853495 } }, {}, caps).errors).toContainEqual(expect.stringContaining('grid session raw 3853495 exceeds'));
  expect(checkChunks(manifest, { ...modules, 'grid.js': { ...modules['grid.js'], gzBytes: 100001 } }, {}, caps).errors).toContainEqual(expect.stringContaining('grid session gzip 100001 exceeds'));
  expect(checkChunks(manifest, modules, {}).errors).toContain('missing grid session raw ceiling');
  expect(checkChunks(manifest, { ...modules, 'grid.js': { name: 'grid', moduleIds: modules['grid.js'].moduleIds, gzBytes: 50000 } }, {}, caps).errors).toContainEqual(expect.stringContaining('missing grid session raw bytes'));
});

test('the app build\'s chunk report refuses a grid chunk above the ratchet', async () => {
  const root = mkdtempSync(resolve('tmp/js-grid-budget-'));
  try {
    mkdirSync(resolve(root, 'src/client/game/grid'), { recursive: true }); mkdirSync(resolve(root, 'lint'));
    writeFileSync(resolve(root, 'src/client/game/grid/session.ts'), `globalThis.grid = ${JSON.stringify('exact data'.repeat(100))};`);
    const policy = resolve(root, 'lint/ratchet.json');
    writeFileSync(policy, JSON.stringify({ budgets: { 'js/grid-session/raw': 10, 'js/grid-session/gzip': 10 } }));
    const outDir = resolve(root, 'dist'), options: InlineConfig = { root, configFile: false, logLevel: 'silent',
      build: { outDir, minify: false, manifest: true, sourcemap: 'hidden', rolldownOptions: { input: resolve(root, 'src/client/game/grid/session.ts') } } };
    await build(options);
    expect(() => writeChunkReport(outDir, root)).toThrow('grid session raw');
    writeFileSync(policy, JSON.stringify({ budgets: { 'js/grid-session/raw': 2000, 'js/grid-session/gzip': 1000 } }));
    expect(Object.values(writeChunkReport(outDir, root)).map(row => row.moduleIds)).toEqual([['src/client/game/grid/session.ts']]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
