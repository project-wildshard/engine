#!/usr/bin/env node
// PAGE-SIZE PZ1 (meta docs/plans/PAGE-SIZE-PLAN.md, J276): what a built page holds, by kind, and how much of it the
// carried builds (MF2, deploy-chunks.json) brought in. With --gate (PZ4, build:game runs it on the split page) it refuses a
// page that holds content, or one past PAGE_LIMITS.
//
//   node scripts/page-size.mjs <dist | .vercel/output/static> [--json] [--gate]
//
// Kinds: code (`b/`), shell (the documents, worker, root JSON, fonts, icons), runtime (what boot needs from the engine:
// `assets/physics/`, `basis/`), engine art (every other `assets/` file, the trailers, the crossroads rig), shard content
// (S1 to S7 below; S7 is every `assets/` folder or file named for a shard) and maps (`*.map`, `.map.br`, `.map.gz`, wherever they sit). MB is 10^6 bytes.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const KINDS = Object.freeze(['code', 'shell', 'runtime', 'engine art', 'shard content', 'maps']);
/** Shard content, by where the page reads it from (the plan's S1 to S7). */
export const SHARD_PARTS = Object.freeze({
  S1: 'shardfiles/',
  S2: 'assets/spawn/parts/',
  S3: 'assets/spawn/server/',
  S4: 'assets/spawn/*.json',
  S5: 'programs/',
  S6: 'assets/grid-*, boot-*, world-map-*',
  S7: 'shard art mounts',
});
/** Art mounts named for a shard no pin carries any more. */
const LEGACY_SHARDS = Object.freeze(['practice']);
/** The `assets/` folders that hold one subfolder per shard (`gpu/baked/` one level deeper). */
const PER_SHARD = new Set(['gpu', 'baked', 'music', 'sfx']);
/** The `assets/` folders that hold one file per shard, named for it (`lut/far-reach.bin`, `horizon/pine-hollow-day.webp`). */
const PER_SHARD_FILE = new Set(['lut', 'horizon']);
const MAP = /\.map(?:\.(?:br|gz))?$/u;

/** The shard names a page's paths can carry: its shardfiles, its catalogue's slugs and the legacy mounts.
 * @param {string} dir @returns {Set<string>} */
export function shardNames(dir) {
  const names = new Set(LEGACY_SHARDS);
  const shardfiles = join(dir, 'shardfiles');
  if (existsSync(shardfiles)) for (const name of readdirSync(shardfiles)) if (statSync(join(shardfiles, name)).isDirectory()) names.add(name);
  const catalogue = join(dir, 'catalogue.json');
  if (existsSync(catalogue)) {
    const value = JSON.parse(readFileSync(catalogue, 'utf8'));
    for (const list of [value?.placements, value?.shards]) {
      if (Array.isArray(list)) for (const row of list) if (typeof row?.slug === 'string') names.add(row.slug);
    }
  }
  return names;
}

/** A folder name is a shard's when it is the slug, the slug without `open-plot-`, a slug's prefix (`nalati`), or the
 * slug with a suffix (`pine-hollow-folk`).
 * @param {string} segment @param {ReadonlySet<string>} shards */
function namesShard(segment, shards) {
  if (shards.has(segment) || shards.has(`open-plot-${segment}`)) return true;
  for (const shard of shards) if (segment.startsWith(`${shard}-`) || shard.startsWith(`${segment}-`)) return true;
  return false;
}

/** @param {string} path a page path, `/`-separated, relative to the page root @param {ReadonlySet<string>} shards
 * @returns {{kind: string, part?: string}} */
