// G798 / GS2: `pnpm gen:source [--check] [--changed=<path>...]` — every app-wide generated source table from its
// registered producer (scripts/source-generators.mjs). Writes only what differs; --check writes nothing and fails on
// any committed table that differs from a fresh run (GS5: CI and the push gate; build-written tables never reach main);
// --changed runs only the rows those inputs feed.
// GS4: `--stage --changed=<path>...` is scripts/commit.sh's step: it regenerates only the committed tables the named
// paths feed and prints `gen:source stage <json paths>`, which commit.sh adds to the commit.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SOURCE_GENERATORS, selectSourceGenerators } from './source-generators.mjs';

/** @param {{changed?:readonly string[],committed?:boolean}} options */
function selectedRows({ changed, committed = false }) {
  return (changed === undefined ? SOURCE_GENERATORS : selectSourceGenerators(changed)).filter(row => !committed || row.committed);
}

/** @param {string} root @param {import('./source-generators.mjs').SourceGenerator} row */
async function generatedTexts(root, row) {
  if (row.generate === undefined || row.run !== undefined) throw new Error(`gen:source: ${row.id} needs a plain producer`);
  for (const path of row.outputs) if (path.startsWith('/') || /[\\:]/u.test(path) || path.includes(String.fromCodePoint(0)) || path.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error(`gen:source: invalid output path ${path}`);
  const outputs = await row.generate(root);
  if (Object.keys(outputs).sort().join('\n') !== [...row.outputs].sort().join('\n')) throw new Error(`gen:source: ${row.id} outputs differ from its registry row`);
  for (const [path, text] of Object.entries(outputs)) if (typeof text !== 'string') throw new Error(`gen:source: ${path} must be text`);
  return outputs;
}

/** Compute pure source text in the caller's input view, without publishing files.
 * The commit wrapper can put these bytes directly in its checked candidate.
 * @param {string} root @param {{changed?:readonly string[],committed?:boolean}} [options] */
export async function sourceTableTexts(root, options = {}) {
  /** @type {Record<string,string>} */
  const texts = {};
  for (const row of selectedRows(options)) {
    const outputs = await generatedTexts(root, row);
    for (const [path, text] of Object.entries(outputs)) {
      if (Object.hasOwn(texts, path)) throw new Error(`gen:source: multiple owners of ${path}`);
      texts[path] = text;
    }
  }
  return texts;
}

/** Run the registered rows (all, or those `changed` feeds; only committed ones with `committed`); returns the outputs
 * written (or stale, with `check`) and every output the selected generate rows own.
 * @param {string} root @param {{check?:boolean,changed?:readonly string[],committed?:boolean}} [options] */
export async function genSource(root, { check = false, changed, committed = false } = {}) {
  const rows = selectedRows({ changed, committed });
  const touched = [], owned = [];
  for (const row of rows) {
    if (Number(row.generate !== undefined) + Number(row.run !== undefined) !== 1) throw new Error(`gen:source: ${row.id} needs exactly one producer`);
    if (row.generate !== undefined) {
      const outputs = await generatedTexts(root, row);
      for (const [path, text] of Object.entries(outputs)) {
        owned.push(path);
        const file = resolve(root, path), now = existsSync(file) ? readFileSync(file, 'utf8') : null;
        if (now === text) continue;
        touched.push(path);
        if (!check) { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); }
      }
    } else if (row.run !== undefined) row.run(root, check);
  }
  if (check && touched.length > 0) throw new Error(`gen:source: stale ${touched.join(', ')} (run pnpm gen:source)`);
  return { touched, owned };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const changed = process.argv.filter(arg => arg.startsWith('--changed=')).map(arg => arg.slice('--changed='.length));
  const check = process.argv.includes('--check'), stage = process.argv.includes('--stage');
  if (stage && (check || changed.length === 0)) throw new Error('gen:source: --stage takes --changed=<path>... and no --check');
  const { touched, owned } = await genSource(resolve(import.meta.dirname, '..'), { check, committed: stage ? true : check, ...(changed.length > 0 ? { changed } : {}) });
  if (stage) console.log(`gen:source stage ${JSON.stringify(owned)}`);
  else console.log(`gen:source: ${touched.length === 0 ? 'every table current' : `${check ? 'stale' : 'wrote'} ${touched.join(', ')}`}`);
}
