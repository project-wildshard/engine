/**
 * SF4 (meta standalone shardfiles, Jake 2026-11-26): a zone's art lives under its own name. Every file a shardfile mounts
 * sits at `/assets/<slug>/…` (or `/programs/<slug>.json`): the engine-wide layout (`/assets/<kind>/<name>/…`) with the
 * zone's slug in front, `/assets/<slug>/<kind>/<name>/…`, and a name equal to the slug dropped
 * (`/assets/baked/<slug>/x` is `/assets/<slug>/baked/x`). The engine readers try the zone's path first and the legacy
 * engine-wide path second, so a zone not yet re-packed still plays.
 *
 * Audio keeps its manifest key: `/assets/<slug>/music/<key>/music.json` and `/assets/<slug>/sfx/<key>/sfx.json`. The
 * audio tables (gen.ts at build, `adoptInlineMounts` at run time) carry such a manifest's folder as `ZONE_DIR`, so
 * `musicDir` and `sfxDir` find its files without knowing the slug.
 */

import { publicBytes } from './tables';

const SLUG = '[a-z0-9]+(?:-[a-z0-9]+)*';
/** a slug or a manifest key: lower-case words joined by single hyphens */
const ZONE_SLUG = new RegExp(`^${SLUG}$`, 'u');
export const isZoneSlug = (name: string): boolean => ZONE_SLUG.test(name);
const AUDIO_MANIFEST = new RegExp(`^/assets/(?:(${SLUG})/)?(music|sfx)/(${SLUG})/(music|sfx)\\.json$`, 'u');
/** the audio table key that holds a zone-scoped manifest's folder (never an audio file name: it ends in `/`) */
export const ZONE_DIR = '$dir';

/** `/assets/<slug>/<rest>`: where a zone keeps a file it carries (`rest` has no leading slash). */
export function zoneAssetUrl(slug: string, rest: string): string {
  if (!ZONE_SLUG.test(slug)) throw new Error(`Not a zone slug: ${slug}`);
  if (rest === '' || rest.startsWith('/') || rest.split('/').some(part => part === '' || part === '.' || part === '..')) throw new Error(`Not a zone asset path: ${rest}`);
  return `/assets/${slug}/${rest}`;
}

/** SF4: whether a zone's own file reaches this page another way than its byte table: a cooked zone's spawn download
 *  lists its mounts at their page URLs (`spawnListed`, lent by the client; none here, so a Node bake reads the table only). */
let downloadListed: (url: string) => boolean = () => false;
export function useZoneDownloadListing(listed: (url: string) => boolean): void { downloadListed = listed; }
/** Whether this page can read `url`: its byte table lists it, or its zone's download does. */
export const zoneFileListed = (url: string): boolean => url in publicBytes() || downloadListed(url);

/** `/assets/<slug>/<rest>` when this page lists it (the zone carries its own copy: built in, or in its cook's download),
 *  else `legacy`. A cooked zone's own copy wins over the engine-wide one the page still has (Far Reach entered from a local
 *  cook read its far view from the page's `/assets/baked/far-reach/`). */
export function zoneFirst(slug: string, rest: string, legacy: string): string {
  if (!ZONE_SLUG.test(slug)) return legacy;
  const own = `/assets/${slug}/${rest}`;
  return zoneFileListed(own) ? own : legacy;
}
/** The folder `/assets/<slug>/<rest>/` when the byte table lists a file under it, else `legacy` (a folder too). */
export function zoneFolderFirst(slug: string, rest: string, legacy: string): string {
  if (!ZONE_SLUG.test(slug)) return legacy;
  const own = `/assets/${slug}/${rest}/`;
  return Object.keys(publicBytes()).some(url => url.startsWith(own)) ? own : legacy;
}
/** A zone's baked file: `/assets/<slug>/baked/<file>`, else the engine-wide `/assets/baked/<slug>/<file>`. */
export const bakedFile = (slug: string, file: string): string => zoneFirst(slug, `baked/${file}`, `/assets/baked/${slug}/${file}`);

/** SF4: a ground layer (PBR set) named by its folder URL, `/assets/<slug>/tex/<id>`, or by an engine-wide id
 *  (`/assets/tex/<id>`); `kind` is its map's stem (`diffuse`, `nor_gl`, `arm`). */
