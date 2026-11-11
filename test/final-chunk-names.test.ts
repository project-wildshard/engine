// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- The pass renames real files in an owned tmp build folder.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay under the repository's tmp directory.
import { dirname, join, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { finalHash, nameChunksByFinalBytes } from '../scripts/app-build/finalChunkNames.mjs';

// main ci 43076662972: Vite writes `__vite__mapDeps` after rolldown hashes the importer, so one file name held two
// builds' different preload lists. The pass names such a chunk after its final bytes.

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const FIGURE = 'b/c/late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js';
const preloading = (deps: readonly string[]): string =>
  `const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=${JSON.stringify(deps)})))=>i.map(i=>d[i]);\n`
  + `import{n as e}from"./rolldown-runtime-KEYKEY00.js";var o=()=>import("./late-assets-KEYKEY01.js");export{o as t};`;

/** a written build: one preload-carrying chunk under the name rolldown gave it, the documents and manifests naming it */
function build(deps: readonly string[]): string {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/final-chunk-names-')); roots.push(root);
  const files: Record<string, string> = {
    [FIGURE]: preloading(deps),
    [`${FIGURE}.map`]: JSON.stringify({ version: 3, file: 'late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js', sources: ['figure.ts'], mappings: '' }),
    'b/c/plain-AAAAAAAA.js': 'export const plain = 1;',
    // a longer name ending in the carrier's name is another file: it must stay as it is
    'b/c/other.js': 'export const other = "./prefix-late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js";',
    'importmap.json': JSON.stringify({ imports: { '/b/c/late-TrainingArena-trainingDummyFigure-KEYKEY02.js': `/${FIGURE}` } }),
    'index.html': `<script type="importmap">{"imports":{"/b/c/late-TrainingArena-trainingDummyFigure-KEYKEY02.js":"/${FIGURE}"}}</script>`
      + `<link rel="modulepreload" href="/${FIGURE}">`,
    'calibration/index.html': `<script type="importmap">{"imports":{"/b/c/x-KEYKEY03.js":"/${FIGURE}"}}</script>`,
    '.vite/manifest.json': JSON.stringify({ 'src/figure.ts': { file: FIGURE } }),
    '.vite/chunk-modules.json': JSON.stringify({ [FIGURE]: { name: 'late-TrainingArena-trainingDummyFigure', moduleIds: ['src/figure.ts'] } }),
  };
  for (const [name, text] of Object.entries(files)) { const path = join(root, name); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
  return root;
}
const chunk = (root: string): string => {
  const name = readdirSync(join(root, 'b/c')).find(file => file.startsWith('late-TrainingArena') && file.endsWith('.js'));
  if (name === undefined) throw new Error('chunk missing');
  return `b/c/${name}`;
};

test('two builds whose shared-dep layout differs under one rolldown name end with different names; equal bytes keep one', () => {
  const before = build(['b/c/late-assets-KEYKEY01.js', 'b/c/rolldown-runtime-KEYKEY00.js']);
  const after = build(['b/c/late-assets-KEYKEY01.js', 'b/c/rolldown-runtime-KEYKEY00.js', 'b/c/shared-KEYKEY04.js']);
  const again = build(['b/c/late-assets-KEYKEY01.js', 'b/c/rolldown-runtime-KEYKEY00.js']);
  for (const root of [before, after, again]) nameChunksByFinalBytes(root);
  const [a, b, c] = [chunk(before), chunk(after), chunk(again)];
  expect(a).not.toBe(b);
  expect(a).toBe(c);
  expect(readFileSync(join(before, a))).toEqual(readFileSync(join(again, c)));
  // every name is the hash of the bytes it holds
  for (const [root, name] of [[before, a], [after, b]] as const) expect(name).toBe(`b/c/late-TrainingArena-trainingDummyFigure-${finalHash(readFileSync(join(root, name)))}.js`);
});

test('the documents, manifests and source map name the renamed chunk; keys and other chunks are untouched', () => {
  const root = build(['b/c/late-assets-KEYKEY01.js']);
  const renames = nameChunksByFinalBytes(root), name = chunk(root);
  expect(renames).toEqual([{ from: FIGURE, to: name }]);
  expect(existsSync(join(root, FIGURE))).toBe(false);
  expect(readFileSync(join(root, 'b/c/other.js'), 'utf8')).toContain('prefix-late-TrainingArena-trainingDummyFigure-Ci9ql7Om.js');
  for (const file of ['index.html', 'calibration/index.html', 'importmap.json', '.vite/manifest.json', '.vite/chunk-modules.json']) {
    const text = readFileSync(join(root, file), 'utf8');
    expect(text).toContain(name); expect(text).not.toContain(FIGURE);
  }
  expect(readFileSync(join(root, 'index.html'), 'utf8')).toContain('"/b/c/late-TrainingArena-trainingDummyFigure-KEYKEY02.js"');
  expect(existsSync(join(root, `${FIGURE}.map`))).toBe(false);
  expect(JSON.parse(readFileSync(join(root, `${name}.map`), 'utf8')).file).toBe(name.slice('b/c/'.length));
  expect(readFileSync(join(root, 'b/c/plain-AAAAAAAA.js'), 'utf8')).toBe('export const plain = 1;');
  // a second pass finds every name already final
  expect(nameChunksByFinalBytes(root)).toEqual([]);
});