export function classify(path, shards) {
  const parts = path.split('/'), [top = '', second = '', third] = parts;
  if (MAP.test(path)) return { kind: 'maps' };
  if (top === 'b') return { kind: 'code' };
  if (top === 'shardfiles') return { kind: 'shard content', part: 'S1' };
  if (top === 'programs') return { kind: 'shard content', part: 'S5' };
  if (top === 'basis') return { kind: 'runtime' };
  if (top === 'crossroads-rig' || /^trailer-[\w-]+\.mp4$/u.test(top)) return { kind: 'engine art' };
  if (top !== 'assets') return { kind: 'shell' };
  if (parts.length === 2) return /^(?:grid|boot|world-map)-/u.test(second) ? { kind: 'shard content', part: 'S6' } : { kind: 'engine art' };
  if (second === 'physics') return { kind: 'runtime' };
  if (second === 'spawn') {
    if (third === 'parts') return { kind: 'shard content', part: 'S2' };
    if (third === 'server' || (parts.length === 3 && (third ?? '').startsWith('server-'))) return { kind: 'shard content', part: 'S3' };
    return { kind: 'shard content', part: 'S4' };
  }
  let owner = second;
  if (PER_SHARD_FILE.has(second) && parts.length === 3) owner = (third ?? '').replace(/\.[^.]+$/u, '');
  else if (second === 'gpu' && third === 'baked' && parts.length > 4) owner = parts[3] ?? '';
  else if (PER_SHARD.has(second) && parts.length > 3) owner = third ?? '';
  return namesShard(owner, shards) ? { kind: 'shard content', part: 'S7' } : { kind: 'engine art' };
}

/** Every file under a page root, following links (a Vercel output can link back into dist).
 * @param {string} root @returns {{path: string, bytes: number}[]} */
function files(root) {
  /** @type {{path: string, bytes: number}[]} */ const rows = [];
  /** @param {string} dir @param {string} prefix */
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const at = join(dir, name), info = statSync(at), path = prefix === '' ? name : `${prefix}/${name}`;
      if (info.isDirectory()) walk(at, path);
      else if (info.isFile()) rows.push({ path, bytes: info.size });
    }
  };
  walk(root, '');
  return rows;
}

/** The paths only the carried builds hold: every graph after the first in deploy-chunks.json, less this build's own.
 * @param {string} dir @returns {{builds: number, paths: Set<string>} | undefined} */
export function carriedPaths(dir) {
  const manifest = join(dir, 'deploy-chunks.json');
  if (!existsSync(manifest)) return undefined;
  const value = JSON.parse(readFileSync(manifest, 'utf8'));
  /** @type {{build: string, files: {path: string}[]}[]} */
  const graphs = value.format === 2 && Array.isArray(value.builds) ? value.builds : [{ build: value.build, files: value.files ?? [] }];
  const own = new Set((graphs[0]?.files ?? []).map(row => row.path)), paths = new Set();
  for (const graph of graphs.slice(1)) for (const row of graph.files) if (!own.has(row.path)) paths.add(row.path);
  return { builds: Math.max(0, graphs.length - 1), paths };
}

/** @typedef {{files: number, bytes: number, carriedFiles: number, carriedBytes: number}} Tally */
/** @returns {Tally} */
const tally = () => ({ files: 0, bytes: 0, carriedFiles: 0, carriedBytes: 0 });
/** @param {Tally} into @param {number} bytes @param {boolean} carried */
function add(into, bytes, carried) {
  into.files++; into.bytes += bytes;
  if (carried) { into.carriedFiles++; into.carriedBytes += bytes; }
}

/** @param {string} dir
 * @returns {{dir: string, carriedBuilds: number | undefined, total: Tally, kinds: Record<string, Tally>, parts: Record<string, Tally>}} */
export function pageSize(dir) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) throw new Error(`page-size: ${root} holds no index.html; give a built page (dist or .vercel/output/static)`);
  const shards = shardNames(root), carried = carriedPaths(root);
  const total = tally();
  /** @type {Record<string, Tally>} */ const kinds = Object.fromEntries(KINDS.map(kind => [kind, tally()]));
  /** @type {Record<string, Tally>} */ const parts = Object.fromEntries(Object.keys(SHARD_PARTS).map(part => [part, tally()]));
  for (const row of files(root)) {
    const { kind, part } = classify(row.path, shards), isCarried = carried?.paths.has(row.path) === true;
    add(total, row.bytes, isCarried);
    const into = kinds[kind];
    if (into !== undefined) add(into, row.bytes, isCarried);
    const shardPart = part === undefined ? undefined : parts[part];
    if (shardPart !== undefined) add(shardPart, row.bytes, isCarried);
  }
  return { dir: root, carriedBuilds: carried?.builds, total, kinds, parts };
}