export const texBase = (id: string, kind: string): string => id.startsWith('/assets/') ? `${id}/${kind}` : `/assets/tex/${id}/${kind}`;
/** SF4: a sky named by its stem URL, `/assets/<slug>/hdri/<name>`, or by an engine-wide name (`/assets/hdri/<name>`). */
export const hdriStem = (hdri: string): string => hdri.startsWith('/assets/') ? hdri : `/assets/hdri/${hdri}`;
/** SF5: a glTF model named by its folder URL, `/assets/<slug>/models/<id>`, or by an engine-wide id
 *  (`/assets/models/<id>`): its `.gltf`, `.bin` and three 1k maps, each named after the folder's last part. */
export function gltfModelFiles(model: string): string[] {
  const base = model.startsWith('/assets/') ? model.replace(/\/+$/u, '') : `/assets/models/${model}`;
  const id = base.slice(base.lastIndexOf('/') + 1);
  return [`${base}/${id}.gltf`, `${base}/${id}.bin`, ...['diff', 'nor_gl', 'arm'].map(kind => `${base}/textures/${id}_${kind}_1k.jpg`)];
}

/** An audio manifest's table row from its URL: legacy `/assets/<kind>/<key>/<kind>.json` (no `dir`, the engine-wide
 *  folder) or zone `/assets/<slug>/<kind>/<key>/<kind>.json` (its folder as `dir`); null for any other URL. */
export function audioManifestRow(url: string): { readonly kind: 'music' | 'sfx'; readonly key: string; readonly dir?: string } | null {
  const match = AUDIO_MANIFEST.exec(url);
  if (match === null) return null;
  const [, owner, kind, key, file] = match;
  if (kind !== file || key === undefined || (kind !== 'music' && kind !== 'sfx')) return null;
  return owner === undefined ? { kind, key } : { kind, key, dir: url.slice(0, url.lastIndexOf('/') + 1) };
}

/** A table entry's zone folder, else `legacy` (the engine-wide folder of that key). */
export function audioDirOf(entry: unknown, legacy: string): string {
  const dir = typeof entry === 'object' && entry !== null && !Array.isArray(entry) ? (entry as Record<string, unknown>)[ZONE_DIR] : undefined;
  return typeof dir === 'string' && audioManifestRow(`${dir}${dir.split('/').at(-3) ?? ''}.json`) !== null ? dir : legacy;
}

/** Whether `url` is a boot audio file: under an engine-wide or a zone's music or sfx folder. */
export function isAudioUrl(url: string): 'music' | 'sfx' | null {
  const match = new RegExp(`^/assets/(?:${SLUG}/)?(music|sfx)/`, 'u').exec(url);
  return match?.[1] === 'music' || match?.[1] === 'sfx' ? match[1] : null;
}

/** SF23: a zone's own slot set. A score slot whose set is the zone's slug (`sets: { pine: '<slug>' }`) plays the zone's copy
 *  of that slot from `/assets/<slug>/music/<slug>-<style>/` (Pine Hollow's night and boss, Mossgate's and Mirror Salt's
 *  pine and island): shard-format counts only a slot set `base` as engine music. Null for a set that is no slug. */
export function zoneScoreSet(set: string, style: string): { readonly dir: string; readonly manifestKey: string } | null {
  if (set === 'base' || !ZONE_SLUG.test(set)) return null;
  const manifestKey = `${set}-${style}`;
  return { dir: `/assets/${set}/music/${manifestKey}/`, manifestKey };
}
/** SF23: how a page whose tables lack a zone's slot set reads its manifest from the zone's cook (lent by the client: the
 *  spawn download; none here, so a Node bake or a page built with the zone adopts nothing). */
let scoreSetAdoption: (set: { readonly dir: string; readonly manifestKey: string }) => Promise<void> = () => Promise.resolve();
export function useZoneScoreSetAdoption(adopt: (set: { readonly dir: string; readonly manifestKey: string }) => Promise<void>): void {
  scoreSetAdoption = adopt;
}
/** Adopt `set` into the music tables when a cooked zone carries it. */
export const adoptZoneScoreSet = (set: { readonly dir: string; readonly manifestKey: string }): Promise<void> => scoreSetAdoption(set);
