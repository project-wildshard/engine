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
