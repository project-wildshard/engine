// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary output under ./tmp.
import {mkdirSync, mkdtempSync, openSync, closeSync, ftruncateSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the fixture's output.
import {join, resolve} from 'node:path';
import {expect, test} from 'vitest';
import {MAX_ASSET_BYTES, assertAssetLimits, describeAssetLimits} from '../scripts/app-build/assetLimits.mjs';

const sized = (path: string, bytes: number): void => { const fd = openSync(path, 'w'); try { ftruncateSync(fd, bytes); } finally { closeSync(fd); } };

test('dist/ refuses what a Workers upload would: a file over 25 MiB; source maps never count (OFF-VERCEL OV3)', () => {
  mkdirSync('tmp', {recursive: true}); const root = mkdtempSync(resolve('tmp/asset-limits-'));
  try {
    mkdirSync(join(root, 'b/c'), {recursive: true});
    writeFileSync(join(root, 'index.html'), '<!doctype html>');
    sized(join(root, 'b/c/main.js'), 1024);
    sized(join(root, 'b/c/main.js.map'), MAX_ASSET_BYTES + 1);
    const measured = assertAssetLimits(root);
    expect(measured).toMatchObject({files: 2, maps: 1, largest: {path: 'b/c/main.js', bytes: 1024}});
    expect(describeAssetLimits(measured)).toBe('2 files (limit 90000), largest b/c/main.js at 0.0 MiB (limit 25.0 MiB), 1 source maps left out');
    sized(join(root, 'b/c/huge.pack.br'), MAX_ASSET_BYTES + 1);
    expect(() => assertAssetLimits(root)).toThrow('b/c/huge.pack.br is 25.0 MiB, over 25.0 MiB');
    sized(join(root, 'b/c/huge.pack.br'), MAX_ASSET_BYTES);
    expect(assertAssetLimits(root).files).toBe(3);
  } finally { rmSync(root, {recursive: true, force: true}); }
});
