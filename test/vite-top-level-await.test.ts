// oxlint-disable-next-line import/no-nodejs-modules -- the post-step reads a real build's files from disk.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- fixture paths under tmp/.
import { join, resolve } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { build } from 'vite';
import { assertNoTopLevelAwait, checkNoTopLevelAwait } from '../scripts/app-build/noTopLevelAwait.mjs';

test.each([
  'await ready;',
  'await using resource = acquire();',
  'export const value = await ready;',
  'if (enabled) { await ready; }',
  'for await (const value of source) { consume(value); }',
  'class Model extends (await base()) {}',
  'const object = { [await key()]: function () {} };',
  'class Model { [await key()]() {} }',
])('rejects module evaluation suspension: %s', code => {
  expect(() => assertNoTopLevelAwait('assets/lazy.js', code)).toThrow('Top-level await in emitted app chunk assets/lazy.js');
});

test.each([
  'export async function ready() { await work(); }',
  'export async function ready() { await using resource = acquire(); }',
  'const ready = async () => { await work(); }; export { ready };',
  'void (async function () { await work(); })();',
  'class Model { async ready() { await work(); } }',
  'const model = { async ready() { for await (const value of source) consume(value); } };',
  '// await work();\nconst text = "await work()"; const pattern = /await/;',
])('allows function-local await and inert text: %s', code => {
  expect(() => assertNoTopLevelAwait('assets/lazy.js', code)).not.toThrow();
});

test('unparseable emitted JavaScript refuses instead of passing unchecked', () => {
  expect(() => assertNoTopLevelAwait('assets/broken.js', 'export const = ;')).toThrow('Cannot check emitted app JavaScript assets/broken.js');
});

mkdirSync('tmp', { recursive: true });
const scratch = mkdtempSync(resolve('tmp/top-level-await-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));
let builds = 0;

/** a real build written to disk, then the app build's post-step over what it wrote (scripts/build-app.mjs) */
async function compile(entry: string, lazy: string, extra: Readonly<Record<string, string>> = {}, publicFiles: Readonly<Record<string, string>> = {}) {
  const modules: Readonly<Record<string, string>> = { 'virtual:entry': entry, 'virtual:lazy': lazy };
  const outDir = join(scratch, `out-${++builds}`), publicDir = join(scratch, `public-${builds}`);
  await build({ configFile: false, logLevel: 'silent', publicDir: false,
    plugins: [{ name: 'virtual-await-fixture', resolveId(id) { return Object.hasOwn(modules, id) ? id : null; }, load(id) { return modules[id]; } }],
    build: { target: 'esnext', minify: true, outDir, emptyOutDir: true,
      rolldownOptions: { input: 'virtual:entry', output: { entryFileNames: 'entry.js', chunkFileNames: 'lazy-[hash].js' } } } });
  for (const [name, code] of Object.entries({ ...extra, ...publicFiles })) {
    mkdirSync(join(outDir, name, '..'), { recursive: true });
    writeFileSync(join(outDir, name), code);
  }
  for (const name of Object.keys(publicFiles)) {
    mkdirSync(join(publicDir, name, '..'), { recursive: true });
    writeFileSync(join(publicDir, name), '');
  }
  checkNoTopLevelAwait(outDir, publicDir);
}

test.each(['entry', 'lazy'])('the build refuses top-level await in the emitted %s chunk', async location => {
  const entry = location === 'entry' ? 'export const value = await Promise.resolve(1);' : 'globalThis.load = () => import("virtual:lazy");';
  await expect(compile(entry, 'export const value = await Promise.resolve(1);')).rejects.toThrow(/Top-level await in emitted app chunk (?:entry|lazy-[\w-]+)\.js/u);
});

test('the build checks written worker assets as well as transformed chunks', async () => {
  await expect(compile('export const value = 1;', '', { 'assets/worker.js': 'await initialize();' })).rejects.toThrow(`Top-level await in emitted app chunk ${join('assets', 'worker.js')}`);
});

test('copies of public files are not the bundle and are not parsed', async () => {
  await expect(compile('export const value = 1;', '', {}, { 'basis/r1/transcoder.js': 'with (scope) { await; }' })).resolves.toBeUndefined();
});

test('ordinary emitted dynamic imports and async readiness remain buildable', async () => {
  await expect(compile('globalThis.load = () => import("virtual:lazy");',
    'export async function ready() { return await Promise.resolve(1); }')).resolves.toBeUndefined();
});
