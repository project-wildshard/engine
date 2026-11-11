// oxlint-disable-next-line import/no-nodejs-modules -- The fixture owns only its temporary sources and build outputs.
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths under ./tmp.
import { dirname, join, relative, resolve } from 'node:path';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { checkImportMaps, chunkRequests, documentImportMap } from '../scripts/app-build/importMap.mjs';

/** The written code files, by URL path. */
const code = (outDir: string): Set<string> => new Set(readdirSync(outDir, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.js')).map(entry => `/${relative(outDir, join(entry.parentPath, entry.name))}`));

test('J217 (LD6b): a one-line change in a leaf module renames only its own chunk, and every request resolves', async () => {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/chunk-import-map-'));
  const put = (file: string, text: string): void => { const target = resolve(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  // leaf <- mid <- top <- entry: before the map, the leaf's new hash renamed every chunk above it
  put('index.html', '<!doctype html><html><head></head><body><script type="module" src="/src/entry.ts"></script></body></html>');
  put('src/entry.ts', 'void import("./top").then(module => { document.title = module.top(); });');
  put('src/top.ts', 'import { mid } from "./mid"; export const top = (): string => `${mid()} top`; void import("./late").then(module => module.late());');
  put('src/mid.ts', 'import { leaf } from "./leaf"; export const mid = (): string => `${leaf} mid`;');
  put('src/late.ts', 'import { leaf } from "./leaf"; export const late = (): string => leaf.toUpperCase();');
  const outputs: Set<string>[] = [];
  try {
    for (const word of ['leaf', 'leaf, changed']) {
      put('src/leaf.ts', `export const leaf = ${JSON.stringify(word)};`);
      const outDir = resolve(root, `dist-${outputs.length}`);
      await build({ root, configFile: false, logLevel: 'silent', build: { outDir, minify: false, manifest: true, chunkImportMap: true,
        rolldownOptions: { output: { chunkFileNames: 'b/c/[name]-[hash].js', entryFileNames: 'b/c/[name]-[hash].js',
          codeSplitting: { groups: [{ name: id => /\/src\/(leaf|mid)\.ts$/u.exec(id)?.[1] ?? null }] } } } } });
      expect(checkImportMaps(outDir)).toMatchObject({ documents: 1 });
      outputs.push(code(outDir));
    }
    const [before, after] = outputs as [Set<string>, Set<string>];
    const renamed = [...after].filter(file => !before.has(file));
    // Only the leaf's chunk: its importers name it by a stable key, so the entry, top, mid and late keep their URLs
    expect(renamed.map(file => /\/([a-z]+)-[\w-]+\.js$/u.exec(file)?.[1])).toEqual(['leaf']);
    expect(before.size).toBe(after.size);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the import map comes once and first, and names only written files', () => {
  const page = (head: string): string => `<!doctype html><html><head>${head}<script type="module" src="/b/1/main.js"></script></head></html>`;
  expect(documentImportMap('index.html', page('<script type="importmap">{"imports":{"/b/c/a-key.js":"/b/c/a-real.js"}}</script>')))
    .toEqual({ '/b/c/a-key.js': '/b/c/a-real.js' });
  expect(documentImportMap('plain.html', '<html><head><script>1</script></head></html>')).toBeNull();
  expect(() => documentImportMap('index.html', page(''))).toThrow('0 import maps');
  expect(() => documentImportMap('index.html', `${page('')}<script type="importmap">{"imports":{}}</script>`)).toThrow('must come before');
  expect(() => documentImportMap('index.html', page('<link rel="modulepreload" href="/b/c/x.js"><script type="importmap">{"imports":{}}</script>'))).toThrow('must come before');
  expect(() => documentImportMap('index.html', page('<script type="importmap">{"imports":{},"scopes":{}}</script>'))).toThrow('only an imports table');
  expect(chunkRequests('b/c/a.js', 'import{x}from"./b-key.js";export{y}from"/b/c/c-key.js";import("../d.js");import(v);const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["b/c/e-key.js","b/c/f.css"])))=>i;'))
    .toEqual(['./b-key.js', '/b/c/c-key.js', '../d.js', '/b/c/e-key.js']);
  expect(chunkRequests('b/c/a.js', 'import("./a$b.js");import(\'./c\\u0064.js\');import(`./e.js`);import(`./${f}.js`);')).toEqual(['./a$b.js', './cd.js', './e.js']);

  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/chunk-import-map-check-'));
  const put = (file: string, text: string): void => { const target = join(root, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, text); };
  try {
    put('.vite/manifest.json', JSON.stringify({ 'index.html': { file: 'b/1/main.js', isEntry: true }, '_a': { file: 'b/c/a-real.js' } }));
    put('b/1/main.js', 'import "../c/a-key.js";');
    put('b/c/a-real.js', 'import "./worker.js";');
    put('b/c/worker.js', '');
    put('index.html', page('<script type="importmap">{"imports":{"/b/c/a-key.js":"/b/c/a-real.js"}}</script>'));
    expect(checkImportMaps(root)).toEqual({ documents: 1, rows: 1, chunks: 3, mapped: 1 });
    put('b/c/a-real.js', 'import "./gone.js";');
    expect(() => checkImportMaps(root)).toThrow('neither a written file nor in the import map');
    put('b/c/a-real.js', '');
    // a worker bundle has no map: a key it requests resolves nowhere
    put('b/c/worker.js', 'import "./a-key.js";');
    expect(() => checkImportMaps(root)).toThrow('b/c/worker.js requests ./a-key.js');
    put('b/c/worker.js', '');
    put('b/c/a-key.js', 'stale');
    expect(() => checkImportMaps(root)).toThrow('shadows a written file');
    rmSync(join(root, 'b/c/a-key.js'));
    put('index.html', page('<script type="importmap">{"imports":{"/b/c/a-key.js":"/b/c/missing.js"}}</script>'));
    expect(() => checkImportMaps(root)).toThrow('which this build did not write');
    expect(readFileSync(join(root, 'b/1/main.js'), 'utf8')).toBe('import "../c/a-key.js";');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
