import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the real filesystem-backed discovery inventory.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the isolated discovery fixture under repository scratch.
import { join, resolve } from 'node:path';
import { frameFloorShards } from '../scripts/frame-floor-inventory.mjs';

const root = resolve(import.meta.dirname, '..');

test('covers the 28 shipped discoveries and grid', () => {
  const rows = frameFloorShards(root);
  expect(rows).toHaveLength(29);
  expect(new Set(rows).size).toBe(rows.length);
  expect(rows.filter(slug => slug.startsWith('open-plot-'))).toHaveLength(18);
  expect(rows).toEqual(expect.arrayContaining(['_template', 'blender-template', 'driftwood-isle', 'far-reach',
    'ink-cel-valley', 'nalati-grasslands', 'nine-dragon-stack', 'pastel-plain', 'pine-hollow', 'sunscar-dunes', 'grid', 'open-plot-fossil-badlands', 'open-plot-jungle-ziggurat',
    'open-plot-patchwork-fairground', 'open-plot-saltwind-lighthouse']));
  expect(rows.some(slug => slug.endsWith('-legacy'))).toBe(false);
});

test('follows declared multi-product outputs and refuses duplicates before measurement', () => {
  mkdirSync(join(root, 'tmp'), { recursive: true });
  const fixture = mkdtempSync(join(root, 'tmp/floor-inventory-'));
  const write = (name: string, value: object): void => {
    const file = join(fixture, name);
    mkdirSync(resolve(file, '..'), { recursive: true });
    writeFileSync(file, JSON.stringify(value));
  };
  try {
    write('src/shards/first/manifest.json', {});
    write('src/shards/many/manifest.json', {});
    write('src/shards/many/outputs.json', { outputs: [{ slug: 'plot-a' }, { slug: 'plot-b' }] });
    expect(frameFloorShards(fixture)).toEqual(['first', 'plot-a', 'plot-b', 'grid']);
    write('src/shards/many/outputs.json', { outputs: [{ slug: 'plot-a' }, { slug: 'plot-a' }] });
    expect(() => frameFloorShards(fixture)).toThrow('duplicate output slug');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
