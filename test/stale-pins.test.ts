// oxlint-disable-next-line import/no-nodejs-modules -- a temporary tree with out/ and a pins file
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the same
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- the same
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { stalePinProducts } from '../scripts/pins-reuse.mjs';

// gen:inputs stamps public/ (scripts/app-build/gen.ts), where the pins publish their products' mounts. A tree installed
// before a pin bump and rebased past it kept Far Reach revision 1's mounts, and every land from it put 21 rows back in the
// boot stamps (2026-11-14). stalePinProducts names such products, and gen:inputs refuses to stamp until `pnpm pins` runs.
let root = '';
afterEach(() => { if (root !== '') rmSync(root, { recursive: true, force: true }); root = ''; });
function tree(pins: readonly string[], products: Readonly<Record<string, { hash: string; revision: number } | 'unreadable'>>): string {
  root = mkdtempSync(join(tmpdir(), 'stale-pins-'));
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ shards: pins.map(hash => ({ slug: hash, hash })) }));
  for (const [folder, pin] of Object.entries(products)) {
    mkdirSync(join(root, 'out', folder), { recursive: true });
    writeFileSync(join(root, 'out', folder, 'validation.json'), pin === 'unreadable' ? '{' : JSON.stringify({ pin }));
  }
  return root;
}

test('a product whose receipt names a pin the pins file no longer names is stale; current ones are not', () => {
  expect(stalePinProducts(tree(['far3', 'pine5'], { 'far-reach': { hash: 'far1', revision: 1 }, 'pine-hollow': { hash: 'pine5', revision: 5 } })))
    .toEqual([{ folder: 'far-reach', revision: 1 }]);
});

test('no out/, no pins file, and a folder with no readable receipt are not stale', () => {
  expect(stalePinProducts(tree(['far3'], {}))).toEqual([]);
  expect(stalePinProducts(tree(['far3'], { scratch: 'unreadable' }))).toEqual([]);
  rmSync(join(root, 'test/pins/shardfiles.json'));
  expect(stalePinProducts(root)).toEqual([]);
});
