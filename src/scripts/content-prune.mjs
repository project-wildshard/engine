#!/usr/bin/env node
// Fix preview PV15 (meta docs/plans/MULTI-REPO-SAGA/2026-11-26-opus-fix-preview-PLAN.md): the old page content sets
// (`content/<set>/` in wildshard-packs) go once nothing reads them, with the 11-19 leftovers at the bucket root (Jake, C8).
//
//   node src/scripts/content-prune.mjs [--sizes] [--json]    dry run: every set and leftover, and who reads it
//   node src/scripts/content-prune.mjs --delete              delete what has been unread for a day (content-prune.yml)
//
// Readers, per channel (preview, explore, staging, production): the live page's content base (index.html's boot bank)
// and every build its deploy-chunks.json retains for rollback. A format-2 graph marks a build that read a set
// `content: true` without naming the set, so while any channel retains one, every set and leftover is kept. The root
// leftovers (`shardfiles/<slug>/`, `programs/`) are also read by a page whose base is the packs root, and by any cook index
// (`index/<build>/<hash>.json`) that names a key under them. `assets/`, `index/` and `loose/` are the cook's and the
// server packs' (PV25 moves them; the cook sweeps them): `assets/<shard>/` art at the root is named by cook indexes, so it
// is listed, never deleted here. Any other root prefix is unknown and kept.
//
// "Unread for a day": a delete run keeps `content-prune.json` at the bucket root, the time each unit was first seen
// unread. A unit is deleted once it was unread on a run at least UNREAD_MS before, and is still unread now; a unit read
// again leaves the state. The first run deletes nothing. A dry run reads only: no write, no delete, no state.
// Credentials: R2_ACCOUNT_ID and R2_PACKS_* (the env, else ~/.config/wildshard/cook.env, as content.mjs reads them).
import {pathToFileURL} from 'node:url';
import {DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {agentFetch} from './agent-requests.mjs';
import {CHANNELS, PACKS_ORIGIN, contentBaseIn} from './page-release/flow.mjs';
import {BUCKET, CONTENT_ROOT, contentKeys, missingKeysMessage} from './page-release/content.mjs';

export const UNREAD_MS = 24 * 3_600_000;
export const STATE_KEY = 'content-prune.json';
/** C8: the 11-19 cook output written at the root, before SA48 moved it under `loose/<hash>/`. */
export const LEFTOVER_ROOTS = /** @type {const} */ (['shardfiles/', 'programs/']);
/** Owned elsewhere: the cook's indexes, loose folders and art, and the server packs. Listed, never deleted here. */
export const OWNED_ROOTS = /** @type {const} */ (['assets/', 'index/', 'loose/']);
const SET = /^content\/([0-9a-f]{16})\/$/u;

/** @typedef {{key: string, kind: 'set' | 'leftover'}} Unit */
/** @typedef {{channel: string, base: string | undefined, carried: string[]}} ChannelReaders */
/** @typedef {{format: 1, unread: Record<string, string>}} PruneState */

/** The builds a deploy-chunks.json retains that read an unnamed content set. Refuses a graph it can't vouch for.
 * @param {unknown} graph @returns {string[]} */
export function carriedContentBuilds(graph) {
  const g = /** @type {any} */ (graph);
  if (g?.format === 1 && typeof g.build === 'string' && g.build !== '' && Array.isArray(g.files)) return [];
  if (g?.format !== 2 || !Array.isArray(g.builds) || g.builds.length === 0 ||
      g.builds.some((/** @type {any} */ build) => typeof build?.build !== 'string' || build.build === '' || !Array.isArray(build.files) ||
        (build.content !== undefined && build.content !== true))) {
    throw new Error('Cannot verify retained content readers from deploy-chunks.json');
  }
  return g.builds.filter((/** @type {any} */ build) => build.content === true).map((/** @type {any} */ build) => build.build);
}

/** One channel's readers from its live index.html and deploy-chunks.json.
 * @param {string} channel @param {string} html @param {unknown} graph @returns {ChannelReaders} */
export const channelReaders = (channel, html, graph) => ({channel, base: contentBaseIn(html), carried: carriedContentBuilds(graph)});

/** Every channel's readers, read live with the agent marker. Any failed read throws: no verdict without every channel.
 * @param {{channels?: Record<string, {channel: string, origin: string}>, get?: typeof fetch}} [options] @returns {Promise<ChannelReaders[]>} */
export async function liveReaders({channels = CHANNELS, get = agentFetch} = {}) {
  return Promise.all(Object.values(channels).map(async ({channel, origin}) => {
    const read = async (/** @type {string} */ path) => {
      const url = new URL(path, origin);
      const response = await get(url, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(30_000)});
      if (!response.ok) throw new Error(`${channel} ${url.pathname} HTTP ${response.status}`);
      return response;
    };
    const [page, graph] = await Promise.all([read('/index.html'), read('/deploy-chunks.json')]);
    return channelReaders(channel, await page.text(), await graph.json());
  }));
}

