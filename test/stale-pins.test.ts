// oxlint-disable-next-line import/no-nodejs-modules -- a format index's hash
import { createHash } from 'node:crypto';
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
function tree(pins: readonly string[], products: Readonly<Record<string, { hash: string; revision: number; source?: Readonly<Record<string, string>> } | 'unreadable'>>): string {
  root = mkdtempSync(join(tmpdir(), 'stale-pins-'));
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ shards: pins.map(hash => ({ slug: hash, hash })) }));
  for (const [folder, pin] of Object.entries(products)) {
    mkdirSync(join(root, 'out', folder), { recursive: true });
    writeFileSync(join(root, 'out', folder, 'validation.json'), pin === 'unreadable' ? '{' : JSON.stringify(pin.source === undefined ? { pin } : { pin: { hash: pin.hash, revision: pin.revision }, source: pin.source }));
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

test('a format-dependency product (Ring 1\'s blender-template, the format\'s Template 2) is current while its index is the installed format\'s', () => {
  const index = '{"identity":{"slug":"blender-template","revision":1}}', indexHash = createHash('sha256').update(index).digest('hex');
  const source = { kind: 'format-dependency', path: '@wildshard/format/corpus/handwritten', indexHash };
  tree(['brasscap9'], { 'blender-template': { hash: 'format1', revision: 1, source },
    'brasscap-mesa': { hash: 'brasscap9', revision: 9 }, 'far-reach': { hash: 'far1', revision: 1, source: { kind: 'api' } } });
  const installed = join(root, 'node_modules/@wildshard/format/corpus/handwritten');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'shard.json'), index);
  expect(stalePinProducts(root)).toEqual([{ folder: 'far-reach', revision: 1 }]);
  writeFileSync(join(installed, 'shard.json'), index.replace('"revision":1', '"revision":2'));
  expect(stalePinProducts(root), 'the format dependency moved past it').toEqual([{ folder: 'blender-template', revision: 1 }, { folder: 'far-reach', revision: 1 }]);
});
