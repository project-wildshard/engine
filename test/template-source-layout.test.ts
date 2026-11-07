// oxlint-disable-next-line import/no-nodejs-modules -- Own bounded author fixtures under the repository scratch root.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve source and owned fixture paths.
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { mapSettingsPath, mapStampPath, mapSettings } from '../scripts/map-hash.mjs';
import { shardfileBoundaryViolations } from '../lint/shardfile-boundaries.mjs';
import { simClosure, simRoot } from '../lint/sim-closure.mjs';
import { checkShards } from '../scripts/check-shards.mjs';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';

const root = resolve('.');
test('Template author modules and temporary discovery have zero P0 and sim violations', () => {
  const entries: string[] = [];
  const visit = (folder: string): void => {
    for (const item of readdirSync(resolve(root, folder), { withFileTypes: true })) {
      const path = `${folder}/${item.name}`;
      if (item.isDirectory()) visit(path);
      else if (path.endsWith('.ts')) entries.push(path);
    }
  };
  visit('src/shards/_template/data'); visit('src/shards/_template/generators');
  visit('src/shards/_template/behaviour'); entries.push('src/shards/_template/shard.config.ts');
  for (const file of entries) expect(shardfileBoundaryViolations(root, file, readFileSync(file, 'utf8'))).toEqual([]);
  expect(simClosure(root, entries.filter(simRoot))).toEqual([]);
  const discovery = authoredManifestSource(root, '_template');
  expect(shardfileBoundaryViolations(root, 'src/shards/_template/discovery.generated.ts', discovery)).toEqual([]);
  expect(discovery).toContain('budgets: {');
  expect(discovery).not.toContain("from \"./data/budgets\"");
  expect(checkShards(root, new Set(['_template']))).toEqual([]);
  const template = resolve(root, 'src/shards/_template');
  expect(mapSettingsPath(template)).toBe(resolve(template, 'data/map.json'));
  expect(mapStampPath(template)).toBe(resolve(template, 'data/productMap.json'));
  expect(mapSettings(template).style?.kind).toBe('ground');
  const farReach = resolve(root, 'src/shards/far-reach');
  expect(mapSettingsPath(farReach)).toBe(resolve(farReach, 'data/map.json'));
  expect(mapStampPath(farReach)).toBe(resolve(farReach, 'data/productMap.json'));
});

test('legacy map layout remains the fallback until a source map exists', () => {
  const fixture = mkdtempSync(resolve(root, 'tmp/map-layout-'));
  try {
    mkdirSync(resolve(fixture, 'look'));
    writeFileSync(resolve(fixture, 'look/map.json'), JSON.stringify({ why: 'Legacy fixture', inputs: ['world'] }));
    expect(mapSettingsPath(fixture)).toBe(resolve(fixture, 'look/map.json'));
    expect(mapStampPath(fixture)).toBe(resolve(fixture, 'look/map.baked.json'));
    expect(mapSettings(fixture).inputs).toEqual(['world']);
    mkdirSync(resolve(fixture, 'data'));
    writeFileSync(resolve(fixture, 'data/map.json'), JSON.stringify({ why: 'Source fixture', inputs: ['source'] }));
    expect(mapSettingsPath(fixture)).toBe(resolve(fixture, 'data/map.json'));
    expect(mapStampPath(fixture)).toBe(resolve(fixture, 'data/productMap.json'));
    expect(mapSettings(fixture).inputs).toEqual(['source']);
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
