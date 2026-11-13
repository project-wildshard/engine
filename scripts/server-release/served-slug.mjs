// The names a release and the grid use for pinned shards. No dependencies: CI's job-1 checks run it before `pnpm install`.

/** A pin whose installed folder isn't its slug: the template's shardfile is `template` on the API (J259 slugs are kebab-case), but it
 *  installs into `_template`, and the server book, the grid and the server's cells all say `_template`. The release names the folder,
 *  so a server opening the whole grid finds the template's cell (GO7: `template` in the release opened 24 of 25 cells). */
const PIN_FOLDERS = new Map([['template', '_template']]);
/** The release's shards when `E7_SERVER_SHARDS` (from `E7_STAGING_SHARDS` or `E7_PRODUCTION_SHARDS`) is unset or empty. */
export const DEFAULT_SERVER_SHARDS = 'driftwood-isle,nalati-grasslands';
/** The folder a pinned slug installs into, which is the name the server, its book and the grid use. */
export const servedSlug = (/** @type {string} */ slug) => PIN_FOLDERS.get(slug) ?? slug;
