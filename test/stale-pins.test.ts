// oxlint-disable-next-line import/no-nodejs-modules -- a format index's hash
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- a temporary tree with out/ and a pins file
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- the same
import { tmpdir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- the same
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { pruneStalePinProducts, stalePinFolders } from '../src/scripts/pins-reuse.mjs';

// gen:inputs stamps public/ (src/scripts/app-build/gen.ts), where the pins publish their products' mounts. A tree installed
// before a pin bump and rebased past it kept Far Reach revision 1's mounts, and every land from it put 21 rows back in the
// boot stamps (2026-11-14). stalePinFolders names such products, and gen:inputs refuses to stamp until `pnpm pins` runs.
let root = '';
afterEach(() => { if (root !== '') rmSync(root, { recursive: true, force: true }); root = ''; });
function tree(pins: readonly string[], products: Readonly<Record<string, { hash: string; uploadNumber: number; source?: Readonly<Record<string, string>> } | 'unreadable'>>): string {
  root = mkdtempSync(join(tmpdir(), 'stale-pins-'));
  mkdirSync(join(root, 'test/pins'), { recursive: true });
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({ shards: pins.map(hash => ({ slug: hash, hash })) }));
  for (const [folder, pin] of Object.entries(products)) {
    mkdirSync(join(root, 'out', folder), { recursive: true });
    writeFileSync(join(root, 'out', folder, 'validation.json'), pin === 'unreadable' ? '{' : JSON.stringify(pin.source === undefined ? { pin } : { pin: { hash: pin.hash, uploadNumber: pin.uploadNumber }, source: pin.source }));
  }
  return root;
}

test('a product whose receipt names a pin the pins file no longer names is stale; current ones are not', () => {
  expect(stalePinFolders(tree(['far3', 'pine5'], { 'far-reach': { hash: 'far1', uploadNumber: 1 }, 'pine-hollow': { hash: 'pine5', uploadNumber: 5 } })))
    .toEqual([{ folder: 'far-reach', uploadNumber: 1 }]);
});

test('no out/, no pins file, and a folder with no readable receipt are not stale', () => {
  expect(stalePinFolders(tree(['far3'], {}))).toEqual([]);
  expect(stalePinFolders(tree(['far3'], { scratch: 'unreadable' }))).toEqual([]);
  rmSync(join(root, 'test/pins/shardfiles.json'));
  expect(stalePinFolders(root)).toEqual([]);
});

test('a format-dependency product is current while its index is the installed format\'s', () => {
  const index = '{"identity":{"slug":"dependency-product","revision":1}}', indexHash = createHash('sha256').update(index).digest('hex');
  const source = { kind: 'format-dependency', path: '@wildshard/format/corpus/exports/brasscap-mesa', indexHash };
  tree(['brasscap9'], { 'dependency-product': { hash: 'format1', uploadNumber: 1, source },
    'brasscap-mesa': { hash: 'brasscap9', uploadNumber: 9 }, 'far-reach': { hash: 'far1', uploadNumber: 1, source: { kind: 'api' } } });
  const installed = join(root, 'node_modules/@wildshard/format/corpus/exports/brasscap-mesa');
  mkdirSync(installed, { recursive: true });
  writeFileSync(join(installed, 'shard.json'), index);
  expect(stalePinFolders(root)).toEqual([{ folder: 'far-reach', uploadNumber: 1 }]);
  writeFileSync(join(installed, 'shard.json'), index.replace('"revision":1', '"revision":2'));
  expect(stalePinFolders(root), 'the format dependency moved past it').toEqual([{ folder: 'dependency-product', uploadNumber: 1 }, { folder: 'far-reach', uploadNumber: 1 }]);
});

// opus-bugfix2, 2026-11-16 23:04 UTC: after the Brasscap rename a worktree's stale out/<old slug> survived `pnpm pins`, so
// land's gen:inputs stopped on it until a hand rm -rf. A full `pnpm pins` now removes exactly what gen:inputs would refuse.
test('pnpm pins removes the products gen:inputs calls stale, and only those, only under out/', () => {
  const index = '{"identity":{"slug":"dependency-product","revision":1}}', indexHash = createHash('sha256').update(index).digest('hex');
  const source = { kind: 'format-dependency', path: '@wildshard/format/corpus/exports/brasscap-mesa', indexHash };
  tree(['brasscap9', 'pine5'], { 'dependency-product': { hash: 'format1', uploadNumber: 1, source }, 'brasscap-mesa': { hash: 'brasscap9', uploadNumber: 9 },
    'far-reach': { hash: 'far1', uploadNumber: 1 }, 'pine-hollow': { hash: 'pine5', uploadNumber: 5 }, scratch: 'unreadable' });
  mkdirSync(join(root, 'out/build-cache'), { recursive: true });
  writeFileSync(join(root, 'out/notes.txt'), 'not a product');
  expect(pruneStalePinProducts(root)).toEqual([{ folder: 'dependency-product', uploadNumber: 1 }, { folder: 'far-reach', uploadNumber: 1 }]);
  expect(readdirSync(join(root, 'out')).sort()).toEqual(['brasscap-mesa', 'build-cache', 'notes.txt', 'pine-hollow', 'scratch']);
  expect(stalePinFolders(root), 'gen:inputs has nothing left to refuse').toEqual([]);
  expect(pruneStalePinProducts(root), 'a second run removes nothing').toEqual([]);
  expect(existsSync(join(root, 'test/pins/shardfiles.json'))).toBe(true);
});
