// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the public report against owned copies of a sealed pin.
import { cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve files within the owned product copy.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- The report must work in plain Node, outside Vite.
import { execFileSync } from 'node:child_process';
import { afterEach,expect,test } from 'vitest';
import { readNightMarketKitBudget } from '../scripts/night-market-kit-budget.mjs';
import { builtProduct } from './fixtures/engine-lift/product';

const owned: string[] = [];
afterEach(() => { for (const folder of owned.splice(0)) rmSync(folder, { recursive: true }); });
function fixture(): string {
  mkdirSync('tmp', { recursive: true });
  const folder = resolve(mkdtempSync('tmp/night-market-budget-')); owned.push(folder);
  cpSync(builtProduct('open-plot-night-market'), folder, { recursive: true });
  return folder;
}

test('the Node report reads all 80 sealed tiles and deduplicates their actual payloads', () => {
  const folder = builtProduct('open-plot-night-market'), report = readNightMarketKitBudget(folder);
  expect(report.rows).toHaveLength(80);
  expect(report.rows.filter(row => row.lod === 0)).toHaveLength(64);
  expect(report.rows.filter(row => row.lod === 1)).toHaveLength(16);
  expect(report.uniqueTileFiles).toBeGreaterThan(0);
  expect(report.uniqueTileClosure.compressed).toBeGreaterThan(0);
  expect(report.uniqueTileClosure.compressed).toBeLessThanOrEqual(report.rows.reduce((sum, row) => sum + row.compressed, 0));
  expect(report.rm8Targets.reportOnly).toBe(true);
  expect(report.basis).toContain('not live memory');
  const module = new URL('../scripts/night-market-kit-budget.mjs', import.meta.url).href;
  const program = `import {readNightMarketKitBudget} from ${JSON.stringify(module)}; console.log(readNightMarketKitBudget(${JSON.stringify(folder)}).rows.length);`;
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', program], { encoding: 'utf8' }).trim()).toBe('80');
});

test('a damaged tile declaration or validation receipt refuses instead of reporting zeros', () => {
  const folder = fixture(), path = resolve(folder, 'shard.json');
  const index = JSON.parse(readFileSync(path, 'utf8')) as { sections: { name: string; path: string }[] };
  const tiles = index.sections.find(row => row.name === 'world/tiles');
  if (tiles === undefined) throw new Error('Missing sealed tile section');
  writeFileSync(resolve(folder, tiles.path), `${readFileSync(resolve(folder, tiles.path), 'utf8')} `);
  expect(() => readNightMarketKitBudget(folder)).toThrow('tile section differs');
  const other = fixture();
  writeFileSync(resolve(other, 'validation.json'), JSON.stringify({ indexHash: '0'.repeat(64) }));
  expect(() => readNightMarketKitBudget(other)).toThrow('identity or index receipt');
});

test('a changed tile payload refuses even while its section and envelope remain intact', () => {
  const folder = fixture();
  const index = JSON.parse(readFileSync(resolve(folder, 'shard.json'), 'utf8')) as { sections: { name: string; path: string }[]; files: { hash: string; path: string }[] };
  const section = index.sections.find(row => row.name === 'world/tiles');
  if (section === undefined) throw new Error('Missing tile section');
  const tiles = JSON.parse(readFileSync(resolve(folder, section.path), 'utf8')) as { tiles: { files: string[] }[] };
  const hash = tiles.tiles[0]?.files[0], file = index.files.find(row => row.hash === hash);
  if (file === undefined) throw new Error('Missing tile payload');
  const path = resolve(folder, file.path), bytes = readFileSync(path);
  bytes[0] = (bytes[0] ?? 0) ^ 1; writeFileSync(path, bytes);
  expect(() => readNightMarketKitBudget(folder)).toThrow('tile payload differs');
});
