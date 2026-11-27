// Fix preview PV2 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md; Jake, 2026-11-26 ~14:55 Cancún: "a) is good imho"):
// at deploy time preview takes staging's cook as its pack key. This reads staging's signed release and placement file from
// releases.wildshard.io (R2 layout RL10) and writes the static zone table the page bakes (`src/shared/game/grid/zoneTable.ts`):
// slug, raw shard version and the index key `shards/<slug>/<shardVersion>/cooks/<cookVersion>/<cookHash>/index.json`. Reads only.
//
// The skew check compares cook versions: main's (PV1, `src/cook/game/cook-version.json`) against the one staging's release names.
// A different version refuses, naming both, and preview keeps its last build. A different cook hash under the same version passes:
// PV1's checks prove the bytes the same, so preview reads staging's index.
//
// The go-live check (`check`) GETs every zone's index and HEADs every object it maps, as production-packs.mjs does for production;
// one miss refuses the deploy, so preview never goes live into a 404.
//
//   node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs build <out.json> [--release=<url>] [--placements=<url>] [--cook-version=<x.y.z>]
//   node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs check <table.json> [--origin=<url>] [--page=<origin>]
//   node --import ./src/scripts/bake-loader.mjs src/scripts/page-release/zone-table.mjs own <out.json> --channel=<staging|production> --build=<sha>
import {execFileSync} from 'node:child_process';
import {appendFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import * as v from 'valibot';
import {agentFetch} from '../agent-requests.mjs';
import {readPublication} from '../server-release/sign.mjs';
import {readPlacementFile} from '../../server/host/dedicated/placementFile.ts';
import {RELEASE_PUBLIC_KEY} from './flow.mjs';
import {COOKED_ORIGIN, cookedIndexKey, cookedShardPrefix} from '../../shared/game/shardfile/cookedPackPaths.ts';
import {PLACEMENT_PUBLIC_KEY} from '../../shared/game/grid/placementRows.ts';
import {readZoneTable, zoneRef} from '../../shared/game/grid/zoneTable.ts';

/** @typedef {import('../../shared/game/grid/zoneTable.ts').ZoneTable} ZoneTable */
/** @typedef {import('../../shared/game/grid/zoneTable.ts').ZoneTableRow} ZoneTableRow */
/** @typedef {import('../../shared/game/grid/placementRows.ts').PlacementFile} PlacementFile */
/** @typedef {import('../../shared/host/releaseRows.ts').ReleaseFile} ReleaseFile */
/** @typedef {(url: string, init?: RequestInit) => Promise<Response>} Read */

/** R2 layout RL10 (Jake R5, R6): the signed release files' bucket, `wildshard-releases`. */
export const RELEASES_ORIGIN = 'https://releases.wildshard.io/';
export const STAGING_RELEASE = `${RELEASES_ORIGIN}staging.json`;
export const STAGING_PLACEMENTS = `${RELEASES_ORIGIN}staging-placements.json`;
/** PV1: the file that records main's cook version (codex-cookkeys). */
export const COOK_VERSION_FILE = 'src/cook/game/cook-version.json';

export class ZoneTableRefusal extends Error {
  /** @param {string} message @param {{main: string, table: ZoneTable}} [skew] the cook versions of a skew refusal */
  constructor(message, skew) { super(message); this.name = 'ZoneTableRefusal'; this.skew = skew; }
}
/** The lanes' receipts log (AGENTS.md), where a skew refusal says preview is waiting. */
export const RECEIPTS_LOG = join(homedir(), '.cache/wildshard/lane-receipts.log');
const bare = (/** @type {string} */ slug) => slug.replace(/^_/u, '');

/**
 * The zone table of a release and its placement file: every shard the release serves, then every placed cell's slug the release
 * doesn't, each at its raw shard version under the release's cook. Refused when the release names no cook, or a zone no shard version.
 * @param {ReleaseFile} release @param {PlacementFile | null} placements @returns {ZoneTable}
 */
export function zoneTableOf(release, placements) {
  if (release.channel !== 'staging' && release.channel !== 'production') throw new ZoneTableRefusal(`a ${release.channel} release has no zones to borrow`);
  const {cook} = release;
  if (cook === undefined) throw new ZoneTableRefusal(`${release.channel}'s release (serial ${release.serial}, build ${release.engineBuild.slice(0, 10)}) names no cook version: its signer predates fix preview PV2`);
  /** @type {ZoneTableRow[]} */ const rows = [];
  /** @type {Set<string>} */ const seen = new Set();
  /** @type {string[]} */ const unversioned = [];
  const add = (/** @type {string} */ slug, /** @type {string | undefined} */ shardVersion) => {
    const name = bare(slug);
    if (seen.has(name)) return;
    seen.add(name);
    if (shardVersion === undefined) { unversioned.push(name); return; }
    rows.push({slug: name, shardVersion, index: cookedIndexKey({slug: name, shardVersion, cookVersion: cook.version, cookHash: cook.hash})});
  };
  for (const shard of release.shards) add(shard.slug, shard.shardVersion);
  if (placements !== null) {
    if (placements.channel !== release.channel) throw new ZoneTableRefusal(`the placement file is ${placements.channel}'s, not ${release.channel}'s`);
    for (const cell of placements.cells) add(cell.slug, cell.shardVersion);
  }
  if (unversioned.length > 0) throw new ZoneTableRefusal(`${release.channel}'s release and placements name no shard version for ${unversioned.length} zone(s): ${unversioned.join(', ')}`);
  return readZoneTable({version: 1, from: {channel: release.channel, serial: release.serial, engineBuild: release.engineBuild}, cookVersion: cook.version, cookHash: cook.hash, zones: rows});
}

/** PV2's skew check: a message naming both cook versions when main's differs from the table's, else undefined.
 * @param {string} mainCookVersion @param {Pick<ZoneTable, 'cookVersion' | 'from'>} table @returns {string | undefined} */
export function cookSkew(mainCookVersion, table) {
  return mainCookVersion === table.cookVersion ? undefined
    : `cook version skew: main cooks ${mainCookVersion}, ${table.from.channel}'s release (serial ${table.from.serial}, build ${table.from.engineBuild.slice(0, 10)}) cooked ${table.cookVersion}; preview keeps its last build until ${table.from.channel} releases cook ${mainCookVersion}`;
}

/** Main's cook version (PV1). @param {string} root @returns {string} */
export function mainCookVersion(root) {
  return v.parse(v.object({cookVersion: v.string()}), JSON.parse(readFileSync(resolve(root, COOK_VERSION_FILE), 'utf8'))).cookVersion;
}

/** PV16: main's cook version and cook hash (PV1's file), the key a staging or production build's own cook writes under.
 * @param {string} root @returns {{version: string, hash: string}} */
export function mainCook(root) {
  const file = v.parse(v.object({cookVersion: v.string(), cookHash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u))}), JSON.parse(readFileSync(resolve(root, COOK_VERSION_FILE), 'utf8')));
  return {version: file.cookVersion, hash: file.cookHash};
}

