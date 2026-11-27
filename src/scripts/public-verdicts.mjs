#!/usr/bin/env node
// STANDALONE-SHARDFILES SF1 (meta plan): what every file under `public/` is, after a pins install. Each file's verdict is
// `engine` (on the committed allowlist, `public-engine.json`: what stays when SF12 cuts `public/` to it), `delete` (on
// `public-delete.json`: read by nothing, SF13) or `zone` (the slugs whose art it is), with its source: engine git, a
// shardfile mount a pin published, or a cook's output.
// A zone file is one a pin published or a tracked file a pinned product names or whose
// path names a pinned slug. SF12: `public/` holds engine front-end art only, so `--check` fails on any file that is not on
// the engine or delete list and not the build's runtime (`isRuntime`), as the test does; `--cut` lists the tracked ones.
//
//   node src/scripts/public-verdicts.mjs [--root .] [--out <file.json>] [--check] [--cut]
// Prints the three totals (files, MB) for the art (`public/assets/` but the runtime's physics and the cook's spawn packs,
// and `public/programs/`), then every file's verdict to --out.
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {join, relative} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

/** @typedef {{path: string, bytes: number, verdict: 'engine'|'delete'|'zone'|'unlisted', zones: string[], source: string}} Verdict */

/** The art SF1 counts: what a page serves from public/ for the world, not its shell, runtime or cooked packs.
 * @param {string} path a path under public/ */
export function isArt(path) {
  return (path.startsWith('assets/') && !path.startsWith('assets/physics/') && !path.startsWith('assets/spawn/')) || path.startsWith('programs/');
}

/** The committed engine list: what `public/` holds after SF12, and all a page build copies from it. */
export const ENGINE_LIST = 'src/scripts/public-engine.json';
/** What the build itself writes under public/ (no art, never committed): the physics runtime, the Basis transcoder, the
 *  cook's spawn packs and boot packs. @param {string} path a path under public/ */
export function isRuntime(path) {
  return /^(?:assets\/(?:physics|spawn|packs)\/|basis\/)/u.test(path);
}

/** SF12: the tracked files under public/ on neither list, which leave engine git (`git rm` them; their zones carry them).
 * @param {string} root @returns {string[]} paths under public/, with the `public/` prefix */
