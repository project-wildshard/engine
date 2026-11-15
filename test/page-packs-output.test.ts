// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Real output folders reproduce the split-release failure.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The fixture stays under the repo tmp folder.
import {dirname, join, resolve} from 'node:path';
import {expect, test} from 'vitest';
import {serverPackOutputRoot} from '../scripts/page-release/packs.mjs';

test('server publication reads the split content folder and keeps joined releases working', () => {
  const parent = resolve('tmp/page-packs-output-test'); mkdirSync(parent, {recursive: true});
  const root = mkdtempSync(join(parent, 'release-')), book = 'assets/spawn/server-build.json';
  const write = (folder: string): void => { const file = join(root, folder, book); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, '{}'); };
  try {
    expect(() => serverPackOutputRoot(root, book)).toThrow('missing');
    write('dist-content');
    expect(serverPackOutputRoot(root, book)).toBe(join(root, 'dist-content'));
    write('dist');
    expect(serverPackOutputRoot(root, book)).toBe(join(root, 'dist'));
  } finally { rmSync(root, {recursive: true, force: true}); }
});