/**
 * Fix preview PV16: a staging or production build's own zone table, from the pins it bakes (each shard at its raw shard version)
 * and the cook this build's release runs (main's, PV1), so the page reads every zone from the cook, as preview does. `serial` is the
 * release this build becomes (the live one's plus one). A pin set that names no shard version for some zone (pins from before R2
 * layout RL12) has none yet: `missing` names those zones, and the build bakes its zones as before.
 * @param {{channel: 'staging' | 'production', build: string, serial: number, catalogue: {shards: readonly {slug: string, shardVersion?: string}[],
 *   placements?: readonly {slug: string}[]}, cook: {version: string, hash: string}}} options
 * @returns {{table: ZoneTable, missing?: undefined} | {table?: undefined, missing: string[]}}
 */
export function ownZoneTable({channel, build, serial, catalogue, cook}) {
  const shards = new Map(catalogue.shards.map(shard => [bare(shard.slug), shard.shardVersion]));
  const slugs = [...new Set([...catalogue.shards, ...catalogue.placements ?? []].map(row => bare(row.slug)))];
  const missing = slugs.filter(slug => shards.get(slug) === undefined);
  if (missing.length > 0) return {missing};
  const zones = slugs.map(slug => {
    const shardVersion = String(shards.get(slug));
    return {slug, shardVersion, index: cookedIndexKey({slug, shardVersion, cookVersion: cook.version, cookHash: cook.hash})};
  });
  return {table: readZoneTable({version: 1, from: {channel, serial, engineBuild: build}, cookVersion: cook.version, cookHash: cook.hash, zones})};
}

const IndexObjects = v.object({objects: v.record(v.string(), v.string())});

/**
 * PV2's go-live check: every zone's index answers 200 and parses, and every object it maps under its own shard version answers 200
 * to a HEAD. Each miss is `<slug> <key> <status>`. Reads with the page's Origin, as the page will.
 * @param {ZoneTable} table
 * @param {{read?: Read, origin?: string, page?: string, concurrency?: number}} [options]
 * @returns {Promise<{zones: number, objects: number, missing: string[]}>}
 */
