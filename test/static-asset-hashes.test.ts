// oxlint-disable-next-line import/no-nodejs-modules -- Isolate build-owned static manifests under repository scratch.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only the explicit fixture files.
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { staticAssetHashes } from '../scripts/app-build/assetHashes';

test('static keys include fonts, codecs and icons and change only for changed bytes', () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/static-keys-'));
  const put = (name: string, bytes: string): void => { const file = resolve(root, 'public', name); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
  try {
    for (const name of ['assets/title/hero.jpg', 'basis/transcoder.wasm', 'fonts/ui.woff2', 'icon-192.png']) put(name, name);
    const before = staticAssetHashes(root);
    expect(Object.keys(before).sort()).toEqual(['/assets/title/hero.jpg', '/basis/transcoder.wasm', '/fonts/ui.woff2', '/icon-192.png']);
    expect(Object.values(before).every(hash => /^[a-f0-9]{8}$/u.test(hash))).toBe(true);
    put('assets/title/hero.jpg', 'changed bytes');
    const after = staticAssetHashes(root);
    expect(after['/assets/title/hero.jpg']).not.toBe(before['/assets/title/hero.jpg']);
    for (const path of ['/basis/transcoder.wasm', '/fonts/ui.woff2', '/icon-192.png']) expect(after[path]).toBe(before[path]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