/** The deletable units among a bucket's prefixes: every `content/<set>/` and the C8 leftovers.
 * @param {{sets: readonly string[], shardfiles: readonly string[], programs: boolean}} listing @returns {Unit[]} */
export function unitsOf({sets, shardfiles, programs}) {
  return [...sets.map(set => ({key: `${CONTENT_ROOT}/${set}/`, kind: /** @type {const} */ ('set')})),
    ...shardfiles.map(slug => ({key: `shardfiles/${slug}/`, kind: /** @type {const} */ ('leftover')})),
    ...programs ? [{key: 'programs/', kind: /** @type {const} */ ('leftover')}] : []];
}

/**
 * Who reads each unit. `named` is every key some cook index names.
 * @param {readonly Unit[]} units @param {readonly ChannelReaders[]} readers @param {ReadonlySet<string>} named
 * @returns {{unit: Unit, readBy: string[]}[]}
 */
export function readersOf(units, readers, named) {
  /** @type {string[]} */ const every = [];
  /** @type {Map<string, string[]>} */ const byKey = new Map();
  const add = (/** @type {string} */ key, /** @type {string} */ why) => byKey.set(key, [...byKey.get(key) ?? [], why]);
  for (const {channel, base, carried} of readers) {
    for (const build of carried) every.push(`${channel}: retained build ${build} reads an unnamed content set (format 2)`);
    if (base === undefined || !base.startsWith(`${PACKS_ORIGIN}/`)) continue;
    const path = base.slice(PACKS_ORIGIN.length + 1), set = SET.exec(path)?.[1];
    if (set !== undefined) add(`${CONTENT_ROOT}/${set}/`, `${channel}: live page base ${base}`);
    else if (path === '') for (const root of LEFTOVER_ROOTS) every.push(`${channel}: live page base ${base} reads ${root} at the root`);
    else every.push(`${channel}: live page base ${base} is not a known set`);
  }
  const leftoverNames = [...named].filter(key => LEFTOVER_ROOTS.some(root => key.startsWith(root)));
  return units.map(unit => {
    const indexed = unit.kind === 'leftover' ? leftoverNames.filter(key => key.startsWith(unit.key)) : [];
    return {unit, readBy: [...every, ...byKey.get(unit.key) ?? [],
      ...indexed.length === 0 ? [] : [`cook indexes name ${indexed.length} key(s), such as ${indexed[0]}`]]};
  });
}

/** @param {unknown} value @returns {PruneState} */
export function parseState(value) {
  const state = /** @type {any} */ (value);
  if (state?.format !== 1 || typeof state.unread !== 'object' || state.unread === null || Array.isArray(state.unread)) throw new Error(`${STATE_KEY} is not format 1`);
  for (const [key, at] of Object.entries(state.unread)) {
    if (typeof at !== 'string' || !Number.isFinite(Date.parse(at))) throw new Error(`${STATE_KEY}: ${key} has no time`);
  }
  return {format: 1, unread: {...state.unread}};
}

/**
 * The units a delete run takes, and the state it leaves (deleted units are the caller's to drop once gone).
 * @param {readonly {unit: Unit, readBy: readonly string[]}[]} verdicts @param {PruneState} state @param {number} now
 * @returns {{deletes: Unit[], waiting: {unit: Unit, since: string}[], state: PruneState}}
 */
