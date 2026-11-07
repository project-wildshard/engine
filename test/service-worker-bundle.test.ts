// oxlint-disable-next-line import/no-nodejs-modules -- The fixture bundle folder is written and removed under ./tmp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Paths for the owned fixture folders.
import { dirname, join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { writtenBundle } from '../scripts/app-build/writtenBundle';

mkdirSync('tmp', { recursive: true });
const root = mkdtempSync(resolve('tmp/sw-bundle-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const put = (file: string, text: string): void => { mkdirSync(dirname(join(root, file)), { recursive: true }); writeFileSync(join(root, file), text); };

test('the worker reads the bundle as the bundler wrote it, never public copies or later build files', () => {
  put('dist/.vite/manifest.json', JSON.stringify({
    'index.html': { file: 'assets/main-aaaaaaaa.js', isEntry: true, imports: ['_shared-bbbbbbbb.js'] },
    '_shared-bbbbbbbb.js': { file: 'assets/shared-bbbbbbbb.js' },
    'src/lazy.ts': { file: 'assets/lazy-cccccccc.js', isDynamicEntry: true, imports: ['_shared-bbbbbbbb.js'] },
  }));
  put('dist/assets/main-aaaaaaaa.js', 'import "./shared-bbbbbbbb.js";');
  put('dist/assets/main-aaaaaaaa.js.map', JSON.stringify({ version: 3, sources: ['../../src/client/app/main.ts'], mappings: '' }));
  put('dist/assets/shared-bbbbbbbb.js', 'export const shared = 1;');
  put('dist/assets/lazy-cccccccc.js', 'export const lazy = 2;');
  put('dist/assets/style-dddddddd.css', 'body{}');
  put('dist/index.html', '<!doctype html>');
  put('dist/version.json', '{"build":"b-1"}');
  const first = writtenBundle(join(root, 'dist'), root, join(root, 'public'));
  expect(Object.keys(first).sort()).toEqual(['.vite/manifest.json', 'assets/lazy-cccccccc.js', 'assets/main-aaaaaaaa.js',
    'assets/main-aaaaaaaa.js.map', 'assets/shared-bbbbbbbb.js', 'assets/style-dddddddd.css', 'index.html', 'version.json']);
  expect(first['assets/main-aaaaaaaa.js']).toMatchObject({ type: 'chunk', isEntry: true, facadeModuleId: join(root, 'index.html'),
    imports: ['assets/shared-bbbbbbbb.js'], modules: { [join(root, 'src/client/app/main.ts')]: true } });
  expect(first['assets/lazy-cccccccc.js']).toMatchObject({ type: 'chunk', isEntry: false, facadeModuleId: null, modules: {} });
  expect(first['assets/style-dddddddd.css']?.type).toBe('asset');

  // a public copy and build-app's own later files leave the emitted set (and so the build id) as it was
  put('public/fonts/a.woff2', 'font'); put('dist/fonts/a.woff2', 'font');
  put('dist/build-flags.json', '{"devserver":false}'); put('dist/shardfiles/p/shard.json', '{}');
  put('dist/.vite/chunk-modules.json', '{}');
  expect(Object.keys(writtenBundle(join(root, 'dist'), root, join(root, 'public'))).sort()).toEqual(Object.keys(first).sort());
});
