// SHARD-DELETE DEL9 (meta J310): nothing engine pins or releases names a shard the API deleted. A deleted slug leaves
// `GET /api/catalogue`, so every slug engine names has to be one that list holds:
//   - `test/pins/shardfiles.json`, the pinned heads every build installs;
//   - `E7_STAGING_SHARDS` and `E7_PRODUCTION_SHARDS`, the GitHub variables a server release reads (empty: the default pair);
//   - the pinned catalogue document's shards, placements and grid cells.
// Names compare by the folder a slug serves under (`template` pins as `_template`), as the release and the grid name them.
//
//   node scripts/pins-catalogue.ts check    CI (job 1, before install): the pins and both release variables against the live
//                                           GET /api/catalogue; the offline half is test/pins-catalogue.test.ts
// `pins.ts refresh` refuses the same way before it writes a pin. Node built-ins only, so CI runs it before `pnpm install`.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_SERVER_SHARDS, servedSlug } from './server-release/served-slug.mjs';

const PINS = 'test/pins/shardfiles.json';

/** One slug engine names that the catalogue doesn't list, and what named it. */
export interface Unlisted { readonly slug: string; readonly source: string }

/** The slugs a `GET /api/catalogue` body lists. A body with no shards array throws: an empty list must never pass for one. */
export function catalogueSlugs(body: unknown): ReadonlySet<string> {
  const shards = (body as { shards?: unknown } | null)?.shards;
  if (!Array.isArray(shards)) throw new Error('GET /api/catalogue: expected { shards: [...] }');
  return new Set(shards.map((row: unknown) => {
    const slug = (row as { slug?: unknown } | null)?.slug;
    if (typeof slug !== 'string' || slug === '') throw new Error('GET /api/catalogue: a shard row has no slug');
    return servedSlug(slug);
  }));
}

/** A release variable's slugs; unset or empty selects the release's default pair, as `publish.mjs` does. */
export function releaseNames(value: string | undefined): readonly string[] {
  const names = value === undefined || value.trim() === '' ? DEFAULT_SERVER_SHARDS : value;
  return names.split(',').map(name => name.trim()).filter(Boolean);
}

/** The slugs a pins file names. */
export function pinnedSlugs(pins: unknown): readonly string[] {
  const shards = (pins as { shards?: unknown } | null)?.shards;
  if (!Array.isArray(shards)) throw new Error('test/pins/shardfiles.json: expected { shards: [...] }');
  return shards.map((row: unknown) => {
    const slug = (row as { slug?: unknown } | null)?.slug;
    if (typeof slug !== 'string' || slug === '') throw new Error('test/pins/shardfiles.json: a pin has no slug');
    return slug;
  });
}

/** The slugs a catalogue document (`GET /api/catalogue.json`) names in its shards, placements and grid cells. */
export function documentSlugs(document: unknown): readonly string[] {
  const doc = document as { shards?: { slug: string }[]; placements?: { slug: string }[]; grid?: { cells?: { slug: string }[] } };
  return [...doc.shards ?? [], ...doc.placements ?? [], ...doc.grid?.cells ?? []].map(row => row.slug);
}

/** Every named slug the catalogue doesn't list, once per source and slug, in the order named. */
export function unlistedSlugs(listed: ReadonlySet<string>, named: Readonly<Record<string, readonly string[]>>): readonly Unlisted[] {
  const seen = new Set<string>();
  return Object.entries(named).flatMap(([source, slugs]) => slugs.flatMap(slug => {
    const key = `${source}\0${slug}`;
    if (listed.has(servedSlug(slug)) || seen.has(key)) return [];
    seen.add(key);
    return [{ slug, source }];
  }));
}

/** One line per unlisted slug, naming who still names it and what to do. An API document is the API's to fix, not engine's. */
export function unlistedMessage(rows: readonly Unlisted[]): string {
  return rows.map(({ slug, source }) => {
    const fix = source.startsWith('GET ') ? 'the API disagrees with itself; report it to api-server' : `drop it from ${source}`;
    return `${source} names ${slug}, which GET /api/catalogue no longer lists (deleted, DEL9): ${fix}`;
  }).join('\n');
}

/** What engine names that a release reads, beside the pins: the default pair and each E7 shards variable `env` sets to a list (an
 *  unset GitHub variable reaches a step as '', which is the default pair, already named). */
export function releaseNamed(env: NodeJS.ProcessEnv): Record<string, readonly string[]> {
  const named: Record<string, readonly string[]> = { 'the default release shards (server-release/served-slug.mjs)': releaseNames(undefined) };
  for (const name of ['E7_STAGING_SHARDS', 'E7_PRODUCTION_SHARDS']) if ((env[name] ?? '').trim() !== '') named[name] = releaseNames(env[name]);
  return named;
}

/** CI's online half of DEL9: the pins and both release variables name only slugs the live `GET /api/catalogue` lists. A catalogue the
 *  API can't serve is a warning, not a red: an API outage isn't a deleted shard. */
async function check(): Promise<void> {
  const { WILDSHARD_API: api = 'https://api.wildshard.io' } = process.env;
  const catalogue = await fetch(`${api}/api/catalogue`, { signal: AbortSignal.timeout(30_000) })
    .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<unknown>; })
    .catch((error: unknown) => error instanceof Error ? error : new Error(String(error)));
  let listed: ReadonlySet<string> | Error;
  try { listed = catalogue instanceof Error ? catalogue : catalogueSlugs(catalogue); } catch (error) { listed = error instanceof Error ? error : new Error(String(error)); }
  if (listed instanceof Error) { console.log(`::warning title=catalogue check skipped::GET /api/catalogue failed: ${listed.message}`); return; }
  const named = releaseNamed(process.env);
  const unlisted = unlistedSlugs(listed, { [PINS]: pinnedSlugs(JSON.parse(readFileSync(PINS, 'utf8'))), ...named });
  // This reads the live API, not the commit: a shard deleted on the API reds every branch until engine drops it, so say so.
  if (unlisted.length > 0) throw new Error(`${unlistedMessage(unlisted)}\nA shard was deleted on the API, not by this commit: drop it`
    + ' (pins: node scripts/pins.ts refresh --drop <slug>; a release variable: gh variable set) and push the fix.');
  console.log(`catalogue check: ${PINS}, ${Object.keys(named).join(', ')} name only slugs GET /api/catalogue lists`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === 'check') await check();
  else throw new Error('usage: pins-catalogue.ts check');
}