export async function checkCooked(table, {read = agentFetch, origin = COOKED_ORIGIN, page, concurrency = 32} = {}) {
  const headers = page === undefined ? undefined : {Origin: page};
  /** @type {string[]} */ const missing = [];
  /** @type {{slug: string, key: string}[]} */ const heads = [];
  /** @param {string} url @param {'GET'|'HEAD'} method @returns {Promise<{status: number, body?: unknown}>} */
  const status = async (url, method) => {
    try {
      const response = await read(url, {method, cache: 'no-store', redirect: 'error', ...(headers === undefined ? {} : {headers}), signal: AbortSignal.timeout(30_000)});
      if (method === 'HEAD' || !response.ok) { await response.body?.cancel(); return {status: response.status}; }
      return {status: response.status, body: await response.json()};
    } catch { return {status: 0}; }
  };
  const said = (/** @type {number} */ code) => code === 0 ? 'unread' : String(code);
  await Promise.all(table.zones.map(async row => {
    const index = await status(new URL(row.index, origin).href, 'GET');
    if (index.status !== 200) { missing.push(`${row.slug} ${row.index} ${said(index.status)}`); return; }
    const parsed = v.safeParse(IndexObjects, index.body);
    if (!parsed.success) { missing.push(`${row.slug} ${row.index} names no objects`); return; }
    const own = cookedShardPrefix(zoneRef(table, row));
    for (const key of new Set(Object.values(parsed.output.objects))) {
      if (!key.startsWith(own)) { missing.push(`${row.slug} ${key} outside ${own}`); continue; }
      heads.push({slug: row.slug, key});
    }
  }));
  let next = 0;
  await Promise.all(Array.from({length: Math.min(concurrency, heads.length)}, async () => {
    for (let at = next++; at < heads.length; at = next++) {
      const head = heads[at];
      if (head === undefined) continue;
      const answer = await status(new URL(head.key, origin).href, 'HEAD');
      if (answer.status !== 200) missing.push(`${head.slug} ${head.key} ${said(answer.status)}`);
    }
  }));
  return {zones: table.zones.length, objects: heads.length, missing: missing.sort()};
}