export function selectDeletes(verdicts, state, now) {
  /** @type {Record<string, string>} */ const unread = {};
  /** @type {Unit[]} */ const deletes = [];
  /** @type {{unit: Unit, since: string}[]} */ const waiting = [];
  for (const {unit, readBy} of verdicts) {
    if (readBy.length > 0) continue;
    const seen = state.unread[unit.key], since = seen === undefined ? new Date(now).toISOString() : seen;
    unread[unit.key] = since;
    if (seen !== undefined && now - Date.parse(seen) >= UNREAD_MS) deletes.push(unit);
    else waiting.push({unit, since});
  }
  return {deletes, waiting, state: {format: 1, unread}};
}

/** The packs bucket over R2's S3 API. @param {S3Client} client */
export function packsBucket(client) {
  /** @param {string} prefix @param {string} [delimiter] */
  async function* pages(prefix, delimiter) {
    for (let token; ;) {
      const page = await client.send(new ListObjectsV2Command({Bucket: BUCKET, Prefix: prefix, Delimiter: delimiter, ContinuationToken: token}));
      yield page;
      if (page.IsTruncated !== true || page.NextContinuationToken === undefined) return;
      token = page.NextContinuationToken;
    }
  }
  return {
    /** Child prefixes and direct keys under `prefix`. @param {string} prefix */
    async children(prefix) {
      /** @type {string[]} */ const prefixes = [], keys = [];
      for await (const page of pages(prefix, '/')) {
        for (const row of page.CommonPrefixes ?? []) if (row.Prefix !== undefined) prefixes.push(row.Prefix);
        for (const row of page.Contents ?? []) if (row.Key !== undefined) keys.push(row.Key);
      }
      return {prefixes, keys};
    },
    /** Objects and bytes under `prefix`. @param {string} prefix */
    async size(prefix) {
      let objects = 0, bytes = 0;
      for await (const page of pages(prefix)) for (const row of page.Contents ?? []) { objects++; bytes += row.Size ?? 0; }
      return {objects, bytes};
    },
    /** Every key under `prefix`. @param {string} prefix */
    async keys(prefix) {
      /** @type {string[]} */ const keys = [];
      for await (const page of pages(prefix)) for (const row of page.Contents ?? []) if (row.Key !== undefined) keys.push(row.Key);
      return keys;
    },
    /** @param {string} key @returns {Promise<string | undefined>} undefined when absent */
    async text(key) {
      try { return await (await client.send(new GetObjectCommand({Bucket: BUCKET, Key: key}))).Body?.transformToString(); }
      catch (error) { if (error instanceof Error && (error.name === 'NoSuchKey' || error.name === 'NotFound')) return undefined; throw error; }
    },
    /** @param {string} key @param {string} body */
    async write(key, body) {
      await client.send(new PutObjectCommand({Bucket: BUCKET, Key: key, Body: body, ContentType: 'application/json', CacheControl: 'no-store'}));
    },
    /** Delete every key under `prefix`, a page at a time, until none is left. @param {string} prefix */
    async remove(prefix) {
      if (!SET.test(prefix) && !LEFTOVER_ROOTS.some(root => prefix === root || (prefix.startsWith(root) && /^[^/]+\/[^/]+\/$/u.test(prefix)))) throw new Error(`Refusing to delete ${prefix}: not a content set or a C8 leftover`);
      let objects = 0, bytes = 0;
      for (;;) {
        const page = await client.send(new ListObjectsV2Command({Bucket: BUCKET, Prefix: prefix, MaxKeys: 1000}));
        const rows = (page.Contents ?? []).filter(row => row.Key !== undefined);
        if (rows.length === 0) return {objects, bytes};
        const done = await client.send(new DeleteObjectsCommand({Bucket: BUCKET, Delete: {Objects: rows.map(row => ({Key: row.Key})), Quiet: true}}));
        if ((done.Errors ?? []).length > 0) throw new Error(`delete ${prefix}: ${done.Errors?.length} failed, such as ${done.Errors?.[0]?.Key} ${done.Errors?.[0]?.Code}`);
        objects += rows.length; bytes += rows.reduce((sum, row) => sum + (row.Size ?? 0), 0);
      }
    },
  };
}

