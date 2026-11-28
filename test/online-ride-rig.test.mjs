import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { RIDE_RIG, packOrigin, typedName } from '../src/scripts/online-rig.mjs';
import { hostsGrid } from '../src/client/game/shardfile/serverRoute';

// Meta QA 11-26 row 83: online-ride-proof's pages never reached the camp horses. Three causes, each held here.
const ROOT = resolve(import.meta.dirname, '..');

test('a rig world reads its packs from an absolute file URL, whatever folder it was given', () => {
  // `file://tmp/x/origin/` names the host `tmp`: the world crashed at boot, and the pages played alone at x 0, z 0, cell 0
  const relative = new URL(packOrigin('tmp/x/origin'));
  expect(relative.protocol).toBe('file:');
  expect(relative.host).toBe('');
  expect(relative.href).toBe(`file://${resolve('tmp/x/origin')}/`);
  expect(packOrigin('/a b/origin')).toBe('file:///a%20b/origin/');
});

test('the ride rig hosts the grid, so every page that hears its word boots Nalati\'s grid cell, and is up before a page opens', () => {
  const rig = RIDE_RIG({ dist: 'd', work: '/w', keyFile: 'k', pgBin: 'pglite:', pgData: '' });
  expect(rig).toMatchObject({ shard: 'nalati-grasslands', cells: 'grid', isolated: true, work: join('/w', 'rig') });
  // the world word's `cells` is the cells it opens: one cell sends a page to the one-shard flow, two or more to the grid
  const opened = 1 + (rig.more?.length ?? 0);
  expect(opened).toBeGreaterThan(1);
  expect(hostsGrid({ cells: opened })).toBe(true);
  expect(hostsGrid({ cells: 1 }), 'the old one-cell rig: the second page took the one-shard flow').toBe(false);
});

test('a rider is found by the Name its player typed, not the tagged Name everyone reads', () => {
  expect(typedName('Matt#9741')).toBe('Matt');
  expect(typedName('Matt')).toBe('Matt');
  expect(typedName('A#B#1234')).toBe('A#B');
  const proof = readFileSync(join(ROOT, 'src/scripts/online-ride-proof.mjs'), 'utf8');
  expect(proof).toContain('openRig(RIDE_RIG(');
  expect(proof).not.toMatch(/row\.name === '/u);
});
