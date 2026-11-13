// HOW-WE-BUILD ENG-16 (SHARD-AUTHORING SA15): the devserver client release asset keeps what an author's page reads.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { pruneDevserverClient } from '../scripts/devserver-client.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function client(flags: unknown, files: readonly string[]): string {
  mkdirSync(resolve('tmp'), { recursive: true });
  const root = mkdtempSync(resolve('tmp', 'devserver-client-')); roots.push(root);
  writeFileSync(join(root, 'build-flags.json'), JSON.stringify(flags));
  for (const file of files) { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), file); }
  return root;
}

test('the client keeps the engine page and drops first-party shard content', () => {
  const kept = ['index.html', 'sw.js', 'b/c/entry.js', 'fonts/a.woff2', 'assets/physics/rapier.wasm', 'assets/music/theme.ogg', 'assets/baked/common/x.bin', 'assets/tex/rock/a.webp', 'assets/gpu/tex/a-12345678.ktx2', 'assets/gpu/models/b-12345678.ktx2',
    'assets/spawn/server-abc.json', 'assets/boot-tables-1.json', 'shardfiles/driftwood-isle/discovery.json'];
  const dropped = ['b/c/entry.js.map', 'programs/driftwood-isle.json', 'drafts/a.webp', 'trailer-30.mp4', 'assets/gpu/nalati/a-12345678.ktx2', 'assets/gpu/baked/driftwood-isle/a.ktx2',
    'assets/nalati/a.glb', 'assets/baked/driftwood-isle/x.bin', 'assets/spawn/driftwood-isle-client-phone-1.json', 'assets/spawn/parts/1.pack.br',
    'shardfiles/driftwood-isle/shard.json', 'shardfiles/driftwood-isle/blobs/image/a.jpg'];
  const root = client({ devserver: true }, [...kept, ...dropped]);
  pruneDevserverClient(root);
  for (const file of kept) expect(existsSync(join(root, file)), file).toBe(true);
  for (const file of dropped) expect(existsSync(join(root, file)), file).toBe(false);
});

test('a build not in devserver mode is refused untouched', () => {
  const root = client({ devserver: false }, ['programs/a.json']);
  expect(() => { pruneDevserverClient(root); }).toThrow(/devserver mode/u);
  expect(existsSync(join(root, 'programs/a.json'))).toBe(true);
});

test('SA43: the preparation client is a preparation-only production build, pruned the same way', () => {
  const root = client({ devserver: false }, ['index.html', 'programs/driftwood-isle.json', 'shardfiles/driftwood-isle/shard.json', 'shardfiles/driftwood-isle/discovery.json']);
  writeFileSync(join(root, 'version.json'), JSON.stringify({ preparationOnly: true }));
  pruneDevserverClient(root, 'preparation');
  expect(existsSync(join(root, 'index.html'))).toBe(true);
  expect(existsSync(join(root, 'shardfiles/driftwood-isle/discovery.json'))).toBe(true);
  expect(existsSync(join(root, 'programs/driftwood-isle.json'))).toBe(false);
  expect(existsSync(join(root, 'shardfiles/driftwood-isle/shard.json'))).toBe(false);
  const released = client({ devserver: false }, ['programs/a.json']);
  writeFileSync(join(released, 'version.json'), JSON.stringify({ preparationOnly: false }));
  expect(() => { pruneDevserverClient(released, 'preparation'); }).toThrow(/preparation-only/u);
  expect(() => { pruneDevserverClient(client({ devserver: true }, []), 'preparation'); }).toThrow(/preparation-only/u);
});