/** @template T, R @param {readonly T[]} items @param {number} width @param {(item: T) => Promise<R>} work @returns {Promise<R[]>} */
async function pool(items, width, work) {
  /** @type {R[]} */ const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({length: Math.min(width, items.length)}, async () => {
    while (next < items.length) { const at = next++; out[at] = await work(/** @type {T} */ (items[at])); }
  }));
  return out;
}

/** Every key some cook index in the bucket names. @param {ReturnType<typeof packsBucket>} bucket */
export async function indexNamedKeys(bucket) {
  const indexes = (await bucket.keys('index/')).filter(key => /^index\/[\w.-]{1,64}\/[a-f0-9]{64}\.json$/u.test(key));
  /** @type {Set<string>} */ const named = new Set();
  await pool(indexes, 16, async key => {
    const text = await bucket.text(key);
    if (text === undefined) return;
    const keys = /** @type {{keys?: unknown}} */ (JSON.parse(text)).keys;
    if (!Array.isArray(keys)) throw new Error(`${key} names no keys list`);
    for (const named1 of keys) if (typeof named1 === 'string') named.add(named1.replace(/^\//u, ''));
  });
  return {indexes: indexes.length, named};
}

/**
 * One prune run. Dry by default: it lists and reads, and writes nothing.
 * @param {{bucket: ReturnType<typeof packsBucket>, readers: () => Promise<ChannelReaders[]>, now?: number, remove?: boolean, sizes?: boolean, log?: (line: string) => void}} options
 */
export async function prune({bucket, readers, now = Date.now(), remove = false, sizes = false, log = () => undefined}) {
  const [channelRows, root, content, shardfiles, index] = await Promise.all([readers(), bucket.children(''), bucket.children(`${CONTENT_ROOT}/`),
    bucket.children('shardfiles/'), indexNamedKeys(bucket)]);
  const sets = content.prefixes.map(prefix => SET.exec(prefix)?.[1]).filter(set => set !== undefined);
  const strays = [...content.prefixes.filter(prefix => !SET.test(prefix)), ...content.keys];
  const units = unitsOf({sets, shardfiles: shardfiles.prefixes.map(prefix => prefix.slice('shardfiles/'.length, -1)), programs: root.prefixes.includes('programs/')});
  const verdicts = readersOf(units, channelRows, index.named);
  const known = new Set([`${CONTENT_ROOT}/`, ...LEFTOVER_ROOTS, ...OWNED_ROOTS]);
  const unknown = [...root.prefixes.filter(prefix => !known.has(prefix)), ...root.keys.filter(key => key !== STATE_KEY), ...strays, ...shardfiles.keys];
  const stateText = await bucket.text(STATE_KEY);
  const state = stateText === undefined ? {format: /** @type {const} */ (1), unread: {}} : parseState(JSON.parse(stateText));
  const plan = selectDeletes(verdicts, state, now);
  /** @type {Map<string, {objects: number, bytes: number}>} */ const sized = new Map();
  if (sizes) {
    // `assets/` by folder (the server packs in `assets/spawn/`, the cook's art beside them); `index/` and `loose/` whole.
    const owned = [...(await bucket.children('assets/')).prefixes, ...OWNED_ROOTS.filter(root => root !== 'assets/')];
    const prefixes = [...units.map(unit => unit.key), ...owned];
    const rows = await pool(prefixes, 8, prefix => bucket.size(prefix));
    prefixes.forEach((prefix, at) => sized.set(prefix, /** @type {{objects: number, bytes: number}} */ (rows[at])));
  }
  /** @type {{key: string, objects: number, bytes: number}[]} */ const deleted = [];
  if (remove) {
    for (const unit of plan.deletes) {
      const gone = await bucket.remove(unit.key);
      deleted.push({key: unit.key, ...gone});
      log(`deleted ${unit.key}: ${gone.objects} objects, ${gb(gone.bytes)} GB`);
    }
    const left = units.length - deleted.length;
    if (left === 0 && unknown.length === 0) log(`nothing left to prune: retire content-prune.yml and this script (PV15)`);
    const unread = Object.fromEntries(Object.entries(plan.state.unread).filter(([key]) => !deleted.some(row => row.key === key)));
    await bucket.write(STATE_KEY, `${JSON.stringify({format: 1, unread})}\n`);
  }
  return {channels: channelRows, units: verdicts, unknown, indexes: index.indexes, deletes: plan.deletes, waiting: plan.waiting, deleted,
    sizes: Object.fromEntries(sized), dryRun: !remove};
}

/** @param {number} bytes */
const gb = bytes => (bytes / 1e9).toFixed(2);

/** The report a person reads. @param {Awaited<ReturnType<typeof prune>>} result */
export function report(result) {
  const lines = [];
  for (const {channel, base, carried} of result.channels) lines.push(`${channel}: live base ${base ?? 'none'}; ${carried.length} retained build(s) read an unnamed set`);
  /** @param {readonly {unit: Unit, readBy: readonly string[]}[]} rows */
  const total = rows => rows.reduce((sum, {unit}) => {
    const size = result.sizes[unit.key];
    return size === undefined ? sum : {objects: sum.objects + size.objects, bytes: sum.bytes + size.bytes};
  }, {objects: 0, bytes: 0});
  for (const kind of /** @type {const} */ (['set', 'leftover'])) {
    const rows = result.units.filter(({unit}) => unit.kind === kind), read = rows.filter(row => row.readBy.length > 0), sum = total(rows);
    lines.push(`${kind === 'set' ? 'content sets' : 'C8 leftovers'}: ${rows.length} (${read.length} read, ${rows.length - read.length} unread)` +
      (Object.keys(result.sizes).length === 0 ? '' : `, ${sum.objects} objects, ${gb(sum.bytes)} GB`));
  }
  for (const [prefix, size] of Object.entries(result.sizes)) if (OWNED_ROOTS.some(root => prefix.startsWith(root))) lines.push(`kept (cook and packs): ${prefix} ${size.objects} objects, ${gb(size.bytes)} GB`);
  const blockers = [...new Set(result.units.flatMap(row => row.readBy))];
  for (const why of blockers) lines.push(`reader: ${why}`);
  for (const key of result.unknown) lines.push(`unknown, kept: ${key}`);
  for (const {unit, since} of result.waiting) lines.push(`unread since ${since}: ${unit.key}`);
  for (const unit of result.deletes) lines.push(`${result.dryRun ? 'would delete' : 'delete'}: ${unit.key}`);
  lines.push(`${result.indexes} cook indexes read; ${result.dryRun ? 'dry run: nothing written or deleted' : `${result.deleted.length} unit(s) deleted, ${gb(result.deleted.reduce((sum, row) => sum + row.bytes, 0))} GB`}`);
  return lines;
}

/** @param {NodeJS.ProcessEnv} env */
export function packsClient(env) {
  const {env: keys, missing} = contentKeys(env);
  if (missing.length > 0) throw new Error(missingKeysMessage(missing));
  const account = String(keys.R2_ACCOUNT_ID).trim();
  if (!/^[0-9a-f]{32}$/u.test(account)) throw new Error('Invalid R2_ACCOUNT_ID');
  return new S3Client({region: 'auto', maxAttempts: 6, endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: {accessKeyId: String(keys.R2_PACKS_ACCESS_KEY_ID).trim(), secretAccessKey: String(keys.R2_PACKS_SECRET_ACCESS_KEY).trim()},
    requestHandler: {requestTimeout: 120_000, connectionTimeout: 10_000}});
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), bad = args.filter(arg => !['--delete', '--sizes', '--json'].includes(arg));
  if (bad.length > 0) { console.error(`usage: node src/scripts/content-prune.mjs [--delete] [--sizes] [--json] (not ${bad.join(' ')})`); process.exit(2); }
  const client = packsClient(process.env);
  try {
    const result = await prune({bucket: packsBucket(client), readers: () => liveReaders(), remove: args.includes('--delete'), sizes: args.includes('--sizes'), log: line => console.log(line)});
    console.log(args.includes('--json') ? JSON.stringify(result, null, 2) : report(result).join('\n'));
  } finally { client.destroy(); }
}