/** @param {string} url @param {Read} read @returns {Promise<string>} */
async function fetchText(url, read) {
  if (url.startsWith('file:')) return readFileSync(new URL(url), 'utf8');
  const response = await read(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
  if (!response.ok) throw new ZoneTableRefusal(`${url} answered ${response.status}`);
  return response.text();
}

/**
 * Read staging's signed release and placements, build the table and check its cook version against main's.
 * @param {{release?: string, placements?: string, cookVersion: string, read?: Read, releaseKey?: string, placementKey?: string}} options
 * @returns {Promise<ZoneTable>}
 */
export async function borrowZoneTable({release = STAGING_RELEASE, placements = STAGING_PLACEMENTS, cookVersion, read = agentFetch,
  releaseKey = RELEASE_PUBLIC_KEY, placementKey = PLACEMENT_PUBLIC_KEY}) {
  const signed = readPublication(await fetchText(release, read), releaseKey);
  /** @type {PlacementFile | null} */
  let placed = null;
  try { placed = readPlacementFile(await fetchText(placements, read), placementKey); }
  catch (error) {
    // the API rewrites its file and never deletes it: only a 404 means "no cell placed"
    if (!(error instanceof ZoneTableRefusal && error.message.endsWith(' 404'))) throw error;
  }
  const table = zoneTableOf(signed, placed);
  const skew = cookSkew(cookVersion, table);
  if (skew !== undefined) throw new ZoneTableRefusal(skew, {main: cookVersion, table});
  return table;
}

/** The cook's own files that changed between `build` (staging's engine commit) and HEAD, or why they can't be named.
 * @param {string} root @param {string} build @returns {string[]} */
export function cookFilesSince(root, build) {
  try {
    return execFileSync('git', ['diff', '--name-only', build, 'HEAD', '--', 'src/cook'], {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']})
      .split('\n').filter(line => line !== '');
  } catch { return [`(build ${build.slice(0, 10)} is not in this clone)`]; }
}

/** PV18: one receipt line for a skew refusal: both cook versions, staging's release, and the cook files that differ, so a release
 * lane sees preview waiting on it. @param {{main: string, table: ZoneTable}} skew @param {readonly string[]} files @param {Date} [now] */
export function skewReceipt(skew, files, now = new Date()) {
  const {main, table} = skew, time = now.toISOString().slice(11, 16), lane = process.env.WS_LANE_NAME ?? 'preview-deploy';
  const named = files.length === 0 ? 'none under src/cook' : `${files.slice(0, 12).join(', ')}${files.length > 12 ? `, and ${files.length - 12} more` : ''}`;
  return `${time} UTC ${lane} BLOCKED preview: cook version skew, main cooks ${main} and ${table.from.channel} (serial ${table.from.serial}, build ${table.from.engineBuild.slice(0, 10)}) cooked ${table.cookVersion}; preview waits for a ${table.from.channel} release; cook files that differ (${files.length}): ${named}`;
}

/**
 * The deploy's `build` step: the borrowed table, or on a skew refusal one receipt line in `receipts` before the refusal stands.
 * @param {Parameters<typeof borrowZoneTable>[0] & {root?: string, receipts?: string, files?: (build: string) => string[]}} options
 */
export async function buildZoneTable({root = process.cwd(), receipts = process.env.WS_RECEIPTS_LOG ?? RECEIPTS_LOG, files, ...options}) {
  try { return await borrowZoneTable(options); }
  catch (error) {
    if (error instanceof ZoneTableRefusal && error.skew !== undefined) {
      mkdirSync(dirname(receipts), {recursive: true});
      appendFileSync(receipts, `${skewReceipt(error.skew, (files ?? (build => cookFilesSince(root, build)))(error.skew.table.from.engineBuild))}\n`);
    }
    throw error;
  }
}

/** @param {readonly string[]} argv */
async function main(argv) {
  const flag = (/** @type {string} */ name) => argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [verb, file] = argv.filter(arg => !arg.startsWith('--'));
  if (verb === 'own' && file !== undefined) {
    // PV16: `own <out.json> --channel=<staging|production> --build=<sha> [--catalogue=<pins>]`, the live release's serial plus one
    const channel = flag('channel'), build = flag('build');
    if ((channel !== 'staging' && channel !== 'production') || build === undefined) throw new Error('usage: zone-table.mjs own <out.json> --channel=<staging|production> --build=<sha> [--catalogue=<file>]');
    const catalogue = JSON.parse(readFileSync(resolve(flag('catalogue') ?? 'test/pins/catalogue.json'), 'utf8'));
    let serial = 1;
    try { serial = readPublication(await fetchText(`${RELEASES_ORIGIN}${channel}.json`, agentFetch), RELEASE_PUBLIC_KEY).serial + 1; }
    catch (error) { if (!(error instanceof ZoneTableRefusal && error.message.endsWith(' 404'))) throw error; }
    const own = ownZoneTable({channel, build, serial, catalogue, cook: mainCook(process.cwd())});
    if (own.table === undefined) {
      console.log(`NOTE zone table: ${channel}'s pins name no shard version for ${own.missing.length} zone(s) (${own.missing.slice(0, 6).join(', ')}): the build bakes its zones (PV16 waits on R2 layout RL12)`);
      return;
    }
    mkdirSync(dirname(resolve(file)), {recursive: true});
    writeFileSync(resolve(file), `${JSON.stringify(own.table)}\n`);
    console.log(`zone table: ${own.table.zones.length} zones for ${channel} serial ${serial}, cook ${own.table.cookVersion} ${own.table.cookHash.slice(0, 12)}; wrote ${file}`);
    return;
  }
  if ((verb !== 'build' && verb !== 'check') || file === undefined) throw new Error('usage: zone-table.mjs build <out.json> [--release=<url>] [--placements=<url>] [--cook-version=<x.y.z>] | check <table.json> [--origin=<url>] [--page=<origin>]');
  if (verb === 'build') {
    const table = await buildZoneTable({release: flag('release') ?? STAGING_RELEASE, placements: flag('placements') ?? STAGING_PLACEMENTS, cookVersion: flag('cook-version') ?? mainCookVersion(process.cwd())});
    for (const row of table.zones) console.log(`zone ${row.slug} ${row.shardVersion} ${row.index}`);
    mkdirSync(dirname(resolve(file)), {recursive: true});
    writeFileSync(resolve(file), `${JSON.stringify(table)}\n`);
    console.log(`zone table: ${table.zones.length} zones from ${table.from.channel} serial ${table.from.serial} (build ${table.from.engineBuild.slice(0, 10)}), cook ${table.cookVersion} ${table.cookHash.slice(0, 12)}; wrote ${file}`);
    return;
  }
  const table = readZoneTable(JSON.parse(readFileSync(resolve(file), 'utf8')));
  const page = flag('page');
  const result = await checkCooked(table, {origin: flag('origin') ?? COOKED_ORIGIN, ...(page === undefined ? {} : {page})});
  if (result.missing.length > 0) throw new ZoneTableRefusal(`${result.missing.length} cooked object(s) missing for ${result.zones} zones: ${result.missing.slice(0, 12).join('; ')}`);
  console.log(`PASS cooked: ${result.zones} zone indexes and ${result.objects} objects answer 200`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); } catch (error) { console.error(`zone table: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
