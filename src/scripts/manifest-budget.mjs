// Temporary build-only discovery bridge until P3's catalog owns level metadata.
// Only a declared data/ budget module and its local data TS dependencies execute.
import './format-hook.mjs';
import { realpathSync, readFileSync, statSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as v from 'valibot';

const file = process.argv.at(2), name = process.argv.at(3);
if (process.argv.length !== 4 || file === undefined || name === undefined || !/^[a-zA-Z_$][a-zA-Z0-9_$]*$/u.test(name)) throw new Error('Expected a declared budget module and export');
const entry = realpathSync(file), root = dirname(entry);
const seen = new Set();
/** @param {string} url */
function admit(url) {
  if (!url.startsWith('file:')) throw new Error('Budget modules may import only local data TypeScript');
  const path = realpathSync(fileURLToPath(url));
  if (!path.startsWith(`${root}${sep}`) || !path.endsWith('.ts') || statSync(path).size > 65_536) throw new Error('Budget dependency leaves its bounded data directory');
  seen.add(path);
  if (seen.size > 32) throw new Error('Too many budget dependencies');
}
registerHooks({
  resolve(source, context, next) {
    if (!source.startsWith('.') && !source.startsWith('file:')) throw new Error('Budget modules may import only local data TypeScript');
    const url = new URL(source, context.parentURL);
    if (!url.pathname.endsWith('.ts')) url.pathname += '.ts';
    admit(url.href); return next(url.href, context);
  },
  load(url, context, next) {
    admit(url); return { ...next(url, context), source: readFileSync(fileURLToPath(url), 'utf8') };
  },
});
const loaded = await import(pathToFileURL(entry).href);
const finite = v.pipe(v.number(), v.finite(), v.minValue(0));
const tier = v.strictObject({ fps: finite, variability: finite, cpuMs: finite, gcMs: finite,
  systems: v.record(v.string(), finite), vertexShare: finite, lanes: v.record(v.string(), finite), linkMs: finite });
const limits = v.strictObject({ draws: v.exactOptional(finite), tris: v.exactOptional(finite), programs: v.exactOptional(finite), gpuMB: v.exactOptional(finite) });
const ceilings = v.record(v.string(), limits);
const schema = v.strictObject({
  phone: v.exactOptional(tier), desktop: v.exactOptional(tier),
  ceilings: v.exactOptional(v.strictObject({ phone: v.exactOptional(ceilings), desktop: v.exactOptional(ceilings) })),
  load: v.exactOptional(v.strictObject({ coldPlay4G: v.nullable(finite), fixedSeconds: finite, cpuRatio: finite, bytesPerSecond: finite })),
});
process.stdout.write(JSON.stringify(v.parse(schema, loaded[name])));
