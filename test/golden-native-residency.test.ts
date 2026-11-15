import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The reader scans a real dist folder on disk.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Temp dist under the checkout's tmp folder.
import { join } from 'node:path';
import { buildCodeChunks } from '../scripts/goldens/native-residency.mjs';

test('the Nine reader scans the build folder and the shared chunks its import map names', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(join('tmp', 'native-residency-'));
  try {
    mkdirSync(join(root, 'b/abc-1'), { recursive: true });
    mkdirSync(join(root, 'b/c'), { recursive: true });
    writeFileSync(join(root, 'b/abc-1/main-x.js'), '');
    writeFileSync(join(root, 'b/c/control-y.js'), '');
    writeFileSync(join(root, 'b/c/other-build-z.js'), '');
    writeFileSync(join(root, 'importmap.json'), JSON.stringify({ imports: { '/b/c/control-k.js': '/b/c/control-y.js', '/b/c/s.css': '/b/c/s-q.css' } }));
    // another build's chunk in the shared folder is never a candidate
    expect(buildCodeChunks(root, 'abc-1')).toEqual(['/b/abc-1/main-x.js', '/b/c/control-y.js']);
    mkdirSync(join(root, 'assets'));
    writeFileSync(join(root, 'assets/old-a.js'), '');
    expect(buildCodeChunks(root, 'missing')).toEqual(['/assets/old-a.js']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
