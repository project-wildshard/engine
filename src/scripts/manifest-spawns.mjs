// Temporary build-time discovery bridge until catalog activation owns placement.
// Execute only the declared generator export and its bounded local dependencies.
import './format-hook.mjs';
import { realpathSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { basename, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as v from 'valibot';

const { ManifestMetadataSchema } = await import('@wildshard/format/minimap');

const file = process.argv.at(2), name = process.argv.at(3);
if (process.argv.length !== 4 || file === undefined || name === undefined || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u.test(name)) throw new Error('Expected a declared spawn generator and export');
const entry = realpathSync(file), root = dirname(entry);
if (basename(root) !== 'generators') throw new Error('Spawn bindings must name their generators directory');
const seen = new Set();
/** @param {string} url */
function admit(url) {
  if (!url.startsWith('file:')) throw new Error('Spawn generators may import only local generator TypeScript');
  const path = realpathSync(fileURLToPath(url));
  if (!path.startsWith(`${root}${sep}`) || !path.endsWith('.ts') || statSync(path).size > 65_536) throw new Error('Spawn dependency leaves its bounded generators directory');
  seen.add(path);
  if (seen.size > 32) throw new Error('Too many spawn dependencies');
}
registerHooks({
  resolve(source, context, next) {
    if (!source.startsWith('.') && !source.startsWith('file:')) throw new Error('Spawn generators may import only local generator TypeScript');
    const url = new URL(source, context.parentURL);
    if (!url.pathname.endsWith('.ts')) url.pathname += '.ts';
    admit(url.href); return next(url.href, context);
  },
  load(url, context, next) {
    admit(url); return { ...next(url, context), source: readFileSync(fileURLToPath(url), 'utf8') };
  },
});
const loaded = await import(pathToFileURL(entry).href);
if (loaded[name] === undefined) throw new Error('Declared spawn export is missing');
process.stdout.write(JSON.stringify(v.parse(ManifestMetadataSchema.entries.spawns, loaded[name])));