/** @param {number} bytes */
const mb = bytes => (bytes / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
/** @param {number} count */
const n = count => count.toLocaleString('en-US');

/** D1 yes (J276): the page is code, shell and runtime, at most 1,000 files and 100 MB (with D1 no it would be 450 MB).
 * Maps never count: they go to Sentry and are stripped before any upload. */
export const PAGE_LIMITS = Object.freeze({files: 1000, bytes: 100e6});

/** The gate's refusals, none for a page within its limits.
 * @param {ReturnType<typeof pageSize>} report @param {{files: number, bytes: number}} [limits] @returns {string[]} */
export function gatePage(report, limits = PAGE_LIMITS) {
  const errors = [], zero = tally(), maps = report.kinds.maps ?? zero;
  const content = [report.kinds['shard content'] ?? zero, report.kinds['engine art'] ?? zero];
  const contentFiles = content.reduce((sum, row) => sum + row.files, 0), contentBytes = content.reduce((sum, row) => sum + row.bytes, 0);
  if (contentFiles > 0) errors.push(`page-size gate: dist/ holds ${n(contentFiles)} content files (${mb(contentBytes)} MB); shard content and engine art go to dist-content/ (node scripts/app-build/splitOutput.mjs)`);
  const pageFiles = report.total.files - maps.files, bytes = report.total.bytes - maps.bytes;
  if (pageFiles > limits.files) errors.push(`page-size gate: the page holds ${n(pageFiles)} files, past the ${n(limits.files)} a page may hold (PAGE-SIZE D1)`);
  if (bytes > limits.bytes) errors.push(`page-size gate: the page holds ${mb(bytes)} MB, past the ${limits.bytes / 1e6} MB a page may hold (PAGE-SIZE D1)`);
  return errors;
}

/** The report as a Markdown table, as the plan prints it.
 * @param {ReturnType<typeof pageSize>} report @returns {string} */
export function formatPageSize(report) {
  const { total, kinds, parts } = report;
  const share = (/** @type {number} */ part) => (total.bytes === 0 ? '0.0' : ((part / total.bytes) * 100).toFixed(1));
  /** @param {string} label @param {Tally} row */
  const line = (label, row) => `| ${label} | ${mb(row.bytes)} | ${n(row.files)} | ${share(row.bytes)}% | ${mb(row.carriedBytes)} | ${n(row.carriedFiles)} |`;
  const out = [
    `page-size: ${report.dir}`,
    report.carriedBuilds === undefined ? 'carried builds: no deploy-chunks.json' : `carried builds: ${report.carriedBuilds} (deploy-chunks.json)`,
    '',
    '| Kind | MB | Files | Share | Carried MB | Carried files |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const kind of KINDS) {
    out.push(line(kind, kinds[kind] ?? tally()));
    if (kind === 'shard content') for (const [part, what] of Object.entries(SHARD_PARTS)) out.push(line(`  ${part} ${what}`, parts[part] ?? tally()));
  }
  out.push(line('**total**', total));
  out.push('', `this build's own: ${mb(total.bytes - total.carriedBytes)} MB in ${n(total.files - total.carriedFiles)} files; carried: ${mb(total.carriedBytes)} MB in ${n(total.carriedFiles)} files`);
  return out.join('\n');
}

function main() {
  const args = process.argv.slice(2), json = args.includes('--json'), gate = args.includes('--gate'), dir = args.find(arg => !arg.startsWith('--'));
  if (dir === undefined) throw new Error('usage: node scripts/page-size.mjs <dist | .vercel/output/static> [--json] [--gate]');
  const report = pageSize(dir);
  console.log(json ? JSON.stringify(report, null, 2) : formatPageSize(report));
  if (!gate) return;
  const errors = gatePage(report);
  for (const error of errors) console.error(error);
  if (errors.length > 0) process.exitCode = 1;
  else console.log(`page-size gate: pass, ${n(report.total.files - (report.kinds.maps?.files ?? 0))} files and ${mb(report.total.bytes - (report.kinds.maps?.bytes ?? 0))} MB without maps (limits ${n(PAGE_LIMITS.files)} files, ${PAGE_LIMITS.bytes / 1e6} MB)`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === import.meta.filename) main();
