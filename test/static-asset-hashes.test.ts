// oxlint-disable-next-line import/no-nodejs-modules -- Isolate build-owned static manifests under repository scratch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the explicit fixture files.
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { staticAssetHashes } from '../scripts/app-build/assetHashes';
import { changedContentNamed } from '../scripts/app-build/gen';

test('static keys include fonts, codecs and icons and change only for changed bytes', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/static-keys-'));
  const put = (name: string, bytes: string): void => { const file = resolve(root, 'public', name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
  try {
    for (const name of ['assets/title/hero.jpg', 'basis/transcoder.wasm', 'fonts/ui.woff2', 'icons/preview/icon-192.png']) put(name, name);
    const before = staticAssetHashes(root);
    expect(Object.keys(before).sort()).toEqual(['/assets/title/hero.jpg', '/basis/transcoder.wasm', '/fonts/ui.woff2', '/icons/preview/icon-192.png']);
    expect(Object.values(before).every(hash => /^[a-f0-9]{8}$/u.test(hash))).toBe(true);
    put('assets/title/hero.jpg', 'changed bytes');
    const after = staticAssetHashes(root);
    expect(after['/assets/title/hero.jpg']).not.toBe(before['/assets/title/hero.jpg']);
    for (const path of ['/basis/transcoder.wasm', '/fonts/ui.woff2', '/icons/preview/icon-192.png']) expect(after[path]).toBe(before[path]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// AUDIO AU21: Driftwood's island-calm was re-encoded under its hashed name (710,677 to 476,617 bytes); players keep the
// old copy for a year. The byte table refuses a content-named path whose size moves; a renamed file is a new row.
test('a content-named path may not change size under one URL; other paths may', () => {
  const previous = ['export const PUBLIC_BYTES = {', '  "/assets/music/piano/island-calm-05125ed8.m4a": 710677,', '  "/assets/sfx/x/forest-2.m4a": 10,',
    '  "/assets/gpu/x/rock-0123abcd.glb": 5,', '  "/assets/music/piano/title-3d1f713a.m4a": 99,', '} as const;'].join('\n');
  expect(changedContentNamed(previous, { '/assets/music/piano/island-calm-05125ed8.m4a': 476_617, '/assets/sfx/x/forest-2.m4a': 11,
    '/assets/gpu/x/rock-0123abcd.glb': 6, '/assets/music/piano/title-3d1f713a.m4a': 99 }))
    .toEqual(['/assets/music/piano/island-calm-05125ed8.m4a (710677 to 476617 bytes)', '/assets/gpu/x/rock-0123abcd.glb (5 to 6 bytes)']);
  // The fix: the re-encode is a new name, and the old row is simply gone.
  expect(changedContentNamed(previous, { '/assets/music/piano/island-calm-3d097258.m4a': 476_617, '/assets/music/piano/title-3d1f713a.m4a': 99 })).toEqual([]);
});