export function publicCut(root) {
  const engine = readList(join(root, ENGINE_LIST)), remove = readList(join(root, 'src/scripts/public-delete.json'));
  const tracked = execFileSync('git', ['ls-files', '-z', 'public'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\0').filter(Boolean);
  return tracked.filter(path => { const at = path.slice('public/'.length); return !engine.has(at) && !remove.has(at) && !isRuntime(at); }).sort();
}

/** Each file's verdict.
 * @param {{
 *   files: readonly {path: string, bytes: number}[],
 *   tracked: ReadonlySet<string>,
 *   published: ReadonlyMap<string, string>,
 *   fetched: ReadonlyMap<string, string>,
 *   named: ReadonlyMap<string, ReadonlySet<string>>,
 *   slugs: readonly string[],
 *   engine: ReadonlySet<string>,
 *   remove: ReadonlySet<string>,
 * }} input paths are under public/ with no leading `public/`; `published` maps a path to the pin slug that wrote it,
 *   `fetched` to the slug of a shard repo file engine fetched (none since SF10), `named` to the slugs whose product names its URL
 * @returns {Verdict[]} */
export function verdicts({files, tracked, published, fetched, named, slugs, engine, remove}) {
  return files.map(({path, bytes}) => {
    const source = tracked.has(path) ? 'engine git' : published.has(path) ? 'shardfile mount' : fetched.has(path) ? 'shard repo' : 'cook or build';
    if (remove.has(path)) return {path, bytes, verdict: 'delete', zones: [], source};
    if (engine.has(path)) return {path, bytes, verdict: 'engine', zones: [], source};
    const zones = new Set(named.get(path) ?? []);
    const writer = published.get(path) ?? fetched.get(path);
    if (writer !== undefined) zones.add(writer);
    for (const slug of slugs) if (path.split('/').some(part => part === slug || part.startsWith(`${slug}-`) || part.startsWith(`${slug}.`))) zones.add(slug);
    return {path, bytes, verdict: zones.size === 0 ? 'unlisted' : 'zone', zones: [...zones].sort(), source};
  });
}

/** Files, MB, by verdict, over the art. @param {readonly Verdict[]} rows */
export function totals(rows) {
  /** @type {Record<string, {files: number, mb: number}>} */ const out = {engine: {files: 0, mb: 0}, zone: {files: 0, mb: 0}, delete: {files: 0, mb: 0}, unlisted: {files: 0, mb: 0}};
  for (const row of rows) if (isArt(row.path)) { const total = out[row.verdict]; if (total !== undefined) { total.files++; total.mb += row.bytes / 1e6; } }
  for (const total of Object.values(out)) total.mb = Math.round(total.mb * 10) / 10;
  return out;
}

/** A list file: `{version: 1, files: [...]}`, sorted, with no repeats. @param {string} file */
export function readList(file) {
  if (!existsSync(file)) return new Set();
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value?.version !== 1 || !Array.isArray(value.files)) throw new Error(`${file}: not {version: 1, files: [...]}`);
  const files = value.files.map(String), sorted = [...files].sort();
  if (new Set(files).size !== files.length || files.some((row, index) => row !== sorted[index])) throw new Error(`${file}: files must be sorted, with no repeats`);
  return new Set(files);
}

const ASSET = /\/(?:assets|programs)\/[A-Za-z0-9_\-./]+\.[a-z0-9]+/gu, TOKEN = /"([A-Za-z0-9_-]{3,64})"/gu;
/** The id a product names a set by, not its URL: a ground layer (`groundLayers: ['leafy_grass']`), a prop set
 *  (`models/<set>/`) or an HDRI (`sky.hdri`). @param {string} path */
export function setId(path) {
  const parts = path.split('/');
  if (parts[0] !== 'assets') return undefined;
  if ((parts[1] === 'tex' || parts[1] === 'models') && parts.length > 3) return parts[2];
  if (parts[1] === 'hdri' && parts.length === 3) return /^(.+?)_[0-9]+k\./u.exec(parts[2] ?? '')?.[1];
  return undefined;
}
/** The URLs each pinned product under out/ names in its text files, and the mounts it carries. @param {string} root */
function products(root) {
  /** @type {Map<string, Set<string>>} */ const named = new Map();
  /** @type {Map<string, string>} */ const carried = new Map();
  /** @type {Map<string, Set<string>>} */ const ids = new Map();
  const slugs = [];
  const out = join(root, 'out');
  if (!existsSync(out)) return {named, carried, slugs, ids};
  for (const folder of readdirSync(out)) {
    const index = join(out, folder, 'shard.json');
    if (folder.startsWith('.') || !existsSync(index)) continue;
    slugs.push(folder);
    const add = (/** @type {string} */ url, /** @type {string} */ slug) => { const path = url.replace(/^\//u, '').split('?')[0] ?? ''; const set = named.get(path) ?? new Set(); set.add(slug); named.set(path, set); };
    const walk = (/** @type {string} */ dir) => {
      for (const name of readdirSync(dir)) {
        const at = join(dir, name), info = statSync(at), rel = relative(join(out, folder), at);
        if (info.isDirectory()) { walk(at); continue; }
        const mounted = /^mounts\/((?:assets|programs)\/.+)$/u.exec(rel)?.[1];
        if (mounted !== undefined) carried.set(mounted, folder);
        if (rel.startsWith('mounts/') || (rel.startsWith('blobs/') && !rel.startsWith('blobs/json/')) || info.size > 32 * 1024 * 1024) continue;
        const text = readFileSync(at, 'utf8');
        for (const match of text.matchAll(ASSET)) add(match[0], folder);
        for (const match of text.matchAll(TOKEN)) { const id = match[1] ?? '', set = ids.get(id) ?? new Set(); set.add(folder); ids.set(id, set); }
      }
    };
    walk(join(out, folder));
    const cook = join(out, folder, 'cook.json');
    if (existsSync(cook)) for (const row of JSON.parse(readFileSync(cook, 'utf8')).mounts ?? []) { carried.set(String(row.url).slice(1), folder); add(row.url, folder); }
  }
  return {named, carried, slugs, ids};
}

/** Read the tree at `root` and give every file under public/ its verdict. @param {string} root */
export function publicVerdicts(root) {
  /** @type {{path: string, bytes: number}[]} */ const files = [];
  const walk = (/** @type {string} */ dir) => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name), info = statSync(at);
      if (info.isDirectory()) walk(at);
      else if (info.isFile() && name !== '.DS_Store') files.push({path: relative(join(root, 'public'), at), bytes: info.size});
    }
  };
  walk(join(root, 'public'));
  const tracked = new Set(execFileSync('git', ['ls-files', '-z', 'public'], {cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).split('\0').filter(Boolean).map(path => path.slice('public/'.length)));
  const {named, carried, slugs, ids} = products(root);
  // a tracked set a product names by its id is that product's too
  for (const path of tracked) {
    const id = setId(path), by = id === undefined ? undefined : ids.get(id);
    if (by === undefined) continue;
    const set = named.get(path) ?? new Set();
    for (const slug of by) set.add(slug);
    named.set(path, set);
  }
  /** @type {Map<string, string>} */ const published = new Map();
  const ledger = join(root, 'out/.pins.json');
  const writes = existsSync(ledger) ? JSON.parse(readFileSync(ledger, 'utf8')).published ?? [] : [];
  for (const row of writes) { const path = String(row).replace(/^public\//u, ''); const slug = carried.get(path); if (slug !== undefined) published.set(path, slug); }
  /** @type {Map<string, string>} */ const fetched = new Map();
  const engine = readList(join(root, ENGINE_LIST)), remove = readList(join(root, 'src/scripts/public-delete.json'));
  for (const path of engine) if (remove.has(path)) throw new Error(`${path} is on both the engine and the delete list`);
  return verdicts({files: files.sort((a, b) => a.path.localeCompare(b.path)), tracked, published, fetched, named, slugs: slugs.sort(), engine, remove});
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const {values} = parseArgs({options: {root: {type: 'string', default: '.'}, out: {type: 'string'}, check: {type: 'boolean', default: false}, cut: {type: 'boolean', default: false}}});
  // SF12: print what leaves engine git, one path a line, for `node src/scripts/public-verdicts.mjs --cut | xargs git rm --`
  if (values.cut) { for (const path of publicCut(values.root)) console.log(path); process.exit(0); }
  const rows = publicVerdicts(values.root), sum = totals(rows);
  for (const [verdict, total] of Object.entries(sum)) console.log(`${verdict.padEnd(8)} ${String(total.files).padStart(5)} files ${total.mb.toFixed(1).padStart(7)} MB`);
  /** @type {Record<string, number>} */ const byZone = {};
  for (const row of rows) if (row.verdict === 'zone' && isArt(row.path)) for (const zone of row.zones) byZone[zone] = (byZone[zone] ?? 0) + row.bytes / 1e6 / row.zones.length;
  console.log(`zone MB by slug (shared files split evenly): ${Object.entries(byZone).sort((a, b) => b[1] - a[1]).map(([zone, mb]) => `${zone} ${mb.toFixed(1)}`).join(', ')}`);
  if (values.out !== undefined) { const {writeFileSync} = await import('node:fs'); writeFileSync(values.out, `${JSON.stringify({totals: sum, files: rows}, null, 1)}\n`); }
  // SF12: public/ holds engine front-end art only, so a zone's file fails as an unlisted one does (the delete list until SF13)
  const strays = rows.filter(row => row.verdict !== 'engine' && row.verdict !== 'delete' && !isRuntime(row.path));
  if (strays.length > 0) {
    console.error(`${strays.length} file(s) under public/ are not engine art: a zone's art lives in its shardfile, so remove each (\`--cut\` lists the tracked ones) or put engine art on src/scripts/public-engine.json`);
    for (const row of strays.slice(0, 40)) console.error(`  ${row.path} (${row.verdict}${row.zones.length > 0 ? ` ${row.zones.join(',')}` : ''}, ${row.source})`);
    if (values.check) process.exitCode = 1;
  }
}
