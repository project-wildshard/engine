// Fix preview PV4: a `file:` folder laid out like the cooked bucket from what a zoneless page build set aside (`WS_ZONE_FILES_OUT`,
// app-build/zoneless.mjs), keyed by the build's zone table, for the headless entry proof
// (test/cooked-zones-browser.proof.mjs). A zone's objects are the files its page paths name: its whole-level manifests' files,
// parts and code lists, and the files under its own folders or named for it. The page build's own entry rows (`<slug>-client-<tier>-<hash16>.json` in its packs book)
// stand in for the cook's (`<slug>-entry-<tier>-<hash16>.json` and `-whole-`, shardCook.ts): same bytes under the cook's page path. Each object is
// a link to the build's file at `shards/<slug>/<shardVersion>/common/<page path>`; the index's verdict is the page's own row.
// The zone files must be the page build's set-aside copy (`WS_ZONE_FILES_OUT`), which holds the product folders as served.
// CLI: node --import ./src/scripts/bake-loader.mjs src/scripts/cooked-build-fixture.mjs <zone-table.json> <zones dir> <dist> <out dir>
import {existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs';
import {join, relative, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readZoneTable, zoneRef} from '../shared/game/grid/zoneTable.ts';

const SEGMENT = /^[\w-][\w.-]*$/u;
/** @param {string} dir @returns {string[]} */
const files = dir => existsSync(dir) ? readdirSync(dir, {withFileTypes: true, recursive: true}).filter(entry => entry.isFile() || entry.isSymbolicLink())
  .map(entry => relative(dir, join(entry.parentPath, entry.name)).split('\\').join('/')).sort() : [];
/** The page's verdict rows (`__WS_SHARDFILE_VERDICTS__`), stamped into its document. @param {string} dist @returns {Array<Record<string, unknown>>} */
function verdicts(dist) {
  const html = readFileSync(join(dist, 'index.html'), 'utf8'), at = html.indexOf('__WS_SHARDFILE_VERDICTS__=');
  if (at === -1) return [];
  const start = html.indexOf('[', at);
  let depth = 0, end = start;
  for (; end < html.length; end++) { if (html[end] === '[') depth++; else if (html[end] === ']' && --depth === 0) break; }
  return JSON.parse(html.slice(start, end + 1));
}

/**
 * @param {{table: import('../shared/game/grid/zoneTable.ts').ZoneTable, zones: string, dist: string, dir: string}} input
 * @returns {{written: string[], skipped: string[]}}
 */
export function cookedBuildFixture({table, zones, dist, dir}) {
  const spawn = join(zones, 'assets/spawn'), bookName = existsSync(spawn) ? readdirSync(spawn).find(name => /^packs-.+\.json$/u.test(name)) : undefined;
  if (bookName === undefined) throw new Error(`No packs book in ${spawn}`);
  const book = JSON.parse(readFileSync(join(spawn, bookName), 'utf8')), rows = verdicts(dist), built = new Set(files(zones));
  /** A page path (`/…`, maybe with `?v=`) as a key of `built`. @param {string} url */
  const key = url => decodeURIComponent(new URL(url, 'https://page.invalid/').pathname).slice(1);
  /** @param {string} path */
  const json = path => JSON.parse(readFileSync(join(zones, path), 'utf8'));
  const written = [], skipped = [];
  for (const row of table.zones) {
    const client = book.client?.[row.slug] ?? book.client?.[`_${row.slug}`];
    if (client?.phone === undefined || client?.desktop === undefined) { skipped.push(row.slug); continue; }
    const ref = zoneRef(table, row), common = `shards/${row.slug}/${row.shardVersion}/common/`;
    /** @type {Record<string, string>} */ const objects = {};
    /** @param {string} path @param {string} source */
    const link = (path, source) => {
      if (Object.hasOwn(objects, path) || !path.split('/').every(part => SEGMENT.test(part))) return;
      const target = join(dir, common, path);
      mkdirSync(resolve(target, '..'), {recursive: true});
      if (!existsSync(target)) symlinkSync(source, target);
      objects[path] = `${common}${path}`;
    };
    // its own folders (`shardfiles/<slug>/`, `assets/<slug>/`, `assets/gpu/baked/<slug>/` …) and its named files (`programs/<slug>.json`,
    // `assets/boot-<slug>-<hash>.json`, `assets/lut/<slug>.bin`), besides what its manifests list below
    const named = new RegExp(`(?:^|/)(?:boot-)?${row.slug}(?:/|[-.][^/]*$)`, 'u');
    const own = new Set([...built].filter(path => named.test(path)));
    for (const tier of ['phone', 'desktop']) {
      const at = client[tier], manifest = json(key(at.url));
      own.add(key(at.url));
      if (at.code !== undefined) { own.add(key(at.code.url)); for (const file of json(key(at.code.url)).files ?? []) own.add(key(file.url)); }
      for (const file of manifest.files ?? []) own.add(key(file.url));
      for (const part of manifest.parts ?? []) own.add(key(part.url));
    }
    for (const path of own) if (built.has(path)) link(path, resolve(zones, path));
    // the page's whole-level row stands in for both of the cook's sets, so an entry with Runtime packs on reads `whole` too
    const manifests = ['entry', 'whole'].flatMap(set => ['phone', 'desktop'].map(tier => {
      const at = client[tier], hash = /-([a-f0-9]{16})\.json$/u.exec(at.url)?.[1];
      if (hash === undefined) throw new Error(`${at.url} is not a content-named manifest`);
      const url = `/assets/spawn/${row.slug}-${set}-${tier}-${hash}.json`;
      objects[url.slice(1)] = objects[at.url.slice(1)] ?? (() => { throw new Error(`${at.url} is not in ${zones}`); })();
      return {url, tier, set, files: at.files, totalBytes: at.totalBytes, wireBytes: at.wireBytes ?? 0, ...(at.code === undefined ? {} : {code: at.code})};
    }));
    const header = `shardfiles/${row.slug}/shard.json`, found = rows.find(verdict => verdict['path'] === `/${header}` || verdict['path'] === `/shardfiles/_${row.slug}/shard.json`);
    const {path: _path, ...verdict} = found ?? {};
    const index = {version: 2, ...ref, hash: table.cookHash, header, manifests, objects, ...(found === undefined ? {} : {verdict})};
    mkdirSync(resolve(dir, row.index, '..'), {recursive: true});
    writeFileSync(join(dir, row.index), JSON.stringify(index));
    written.push(row.slug);
  }
  return {written, skipped};
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [tableFile, zones, dist, dir] = process.argv.slice(2);
  if (tableFile === undefined || zones === undefined || dist === undefined || dir === undefined) throw new Error('usage: cooked-build-fixture.mjs <zone-table.json> <zones dir> <dist> <out dir>');
  const table = readZoneTable(JSON.parse(readFileSync(tableFile, 'utf8')));
  process.stdout.write(`${JSON.stringify(cookedBuildFixture({table, zones: resolve(zones), dist: resolve(dist), dir: resolve(dir)}))}\n`);
}
