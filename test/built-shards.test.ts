// oxlint-disable-next-line import/no-nodejs-modules -- Owned fixture folders stand in for out/.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Join the fixture's product paths.
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { builtShards, pinsInstall } from '../src/scripts/built-shards.mjs';
import { shardFromDiscovery } from '../src/client/game/shard/discovery';

// QA 11-25 row 93: a product an older pins run left in out/ (Pine's discovery still naming `gridShardfile`, which format
// 0.80 refuses) stopped `pnpm pins` itself, which loads the products before it replaces them, so the clone never mended.
const product = (root: string, name: string, document: unknown): void => {
  const at = join(root, name, 'mounts/shardfiles', name);
  mkdirSync(at, { recursive: true }); writeFileSync(join(at, 'discovery.json'), JSON.stringify(document));
};

test('a pins install passes over a product from an older pin, and every other caller is told to run pnpm pins', () => {
  const root = mkdtempSync(join(process.cwd(), 'tmp/built-shards-'));
  try {
    product(root, 'pine-hollow', { manifest: { gridShardfile: '/shardfiles/pine-hollow/shard.json' } });
    product(root, 'glowfen', { order: 2 });
    product(root, 'mossgate', { order: 1 });
    const parse = (document: unknown): { order: number } => {
      if (typeof document !== 'object' || document === null || !('order' in document) || typeof document.order !== 'number') throw new Error('Invalid key: Expected never but received "gridShardfile"');
      return { order: document.order };
    };
    const warned: string[] = [];
    expect(builtShards(root, parse, { replacing: true, warn: line => { warned.push(line); } })).toEqual([{ order: 1 }, { order: 2 }]);
    expect(warned).toEqual(['pins: out/pine-hollow is from an older pin (Invalid key: Expected never but received "gridShardfile"); it is replaced below']);
    expect(() => builtShards(root, parse)).toThrow('out/pine-hollow holds a product this engine\'s format no longer reads (Invalid key: Expected never but received "gridShardfile"): run pnpm pins');
    expect(builtShards(join(root, 'none'), parse)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the real discovery reader refuses the old pointer, so the loader's pass-over is what lets pins mend it", () => {
  expect(() => shardFromDiscovery({ manifest: { slug: 'pine-hollow', gridShardfile: '/shardfiles/pine-hollow/shard.json' } })).toThrow();
});

test('only a pins install replaces the products', () => {
  expect(pinsInstall(['node', '/x/src/scripts/pins.ts', 'install'])).toBe(true);
  expect(pinsInstall(['node', 'src/scripts/pins.ts', 'install', '--ring', '1'])).toBe(true);
  expect(pinsInstall(['node', 'src/scripts/pins.ts'])).toBe(false);
  expect(pinsInstall(['node', 'src/scripts/pins.ts', 'status'])).toBe(false);
  expect(pinsInstall(['node', 'src/scripts/bake-chunk.mjs', 'install'])).toBe(false);
});
